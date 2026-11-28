-- ============================================================
-- 0036：子模板独立模型 + 生成成本流水
-- 1) tasks 增加 subtemplate_models（按子模板保存模型）
-- 2) task_results 增加成本流水表，重做后仍保留历史成本
-- 3) 回填现有结果成本
-- 4) task_view 暴露 subtemplate_models 与累计 actual_cost
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.tasks
  add column if not exists subtemplate_models jsonb not null default '{}'::jsonb;

comment on column public.tasks.subtemplate_models is
  '按子模板 id 保存本次生成使用的模型；空值表示使用任务默认模型';

grant select (subtemplate_models) on public.tasks to authenticated;
grant update (subtemplate_models) on public.tasks to authenticated;

create table if not exists public.task_cost_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  result_id uuid references public.task_results(id) on delete set null,
  subtemplate_id uuid references public.sop_templates(id) on delete set null,
  model text,
  reference_count integer not null default 0,
  amount numeric(12,4) not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_cost_events_task
  on public.task_cost_events (task_id, created_at);

create unique index if not exists uq_task_cost_events_result
  on public.task_cost_events (result_id)
  where result_id is not null;

alter table public.task_cost_events enable row level security;

drop policy if exists p_task_cost_events_select on public.task_cost_events;
create policy p_task_cost_events_select on public.task_cost_events
  for select to authenticated
  using (public.is_active_user());

grant select on public.task_cost_events to authenticated;
grant select, insert, update, delete on public.task_cost_events to service_role;

-- 回填现有结果成本；后续重做时 result_id 会置空，但成本记录会保留。
insert into public.task_cost_events (
  task_id,
  result_id,
  subtemplate_id,
  model,
  reference_count,
  amount,
  created_at
)
select
  r.task_id,
  r.id,
  r.subtemplate_id,
  coalesce(r.model, t.model),
  r.reference_count,
  round((
    case
      when coalesce(r.model, t.model) like 'doubao-seedream-5-5-%'
        then 0.13 + 0.05 * r.reference_count
      when coalesce(r.model, t.model) like 'doubao-seedream-5-0-pro-%'
        then 0.30 + 0.02 * greatest(r.reference_count - 1, 0)
      when coalesce(r.model, t.model) like 'doubao-seedream-5-0-flash-%'
        then 0.12
      when coalesce(r.model, t.model) like 'doubao-seedream-5-0-%'
        then 0.22
      when coalesce(r.model, t.model) like 'doubao-seedream-4-5-%'
        then 0.25
      when coalesce(r.model, t.model) like 'doubao-seedream-4-0-%'
        then 0.20
      else 0.13 + 0.05 * r.reference_count
    end
  )::numeric, 4),
  r.created_at
from public.task_results r
join public.tasks t on t.id = r.task_id
where not exists (
  select 1
  from public.task_cost_events e
  where e.result_id = r.id
);

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
  t.subtemplate_notes,
  t.subtemplate_models,
  t.status,
  t.error_message,
  t.retry_count,
  t.image_count,
  coalesce(r.result_count, 0) as result_count,
  coalesce(r.result_models, array[]::text[]) as result_models,
  coalesce(r.result_reference_counts, array[]::integer[]) as result_reference_counts,
  coalesce(r.result_subtemplate_ids, array[]::uuid[]) as result_subtemplate_ids,
  coalesce(c.actual_cost, 0)::numeric(12,4) as actual_cost,
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
    array_agg(reference_count order by created_at) as result_reference_counts,
    array_agg(subtemplate_id order by created_at) as result_subtemplate_ids
  from public.task_results
  group by task_id
) r on r.task_id = t.id
left join (
  select task_id, sum(amount)::numeric(12,4) as actual_cost
  from public.task_cost_events
  group by task_id
) c on c.task_id = t.id
where public.is_active_user();

grant select on public.task_view to authenticated;
grant select on public.task_view to service_role;

-- 完成。
