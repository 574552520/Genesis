create table if not exists public.commerce_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null default 'taobao_tmall' check (platform in ('taobao_tmall')),
  template_type text not null check (template_type in ('commuter_womenswear', 'sport_casual', 'mens_basic', 'kids')),
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed')),
  input jsonb not null default '{}'::jsonb,
  copy_blocks jsonb not null default '[]'::jsonb,
  title_candidates jsonb not null default '[]'::jsonb,
  keywords jsonb not null default '[]'::jsonb,
  quality_warnings jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_pack_items (
  id bigserial primary key,
  pack_id uuid not null references public.commerce_packs (id) on delete cascade,
  item_type text not null default 'image_task' check (item_type in ('image_task')),
  title text not null default '',
  prompt text not null default '',
  aspect_ratio text not null default '3:4',
  image_size text not null default '1K',
  model text not null default 'pro' check (model in ('pro', 'v2')),
  job_id uuid references public.generation_jobs (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_commerce_packs_user_created
  on public.commerce_packs (user_id, created_at desc);

create index if not exists idx_commerce_pack_items_pack_created
  on public.commerce_pack_items (pack_id, created_at asc);

create or replace function public.set_commerce_pack_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_commerce_packs_set_updated_at on public.commerce_packs;
create trigger trg_commerce_packs_set_updated_at
before update on public.commerce_packs
for each row
execute function public.set_commerce_pack_updated_at();

alter table public.commerce_packs enable row level security;
alter table public.commerce_pack_items enable row level security;

drop policy if exists commerce_packs_select_own on public.commerce_packs;
create policy commerce_packs_select_own
on public.commerce_packs
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists commerce_packs_insert_own on public.commerce_packs;
create policy commerce_packs_insert_own
on public.commerce_packs
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists commerce_packs_update_own on public.commerce_packs;
create policy commerce_packs_update_own
on public.commerce_packs
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists commerce_pack_items_select_own on public.commerce_pack_items;
create policy commerce_pack_items_select_own
on public.commerce_pack_items
for select
to authenticated
using (
  exists (
    select 1
    from public.commerce_packs p
    where p.id = commerce_pack_items.pack_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists commerce_pack_items_insert_own on public.commerce_pack_items;
create policy commerce_pack_items_insert_own
on public.commerce_pack_items
for insert
to authenticated
with check (
  exists (
    select 1
    from public.commerce_packs p
    where p.id = commerce_pack_items.pack_id
      and p.user_id = auth.uid()
  )
);

drop policy if exists commerce_pack_items_update_own on public.commerce_pack_items;
create policy commerce_pack_items_update_own
on public.commerce_pack_items
for update
to authenticated
using (
  exists (
    select 1
    from public.commerce_packs p
    where p.id = commerce_pack_items.pack_id
      and p.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.commerce_packs p
    where p.id = commerce_pack_items.pack_id
      and p.user_id = auth.uid()
  )
);
