-- ============================================================
-- 0026：参考图成本快照 + 全局用量聚合视图
-- 1) task_results 记录每张结果实际使用的参考图数量
-- 2) task_view 暴露逐张参考图数量，供任务列表/详情计算完整成本
-- 3) task_usage_view 按模型与参考图数量聚合，避免看板拉取全部任务
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.task_results
  add column if not exists reference_count integer not null default 0;

grant select (reference_count) on public.task_results to authenticated;

comment on column public.task_results.reference_count is
  '生成该结果时实际发送给模型的竞品参考图数量';

-- 历史结果生成时最多发送 3 张参考图，按当时规则回填。
update public.task_results r
set reference_count = least(coalesce(jsonb_array_length(t.product_images), 0), 3)
from public.tasks t
where t.id = r.task_id
  and r.reference_count = 0;

drop view if exists public.task_usage_view;
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

create view public.task_usage_view as
select
  r.model,
  r.reference_count,
  count(*)::int as image_count
from public.task_results r
join public.tasks t on t.id = r.task_id
where public.is_active_user()
group by r.model, r.reference_count;

grant select on public.task_usage_view to authenticated;
grant select on public.task_usage_view to service_role;

-- 完成。
