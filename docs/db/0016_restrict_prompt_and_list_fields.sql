-- ============================================================
-- 0016：组装后指令仅管理员可见
-- 1) task_view 对非管理员把 prompt_assembled 返回为 null
-- 2) 直接查询 tasks 表时，不授予 authenticated 读取 prompt_assembled
-- ============================================================

create or replace view public.task_view as
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

-- 前端统一通过 task_view 读取任务；直接查 tasks 时不再提供组装后指令。
revoke select on public.tasks from authenticated;
grant select (
  id,
  asin,
  marketplace,
  selling_points,
  template_id,
  fetch_mode,
  product_title,
  product_bullets,
  product_images,
  status,
  error_message,
  retry_count,
  image_count,
  created_by,
  created_at,
  updated_at,
  completed_at
) on public.tasks to authenticated;

-- service_role 继续保留完整服务端访问权限。
grant select, insert, update, delete on public.tasks to service_role;
