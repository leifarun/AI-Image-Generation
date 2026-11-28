-- ============================================================
-- 0037：彻底移除 need_input 状态
-- 执行位置：Supabase SQL Editor
--
-- 警告：本脚本会永久删除所有 status = 'need_input' 的任务。
-- 任务结果与成本流水通过外键级联删除；结果桶中的图片文件也会同步删除。
-- 删除后不可恢复。
--
-- 说明：0001/0007/0014 等历史迁移保留原样，仅作为已执行历史记录。
-- ============================================================

begin;

-- 1) 先记录本次要删除的任务，供后续清理结果图文件使用。
create temp table _need_input_tasks on commit drop as
select id
from public.tasks
where status = 'need_input';

select count(*) as tasks_to_delete
from _need_input_tasks;

-- 2) 删除这些任务对应的私有桶结果图（如果历史上产生过）。
delete from storage.objects o
using public.task_results r
join _need_input_tasks t on t.id = r.task_id
where o.bucket_id = 'task-results'
  and o.name = regexp_replace(r.image_path, '^.*/task-results/', '');

-- 3) 删除任务。task_results / task_cost_events 会通过外键级联删除。
delete from public.tasks t
using _need_input_tasks n
where t.id = n.id;

-- 4) 删除旧的补充资料触发器及函数。
drop trigger if exists trg_task_supplemented on public.tasks;
drop function if exists public.on_task_supplemented();

-- 5) 移除 status 检查约束中的 need_input，并重新建立新约束。
alter table public.tasks drop constraint if exists tasks_status_check;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.tasks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%need_input%'
  loop
    execute format('alter table public.tasks drop constraint %I', c.conname);
  end loop;
end;
$$;

alter table public.tasks
  add constraint tasks_status_check
  check (status in ('pending_fetch', 'fetching', 'queued', 'generating', 'succeeded', 'failed'));

commit;

-- 完成。
