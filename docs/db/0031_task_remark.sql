-- ============================================================
-- 0031：任务备注字段
-- 1) tasks 增加 remark，供运营给任务写笔记
-- 2) task_view 暴露 remark
-- 3) 任务创建者/管理员可更新备注
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.tasks
  add column if not exists remark text;

comment on column public.tasks.remark is
  '任务备注，供运营记录笔记';

grant update (remark) on public.tasks to authenticated;

drop view if exists public.task_view;

create view public.task_view as
select
  t.id,
  t.asin,
  t.marketplace,
  t.selling_points,
  t.template_id,
  t.model,
  case when public.is_admin() then t.prompt_assembled else null end as prompt_assembled,
  t.fetch_mode,
  t.product_title,
  t.product_bullets,
  t.product_images,
  t.brand_name,
  t.subtemplate_ids,
  t.remark,
  t.status,
  t.error_message,
  t.retry_count,
  t.image_count,
  coalesce(r.result_count, 0) as result_count,
  coalesce(r.result_models, array[]::text[]) as result_models,
  coalesce(r.result_reference_counts, array[]::integer[]) as result_reference_counts,
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
    array_agg(model order by created_at) as result_models,
    array_agg(reference_count order by created_at) as result_reference_counts
  from public.task_results
  group by task_id
) r on r.task_id = t.id
where public.is_active_user();

grant select on public.task_view to authenticated;
grant select on public.task_view to service_role;

-- 完成。
