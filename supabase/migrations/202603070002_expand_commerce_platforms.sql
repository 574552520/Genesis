alter table public.commerce_packs
drop constraint if exists commerce_packs_platform_check;

alter table public.commerce_packs
add constraint commerce_packs_platform_check
check (platform in ('taobao', 'douyin', 'amazon'));

alter table public.commerce_packs
drop constraint if exists commerce_packs_template_type_check;

alter table public.commerce_packs
add constraint commerce_packs_template_type_check
check (template_type in (
  'commuter_womenswear',
  'sport_casual',
  'mens_basic',
  'kids',
  'taobao_detail',
  'douyin_detail',
  'amazon_detail'
));
