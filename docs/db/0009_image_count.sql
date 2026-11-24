-- ============================================================
-- 0009：模板新增"生成张数"字段，支持每个任务生成多张图（每张不同卖点）
-- ============================================================

-- 1. 模板表加 image_count 字段（默认 1 张）
alter table public.sop_templates
  add column if not exists image_count integer not null default 1 check (image_count between 1 and 10);

-- 2. 任务表加 image_count 字段（记录创建任务时模板的张数快照，避免模板后续改动影响旧任务）
alter table public.tasks
  add column if not exists image_count integer not null default 1;

-- 3. 重建任务视图（先删后建，避免列位置冲突）
drop view if exists public.task_view;

create view public.task_view as
select
  t.id,
  t.asin,
  t.marketplace,
  t.selling_points,
  t.template_id,
  t.prompt_assembled,
  t.fetch_mode,
  t.product_title,
  t.product_bullets,
  t.product_images,
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
left join public.profiles p on p.id = t.created_by;

grant select on public.task_view to authenticated;

-- 完成。
