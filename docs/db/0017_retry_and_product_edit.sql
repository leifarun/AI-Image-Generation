-- ============================================================
-- 0017：任务重做 + 商品资料编辑权限
-- 1) 允许任务创建者/管理员编辑商品资料（等待输出前、失败/成功后重做前）
-- 2) 新增 retry_task：把任务重置为排队/待抓取，供“重做”按钮调用
-- ============================================================

alter policy p_tasks_update on public.tasks
  using (public.is_active_user() and (created_by = auth.uid() or public.is_admin()))
  with check (public.is_active_user() and (created_by = auth.uid() or public.is_admin()));

grant update (selling_points, product_title, product_bullets, product_images, fetch_mode)
  on public.tasks to authenticated;

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
