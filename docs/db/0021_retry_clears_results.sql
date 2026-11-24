-- ============================================================
-- 0021：让“重做”真正从第 1 张重新生成
-- 旧逻辑只重置任务状态，不清空 task_results：
--   - 已成功任务点“重做”会直接再次判定成功
--   - 失败任务会混用上次生成的部分结果
-- 新逻辑：重做时删除该任务的旧结果记录，再从第 1 张生成。
-- 注意：存储桶中的旧图片文件不在此处删除，避免直接操作存储底层；
--       任务记录删除时会由后续存储清理机制处理，不影响新任务生成。
-- 执行位置：Supabase SQL Editor
-- ============================================================

create or replace function public.retry_task(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  delete from public.task_results
  where task_id = p_task_id;

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

grant execute on function public.retry_task(uuid) to authenticated;
grant execute on function public.retry_task(uuid) to service_role;
