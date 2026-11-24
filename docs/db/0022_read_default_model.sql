-- ============================================================
-- 0022：让“运营”也能读取默认豆包模型（用于任务费用估算）
-- 系统设置表本身仅管理员可读，此处新增安全函数只返回一个模型 ID，
-- 不暴露其他设置项。
-- 执行位置：Supabase SQL Editor
-- ============================================================

create or replace function public.get_default_doubao_model()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    nullif(btrim(value #>> '{}'), ''),
    'doubao-seedream-5-5-261028'
  )
  from public.system_settings
  where key = 'default_doubao_model'
  limit 1;
$$;

grant execute on function public.get_default_doubao_model() to authenticated;
grant execute on function public.get_default_doubao_model() to service_role;
