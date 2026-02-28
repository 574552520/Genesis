create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  credits integer not null default 500 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.credit_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  delta integer not null,
  reason text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null default '',
  aspect_ratio text not null default '1:1',
  image_size text not null default '1K',
  status text not null default 'queued' check (status in ('queued', 'processing', 'succeeded', 'failed')),
  error text,
  result_image_path text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_credit_ledger_user_created on public.credit_ledger (user_id, created_at desc);
create index if not exists idx_generation_jobs_user_created on public.generation_jobs (user_id, created_at desc);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, coalesce(new.email, 'unknown@example.com'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

create or replace function public.create_generation_job(
  p_user_id uuid,
  p_prompt text,
  p_aspect_ratio text,
  p_image_size text,
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
begin
  select credits into v_current_credits
  from public.profiles
  where user_id = p_user_id
  for update;

  if v_current_credits is null then
    raise exception 'Profile not found';
  end if;

  if v_current_credits < p_cost then
    raise exception 'Insufficient credits';
  end if;

  update public.profiles
  set credits = credits - p_cost
  where user_id = p_user_id
  returning credits into v_current_credits;

  insert into public.credit_ledger (user_id, delta, reason, meta)
  values (
    p_user_id,
    -p_cost,
    'generation_cost',
    jsonb_build_object('phase', 'enqueue')
  );

  insert into public.generation_jobs (
    user_id,
    prompt,
    aspect_ratio,
    image_size,
    status
  )
  values (
    p_user_id,
    coalesce(p_prompt, ''),
    coalesce(p_aspect_ratio, '1:1'),
    coalesce(p_image_size, '1K'),
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
begin
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
  p_meta jsonb default '{}'::jsonb
)
returns table(credits integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  if p_delta <= 0 then
    raise exception 'Recharge delta must be positive';
  end if;

  update public.profiles
  set credits = credits + p_delta
  where user_id = p_user_id
  returning credits into v_credits;

  if v_credits is null then
    raise exception 'Profile not found';
  end if;

  insert into public.credit_ledger (user_id, delta, reason, meta)
  values (p_user_id, p_delta, p_reason, coalesce(p_meta, '{}'::jsonb));

  return query select v_credits;
end;
$$;

alter table public.profiles enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.generation_jobs enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists credit_ledger_select_own on public.credit_ledger;
create policy credit_ledger_select_own
on public.credit_ledger
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists generation_jobs_select_own on public.generation_jobs;
create policy generation_jobs_select_own
on public.generation_jobs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists generation_jobs_insert_own on public.generation_jobs;
create policy generation_jobs_insert_own
on public.generation_jobs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists generation_jobs_update_own on public.generation_jobs;
create policy generation_jobs_update_own
on public.generation_jobs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists generation_jobs_delete_own on public.generation_jobs;
create policy generation_jobs_delete_own
on public.generation_jobs
for delete
to authenticated
using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('generated-images', 'generated-images', false)
on conflict (id) do nothing;

drop policy if exists generated_images_select_own on storage.objects;
create policy generated_images_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'generated-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists generated_images_insert_own on storage.objects;
create policy generated_images_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'generated-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists generated_images_update_own on storage.objects;
create policy generated_images_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'generated-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'generated-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists generated_images_delete_own on storage.objects;
create policy generated_images_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'generated-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
