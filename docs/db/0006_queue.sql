-- ============================================================
-- 0006：任务队列相关数据库函数
-- 1. claim_next_task()：原子领取一个待处理任务（防并发）
-- 2. 触发任务处理的便捷函数
-- ============================================================

-- 原子领取：把"排队中"最早的一条任务置为"生成中"并返回其 id，
-- 同时受全局并发上限约束（同时"生成中"的数量 < max_concurrent_tasks）
create or replace function public.claim_next_task()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_concurrent integer := 2;
  v_task_id uuid;
  v_running integer;
begin
  -- 读取并发上限（系统设置表）
  select (value #>> '{}')::integer into v_max_concurrent
  from public.system_settings
  where key = 'max_concurrent_tasks'
  limit 1;

  -- 当前正在生成中的任务数
  select count(*) into v_running
  from public.tasks
  where status = 'generating';

  if v_running >= v_max_concurrent then
    return null; -- 已满，不领取
  end if;

  -- 领取最早一条排队中的任务
  select id into v_task_id
  from public.tasks
  where status = 'queued'
  order by created_at asc
  limit 1
  for update skip locked;

  if v_task_id is null then
    return null;
  end if;

  update public.tasks
  set status = 'generating'
  where id = v_task_id;

  return v_task_id;
end;
$$;

-- 授予 service_role 调用（Edge Function 用 service key 运行）
grant execute on function public.claim_next_task() to service_role;
grant execute on function public.claim_next_task() to authenticated;
