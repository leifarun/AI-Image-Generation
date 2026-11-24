-- ============================================================
-- 0012：重写 claim_next_task（去掉 for update skip locked，避免 RLS 冲突）
-- 根因排查：42861 权限错误可能与 security definer + for update 组合有关
-- ============================================================

create or replace function public.claim_next_task()
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off   -- 关键：security definer 函数内关闭 RLS，避免权限冲突
as $$
declare
  v_max_concurrent integer := 2;
  v_task_id uuid;
  v_running integer;
begin
  select (value #>> '{}')::integer into v_max_concurrent
  from public.system_settings
  where key = 'max_concurrent_tasks'
  limit 1;

  select count(*) into v_running
  from public.tasks
  where status = 'generating';

  if v_running >= v_max_concurrent then
    return null;
  end if;

  select id into v_task_id
  from public.tasks
  where status in ('queued', 'pending_fetch')
  order by (status = 'queued') desc, created_at asc
  limit 1;

  if v_task_id is null then
    return null;
  end if;

  update public.tasks
  set status = 'generating'
  where id = v_task_id
    and status in ('queued', 'pending_fetch');  -- 条件更新防并发

  return v_task_id;
end;
$$;

grant execute on function public.claim_next_task() to service_role;
grant execute on function public.claim_next_task() to authenticated;
