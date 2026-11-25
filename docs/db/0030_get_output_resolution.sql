-- ============================================================
-- 0030：普通员工读取输出分辨率，用于新建任务成本估算
-- 执行位置：Supabase SQL Editor
-- ============================================================

create or replace function public.get_output_resolution()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'width', coalesce(
      (
        select (value #>> '{}')::integer
        from public.system_settings
        where key = 'output_width'
      ),
      1600
    ),
    'height', coalesce(
      (
        select (value #>> '{}')::integer
        from public.system_settings
        where key = 'output_height'
      ),
      1600
    )
  );
$$;

revoke all on function public.get_output_resolution() from public, anon;
grant execute on function public.get_output_resolution() to authenticated, service_role;

-- 完成。
