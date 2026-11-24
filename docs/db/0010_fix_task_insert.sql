-- ============================================================
-- 0010：修复"新建任务被 RLS 拦截"的问题
-- 根因：tasks 表插入策略要求 created_by = auth.uid()，
--       但前端插入时未显式传 created_by，导致条件不成立被拦截。
-- 方案：用触发器在插入时自动填 created_by = auth.uid()（更安全，防伪造提交人）
-- ============================================================

-- 1. 插入时自动填充 created_by 为当前登录用户
create or replace function public.set_task_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_task_created_by on public.tasks;
create trigger trg_task_created_by
  before insert on public.tasks
  for each row execute function public.set_task_created_by();

-- 2. 同时确保模板表创建时也自动填 created_by（管理员建模板）
create or replace function public.set_sop_created_by()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sop_created_by on public.sop_templates;
create trigger trg_sop_created_by
  before insert on public.sop_templates
  for each row execute function public.set_sop_created_by();

-- 完成。请重新在前端新建任务测试。
