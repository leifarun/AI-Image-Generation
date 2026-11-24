-- ============================================================
-- 0008：修复 sop_templates 等表的写权限（管理员新建/编辑模板报 permission denied）
-- 根因：建库时只 revoke 了权限、grant 了 select，漏了 insert/update/delete
-- ============================================================

-- 模板表：管理员需要增删改，全员需要读
grant select, insert, update, delete on public.sop_templates to authenticated;

-- 任务表：全员可插入（新建任务）、可删除（本人/管理员）；select 已在 0004 补过
grant insert, delete on public.tasks to authenticated;

-- 结果表：只读
grant select on public.task_results to authenticated;

-- 系统设置：管理员读写
grant select, update on public.system_settings to authenticated;

-- 员工表：读自己/管理员读写（insert 由触发器处理，无需 grant）
grant select on public.profiles to authenticated;

-- 确保 rpc 函数可调用
grant execute on function public.get_user_email_by_login_id(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.claim_next_task() to authenticated;

-- 完成。请重新在前端尝试新建模板。
