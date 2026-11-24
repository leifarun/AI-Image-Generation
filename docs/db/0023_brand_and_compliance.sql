-- ============================================================
-- 0023：商品品牌名 + 违禁词合规红线
-- 1) tasks 增加 brand_name，供亚马逊自动抓取和人工修正
-- 2) sop_templates 增加 compliance_redlines，模板可独立维护合规红线
-- 3) 重建 task_view，让前端能读取 brand_name
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.tasks
  add column if not exists brand_name text;

alter table public.sop_templates
  add column if not exists compliance_redlines text not null default '';

-- 任务表列权限
grant select (brand_name) on public.tasks to authenticated;
grant update (brand_name) on public.tasks to authenticated;

-- 重建视图（先删除，避免列顺序冲突）
drop view if exists public.task_view;

create view public.task_view as
select
  t.id,
  t.asin,
  t.marketplace,
  t.selling_points,
  t.template_id,
  case when public.is_admin() then t.prompt_assembled else null end as prompt_assembled,
  t.fetch_mode,
  t.product_title,
  t.product_bullets,
  t.product_images,
  t.brand_name,
  t.status,
  t.error_message,
  t.retry_count,
  t.image_count,
  t.created_by,
  t.created_at,
  t.updated_at,
  t.completed_at,
  s.name as template_name,
  p.name as creator_name
from public.tasks t
left join public.sop_templates s on s.id = t.template_id
left join public.profiles p on p.id = t.created_by
where public.is_active_user();

grant select on public.task_view to authenticated;
grant select on public.task_view to service_role;

comment on column public.tasks.brand_name is '亚马逊商品品牌名，支持自动抓取和人工补充';
comment on column public.sop_templates.compliance_redlines is '模板级违禁词合规红线，通过 {{违禁词合规红线}} 引用';
