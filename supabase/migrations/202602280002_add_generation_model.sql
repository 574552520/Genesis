alter table public.generation_jobs
add column if not exists model text not null default 'pro';

alter table public.generation_jobs
drop constraint if exists generation_jobs_model_check;

alter table public.generation_jobs
add constraint generation_jobs_model_check
check (model in ('pro', 'v2'));

create or replace function public.create_generation_job(
  p_user_id uuid,
  p_prompt text,
  p_aspect_ratio text,
  p_image_size text,
  p_model text default 'pro',
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
begin
  v_model := lower(coalesce(p_model, 'pro'));

  if v_model not in ('pro', 'v2') then
    raise exception 'Invalid model. Use pro or v2';
  end if;

  select p.credits into v_current_credits
  from public.profiles as p
  where p.user_id = p_user_id
  for update;

  if v_current_credits is null then
    raise exception 'Profile not found';
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
    jsonb_build_object('phase', 'enqueue', 'model', v_model)
  );

  insert into public.generation_jobs (
    user_id,
    prompt,
    aspect_ratio,
    image_size,
    model,
    status
  )
  values (
    p_user_id,
    coalesce(p_prompt, ''),
    coalesce(p_aspect_ratio, '1:1'),
    coalesce(p_image_size, '1K'),
    v_model,
    'queued'
  )
  returning id into v_job_id;

  return query select v_job_id, v_current_credits;
end;
$$;
