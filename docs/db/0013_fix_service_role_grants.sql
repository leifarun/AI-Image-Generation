-- ============================================================
-- 0013：修复 Edge Function 报 "permission denied"（任务卡在"生成中"）
-- 根因：service_role（Edge Function 使用的服务端角色）从未被授予表权限。
--       2026 年起 Supabase 不再自动给 public schema 的新表授予 API 角色权限，
--       之前脚本只 grant 了 authenticated，漏掉了 service_role。
--       结果：任务被 claim 成"生成中"后，处理器用 service_role 读/写 tasks
--       被拦（permission denied），回写 failed 也被拦，任务永远卡在"生成中"。
-- 方案：① 显式授予 service_role 表权限（仅限可信服务端代码使用）
--       ② 重写 claim_next_task：恢复并发安全 + 函数内关闭 RLS
-- ============================================================

-- ---------- 1. schema 与表权限 ----------
grant usage on schema public to service_role;

grant select, insert, update, delete on public.profiles to service_role;
grant select, insert, update, delete on public.sop_templates to service_role;
grant select, insert, update, delete on public.tasks to service_role;
grant select, insert, update, delete on public.task_results to service_role;
grant select, insert, update, delete on public.system_settings to service_role;

-- 任务列表视图也授予 service_role 读权限（当前处理器直接查 tasks，此句为防患）
grant select on public.task_view to service_role;

-- 序列（当前主键用 UUID，此句为防未来加自增列，无害）
grant usage, select on all sequences in schema public to service_role;

-- ---------- 2. 重写 claim_next_task（并发安全版） ----------
-- 关键点：
--   security definer + set row_security = off：函数内以表所有者(postgres)身份运行，
--   绕过 RLS，能读到全部任务行；
--   for update skip locked：原子领取，多个处理器并发时不会领到同一条任务。
create or replace function public.claim_next_task()
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_max_concurrent integer := 2;
  v_task_id uuid;
  v_running integer;
begin
  -- 全局并发上限（读系统设置；函数内已关 RLS，可直接读）
  select coalesce((value #>> '{}')::integer, 2) into v_max_concurrent
  from public.system_settings
  where key = 'max_concurrent_tasks'
  limit 1;

  select count(*) into v_running
  from public.tasks
  where status = 'generating';

  if v_running >= v_max_concurrent then
    return null; -- 并发已满，不领取
  end if;

  -- 原子领取：优先排队中(已抓取)，其次待抓取
  select id into v_task_id
  from public.tasks
  where status in ('queued', 'pending_fetch')
  order by (status = 'queued') desc, created_at asc
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

grant execute on function public.claim_next_task() to service_role;
grant execute on function public.claim_next_task() to authenticated;

-- ---------- 3. 其他 rpc 函数也确保 service_role 可调（防患） ----------
grant execute on function public.is_admin() to service_role;
grant execute on function public.is_active_user() to service_role;
grant execute on function public.get_user_email_by_login_id(text) to service_role;

-- 完成。执行后请重新部署 process-task，再提交一个任务验证。