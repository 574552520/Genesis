alter table public.generation_jobs
add column if not exists lane text;

update public.generation_jobs
set lane = 'generator'
where lane is null;

update public.generation_jobs as gj
set lane = cp.mode
from public.commerce_pack_items as cpi
join public.commerce_packs as cp on cp.id = cpi.pack_id
where cpi.job_id = gj.id
  and cp.mode in ('launch_pack', 'try_on', 'lookbook', 'flatlay', 'invisible_mannequin_3d');

alter table public.generation_jobs
alter column lane set default 'generator';

alter table public.generation_jobs
alter column lane set not null;

alter table public.generation_jobs
drop constraint if exists generation_jobs_lane_check;

alter table public.generation_jobs
add constraint generation_jobs_lane_check
check (lane in ('generator', 'launch_pack', 'try_on', 'lookbook', 'flatlay', 'invisible_mannequin_3d'));

drop function if exists public.create_generation_job(uuid, text, text, text, text, integer);

create or replace function public.create_generation_job(
  p_user_id uuid,
  p_prompt text,
  p_aspect_ratio text,
  p_image_size text,
  p_model text default 'pro',
  p_lane text default 'generator',
  p_cost integer default 50
)
returns table(job_id uuid, credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_credits integer;
  v_job_id uuid;
  v_model text;
  v_lane text;
  v_expires_at timestamptz;
  v_role text;
  v_uid uuid;
begin
  v_role := coalesce(auth.role(), current_setting('request.jwt.claim.role', true));
  v_uid := auth.uid();

  if v_role <> 'service_role' and (v_uid is null or v_uid <> p_user_id) then
    raise exception 'Not allowed to create generation job for this user';
  end if;

  if p_cost <= 0 then
    raise exception 'Generation cost must be positive';
  end if;

  v_model := lower(coalesce(p_model, 'pro'));
  if v_model not in ('pro', 'v2') then
    raise exception 'Invalid model. Use pro or v2';
  end if;

  v_lane := lower(coalesce(p_lane, 'generator'));
  if v_lane not in ('generator', 'launch_pack', 'try_on', 'lookbook', 'flatlay', 'invisible_mannequin_3d') then
    raise exception 'Invalid generation lane';
  end if;

  select p.credits, p.credits_expires_at into v_current_credits, v_expires_at
  from public.profiles as p
  where p.user_id = p_user_id
  for update;

  if v_current_credits is null then
    raise exception 'Profile not found';
  end if;

  if v_expires_at is not null and now() >= v_expires_at then
    v_current_credits := 0;
    update public.profiles as p
    set credits = 0,
        credits_expires_at = null
    where p.user_id = p_user_id;
  end if;

  if v_current_credits < p_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.profiles as p
  set credits = p.credits - p_cost
  where p.user_id = p_user_id
  returning p.credits into v_current_credits;

  insert into public.credit_ledger (user_id, delta, reason, meta)
  values (
    p_user_id,
    -p_cost,
    'generation_cost',
    jsonb_build_object('phase', 'enqueue', 'model', v_model, 'lane', v_lane)
  );

  insert into public.generation_jobs (
    user_id,
    prompt,
    aspect_ratio,
    image_size,
    model,
    lane,
    status
  )
  values (
    p_user_id,
    coalesce(p_prompt, ''),
    coalesce(p_aspect_ratio, '1:1'),
    coalesce(p_image_size, '1K'),
    v_model,
    v_lane,
    'queued'
  )
  returning id into v_job_id;

  return query select v_job_id, v_current_credits;
end;
$$;

revoke all on function public.create_generation_job(uuid, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_generation_job(uuid, text, text, text, text, text, integer) to service_role;
