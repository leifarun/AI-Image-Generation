-- ============================================================
-- 0027：任务模型快照 + 新队员可用站点 RPC
-- 1) tasks 增加 model，记录任务提交时的模型
-- 2) task_view 暴露 model
-- 3) 普通员工通过安全函数读取管理员配置的可用站点
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.tasks
  add column if not exists model text;

comment on column public.tasks.model is
  '任务使用的豆包模型 ID，提交时快照，避免系统默认模型变更影响已提交任务';

grant select (model), insert (model), update (model)
  on public.tasks to authenticated;

-- 为历史任务补上当时实际生成所用的模型。
update public.tasks t
set model = latest.model
from (
  select distinct on (task_id)
    task_id,
    model
  from public.task_results
  where model is not null
  order by task_id, created_at asc
) latest
where latest.task_id = t.id
  and t.model is null;

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

create or replace function public.get_supported_marketplaces()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select value
      from public.system_settings
      where key = 'marketplaces'
    ),
    '[]'::jsonb
  );
$$;

revoke all on function public.get_supported_marketplaces() from public, anon;
grant execute on function public.get_supported_marketplaces() to authenticated, service_role;

-- 完成。
