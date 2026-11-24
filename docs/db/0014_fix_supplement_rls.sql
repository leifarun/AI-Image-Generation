-- ============================================================
-- 0014：修复"补充资料"保存被 RLS 拦截
-- 现象：前端补充资料保存报 new row violates row-level security policy for table "tasks"
-- 根因：on_task_supplemented 触发器把状态 need_input → queued，
--       但 p_tasks_update 策略的 with check 仍要求新行 status = 'need_input'，冲突被拒。
-- 方案：with check 只校验 created_by（状态流转交给 security definer 触发器负责，
--       普通用户本就没有 status 列写权限，无法直接改状态）。
-- ============================================================

drop policy if exists p_tasks_update on public.tasks;

create policy p_tasks_update on public.tasks
  for update to authenticated
  using (created_by = auth.uid() and status = 'need_input')
  with check (created_by = auth.uid());