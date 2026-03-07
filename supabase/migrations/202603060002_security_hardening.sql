-- Security hardening for RPC functions and profile updates.
-- Apply as a forward-only migration to existing projects.

-- Remove legacy overloads left by earlier migrations.
drop function if exists public.create_generation_job(uuid, text, text, text, integer);
drop function if exists public.recharge_credits(uuid, integer, text, jsonb);

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

create or replace function public.fail_generation_job_and_refund(
  p_job_id uuid,
  p_error text,
  p_refund_amount integer default 50
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_user_id uuid;
  v_role text;
begin
  v_role := coalesce(auth.role(), current_setting('request.jwt.claim.role', true));
  if v_role <> 'service_role' then
    raise exception 'Not allowed to refund generation jobs';
  end if;

  if p_refund_amount <= 0 then
    raise exception 'Refund amount must be positive';
  end if;

  select status, user_id into v_status, v_user_id
  from public.generation_jobs
  where id = p_job_id
  for update;

  if v_status is null then
    raise exception 'Job not found';
  end if;

  if v_status in ('failed', 'succeeded') then
    return;
  end if;

  update public.generation_jobs
  set status = 'failed',
      error = left(coalesce(p_error, 'Generation failed'), 1000),
      completed_at = now()
  where id = p_job_id;

  update public.profiles
  set credits = credits + p_refund_amount
  where user_id = v_user_id;

  insert into public.credit_ledger (user_id, delta, reason, meta)
  values (
    v_user_id,
    p_refund_amount,
    'generation_refund',
    jsonb_build_object('job_id', p_job_id)
  );
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
  v_role text;
begin
  v_role := coalesce(auth.role(), current_setting('request.jwt.claim.role', true));
  if v_role <> 'service_role' then
    raise exception 'Not allowed to recharge credits';
  end if;

  if p_delta <= 0 then
    raise exception 'Recharge delta must be positive';
  end if;

  update public.profiles
  set credits = case
      when credits_expires_at is not null and credits_expires_at <= now() then p_delta
      else credits + p_delta
    end,
    credits_expires_at = case
      when credits_expires_at is not null and credits_expires_at <= now() then p_expires_at
      else coalesce(p_expires_at, credits_expires_at)
    end
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

-- Do not allow end users to directly update profile rows (credits tampering risk).
drop policy if exists profiles_update_own on public.profiles;
revoke update on table public.profiles from anon, authenticated;

-- Restrict RPC execution surface.
revoke all on function public.create_generation_job(uuid, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_generation_job(uuid, text, text, text, text, integer) to service_role;

revoke all on function public.fail_generation_job_and_refund(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.fail_generation_job_and_refund(uuid, text, integer) to service_role;

revoke all on function public.recharge_credits(uuid, integer, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.recharge_credits(uuid, integer, text, jsonb, timestamptz) to service_role;
