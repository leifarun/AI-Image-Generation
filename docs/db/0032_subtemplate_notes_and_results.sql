-- ============================================================
-- 0032：子模板自定义说明 + 结果图与子模板关联
-- 1) tasks 增加 subtemplate_notes（jsonb，按子模板 id 保存自定义说明）
-- 2) task_results 增加 subtemplate_id，记录每张结果图对应的子模板
-- 3) task_view 暴露 subtemplate_notes 与逐张结果的 subtemplate_id
-- 4) 新增 retry_task_image：只重做某一个子模板对应的图片
-- 执行位置：Supabase SQL Editor
-- ============================================================

alter table public.tasks
  add column if not exists subtemplate_notes jsonb not null default '{}'::jsonb;

comment on column public.tasks.subtemplate_notes is
  '按子模板 id 保存的自定义说明，生成时追加到对应子模板内容中';

grant select (subtemplate_notes) on public.tasks to authenticated;
grant update (subtemplate_notes) on public.tasks to authenticated;

alter table public.task_results
  add column if not exists subtemplate_id uuid references public.sop_templates(id) on delete set null;

grant select (subtemplate_id) on public.task_results to authenticated;

comment on column public.task_results.subtemplate_id is
  '该结果图对应的子模板；为空表示历史结果或独立模板任务';

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
  t.remark,
  t.status,
  t.error_message,
  t.retry_count,
  t.image_count,
  coalesce(r.result_count, 0) as result_count,
  coalesce(r.result_models, array[]::text[]) as result_models,
  coalesce(r.result_reference_counts, array[]::integer[]) as result_reference_counts,
  coalesce(r.result_subtemplate_ids, array[]::uuid[]) as result_subtemplate_ids,
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
where public.is_active_user();

grant select on public.task_view to authenticated;
grant select on public.task_view to service_role;

-- 单张重做：删除指定子模板的结果图，并把任务重新排队。
create or replace function public.retry_task_image(
  p_task_id uuid,
  p_subtemplate_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_index integer;
begin
  if not exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and (t.created_by = auth.uid() or public.is_admin())
  ) then
    raise exception '无权重做该任务';
  end if;

  if exists (
    select 1
    from public.tasks t
    where t.id = p_task_id
      and t.status in ('fetching', 'generating')
  ) then
    raise exception '任务正在处理中，请稍后再试';
  end if;

  -- 新结果直接按 subtemplate_id 删除；历史结果没有 subtemplate_id 时按顺序删除。
  delete from public.task_results
  where task_id = p_task_id
    and subtemplate_id = p_subtemplate_id;

  if not found then
    select t.idx - 1
      into v_index
    from (
      select
        t.id,
        (select pos from jsonb_array_elements_text(coalesce(t.subtemplate_ids, '[]'::jsonb))
           with ordinality as arr(value, pos)
         where arr.value::uuid = p_subtemplate_id
         limit 1)::int as idx
      from public.tasks t
      where t.id = p_task_id
    ) t
    where t.idx is not null;

    if v_index is not null then
      delete from public.task_results
      where id = (
        select id
        from public.task_results
        where task_id = p_task_id
        order by created_at asc
        limit 1
        offset v_index
      );
    end if;
  end if;

  update public.tasks
  set status = case
        when product_title is not null or product_bullets is not null then 'queued'
        else 'pending_fetch'
      end,
      error_message = null,
      retry_count = 0,
      completed_at = null
  where id = p_task_id;
end;
$$;

grant execute on function public.retry_task_image(uuid, uuid) to authenticated;
grant execute on function public.retry_task_image(uuid, uuid) to service_role;

-- 完成。
