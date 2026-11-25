-- ============================================================
-- 0029：动态控制发送给豆包的竞品参考图数量
-- 默认 9 张，保持现有行为；管理员可按图片顺序改为前 1～9 张
-- 执行位置：Supabase SQL Editor
-- ============================================================

insert into public.system_settings (key, value)
values ('reference_image_limit', '9'::jsonb)
on conflict (key) do nothing;

create or replace function public.get_reference_image_limit()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select least(
    9,
    greatest(
      1,
      coalesce(
        (
          select (value #>> '{}')::integer
          from public.system_settings
          where key = 'reference_image_limit'
        ),
        9
      )
    )
  );
$$;

revoke all on function public.get_reference_image_limit() from public, anon;
grant execute on function public.get_reference_image_limit() to authenticated, service_role;

-- 完成。
