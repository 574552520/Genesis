alter table public.commerce_packs
add column if not exists mode text not null default 'launch_pack';

alter table public.commerce_packs
drop constraint if exists commerce_packs_mode_check;

alter table public.commerce_packs
add constraint commerce_packs_mode_check
check (mode in ('launch_pack', 'try_on', 'lookbook', 'flatlay', 'invisible_mannequin_3d'));

create index if not exists idx_commerce_packs_user_mode_created
  on public.commerce_packs (user_id, mode, created_at desc);
