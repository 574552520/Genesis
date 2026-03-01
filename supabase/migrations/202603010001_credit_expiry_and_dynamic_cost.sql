alter table public.profiles
add column if not exists credits_expires_at timestamptz;

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
  v_expires_at timestamptz;
begin
  v_model := lower(coalesce(p_model, 'pro'));

  if v_model not in ('pro', 'v2') then
    raise exception 'Invalid model. Use pro or v2';
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

create or replace function public.recharge_credits(
  p_user_id uuid,
  p_delta integer,
  p_reason text default 'recharge_simulated',
  p_meta jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null
)
returns table(credits integer, credits_expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_expires_at timestamptz;
begin
  if p_delta <= 0 then
    raise exception 'Recharge delta must be positive';
  end if;

  update public.profiles
  set credits = case
      when credits_expires_at is not null and credits_expires_at <= now() then p_delta
      else credits + p_delta
    end,
    credits_expires_at = coalesce(p_expires_at, credits_expires_at)
  where user_id = p_user_id
  returning profiles.credits, profiles.credits_expires_at into v_credits, v_expires_at;

  if v_credits is null then
    raise exception 'Profile not found';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, meta)
  values (
    p_user_id,
    p_delta,
    p_reason,
    coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('expires_at', v_expires_at)
  );

  return query select v_credits, v_expires_at;
end;
$$;
