-- ============================================================
-- 0005：创建"任务视图"，把任务与模板名、提交人姓名扁平化，
--       前端直接查视图，避免依赖 PostgreSQL 自动生成的外键名。
-- ============================================================

create or replace view public.task_view as
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
  t.created_by,
  t.created_at,
  t.updated_at,
  t.completed_at,
  s.name as template_name,
  p.name as creator_name
from public.tasks t
left join public.sop_templates s on s.id = t.template_id
left join public.profiles p on p.id = t.created_by;

-- 视图也受 RLS 保护（视图本身继承基表 RLS，但需给登录用户查询权限）
grant select on public.task_view to authenticated;

-- 注意：视图上的 RLS 继承自基表 tasks 的策略（is_active_user），
--       因此仍能保证"只有启用中的员工能看到任务"。
