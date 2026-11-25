-- ============================================================
-- 0025：任务进度 + 实际成本
-- 1) task_view 暴露每个任务已生成图片数（result_count）与逐张模型（result_models）
-- 2) 前端据此显示“已生成 x/y”并按下表单价计算实际成本
-- 执行位置：Supabase SQL Editor
-- ============================================================

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
  coalesce(r.result_count, 0) as result_count,
  coalesce(r.result_models, array[]::text[]) as result_models,
  t.created_by,
  t.created_at,
  t.updated_at,
  t.completed_at,
  s.name as template_name,
  p.name as creator_name
from public.tasks t
left join public.sop_templates s on s.id = t.template_id
left join public.profiles p on p.id = t.created_by
left join (
  select
    task_id,
    count(*)::int as result_count,
    array_agg(model order by created_at) as result_models
  from public.task_results
  group by task_id
) r on r.task_id = t.id
where public.is_active_user();

grant select on public.task_view to authenticated;
grant select on public.task_view to service_role;

-- 完成。
