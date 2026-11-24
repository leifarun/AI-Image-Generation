-- ============================================================
-- 0024：母模板 + 子模板（图1-图6 可勾选组合）
-- 1) sop_templates 增加 parent_id 与 sort_order
-- 2) tasks 增加 subtemplate_ids，记录本次勾选的子模板顺序
-- 3) task_view 暴露 subtemplate_ids
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.sop_templates
  add column if not exists parent_id uuid references public.sop_templates(id) on delete cascade;

alter table public.sop_templates
  add column if not exists sort_order integer not null default 0;

alter table public.tasks
  add column if not exists subtemplate_ids jsonb not null default '[]'::jsonb;

grant select (parent_id, sort_order) on public.sop_templates to authenticated;
grant select (subtemplate_ids) on public.tasks to authenticated;
grant update (subtemplate_ids) on public.tasks to authenticated;

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
  t.subtemplate_ids,
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

comment on column public.sop_templates.parent_id is '子模板所属的母模板；母模板此字段为空';
comment on column public.tasks.subtemplate_ids is '按生成顺序排列的子模板 ID 数组，空数组表示沿用旧版单模板模式';
