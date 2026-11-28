-- ============================================================
-- 0038：把“空竞品资料”规范化为 NULL
-- 背景：历史版本保存竞品资料时，把空值写成了 '' 和 []，
--       导致 retry_task 的 is not null 判断误认为“已有资料”，
--       重做时跳过抓取、直接用空资料生成。
-- 执行位置：Supabase SQL Editor
-- ============================================================

begin;

update public.tasks
set product_title = null
where product_title is not null and product_title = '';

update public.tasks
set brand_name = null
where brand_name is not null and brand_name = '';

update public.tasks
set product_bullets = null
where product_bullets is not null
  and jsonb_typeof(product_bullets) = 'array'
  and jsonb_array_length(product_bullets) = 0;

update public.tasks
set product_images = null
where product_images is not null
  and jsonb_typeof(product_images) = 'array'
  and jsonb_array_length(product_images) = 0;

update public.tasks
set fetch_mode = 'auto'
where fetch_mode = 'manual'
  and coalesce(product_title, '') = ''
  and coalesce(brand_name, '') = ''
  and (product_bullets is null or jsonb_array_length(product_bullets) = 0)
  and (product_images is null or jsonb_array_length(product_images) = 0);

commit;

-- 完成。
