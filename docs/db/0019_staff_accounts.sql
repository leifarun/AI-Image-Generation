-- ============================================================
-- 0019：员工账号管理配套约束
-- 1) 新建 Auth 用户时由触发器直接写入自定义登录 ID
-- 2) 禁止空登录 ID
-- 3) 登录 ID 按不区分大小写做全局唯一
-- 执行位置：Supabase SQL Editor
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, login_id, role)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'name'), ''),
      split_part(new.email, '@', 1)
    ),
    coalesce(
      nullif(btrim(new.raw_user_meta_data->>'login_id'), ''),
      'u' || substr(new.id::text, 1, 8)
    ),
    'operator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table public.profiles
  alter column login_id set not null;

create unique index if not exists profiles_login_id_lower_unique
  on public.profiles (lower(login_id));

comment on index public.profiles_login_id_lower_unique is
  '登录 ID 全局唯一且不区分大小写';
