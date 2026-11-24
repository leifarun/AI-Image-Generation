-- ============================================================
-- 0004：修复登录后无法读取自己资料的问题
-- 根因：profiles 表未显式授予 authenticated 角色 SELECT 权限，
--       导致登录成功后查询自己资料被"permission denied"拦截，
--       前端误报"账号尚未建档"
-- ============================================================

-- 1. 明确授予登录用户对 profiles 表的查询权限
grant select on public.profiles to authenticated;

-- 2. 同样确保其他表的 select 权限（防止同类问题）
grant select on public.sop_templates to authenticated;
grant select on public.tasks to authenticated;
grant select on public.task_results to authenticated;
grant select on public.system_settings to authenticated;

-- 3. 确保 rpc 反查函数可被登录用户调用（security definer 函数默认需 grant execute）
grant execute on function public.get_user_email_by_login_id(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

-- 完成。执行后请重新登录测试。
