-- ============================================================
-- 0035：自动删除超期任务
-- 默认删除提交时间超过 30 天的任务，每天上海时间 00:00 执行。
-- 任务结果记录通过 tasks 外键级联删除。
-- 执行位置：Supabase SQL Editor
-- ============================================================

insert into public.system_settings (key, value)
values ('auto_delete_days', '30'::jsonb)
on conflict (key) do nothing;

create or replace function public.cleanup_old_tasks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := 30;
  v_deleted integer := 0;
begin
  select case
           when jsonb_typeof(value) = 'number' then (value #>> '{}')::integer
           else 30
         end
    into v_days
  from public.system_settings
  where key = 'auto_delete_days'
  limit 1;

  if v_days is null or v_days < 1 then
    v_days := 30;
  end if;

  delete from public.tasks
  where created_at < now() - make_interval(days => v_days);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'auto_delete_old_tasks'
  ) then
    perform cron.unschedule('auto_delete_old_tasks');
  end if;
end;
$$;

-- pg_cron 使用 UTC：16:00 UTC = 上海时间次日 00:00。
select cron.schedule(
  'auto_delete_old_tasks',
  '0 16 * * *',
  'select public.cleanup_old_tasks();'
);

-- 完成。
