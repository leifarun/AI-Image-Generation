-- ============================================================
-- 0003：支持"自定义 ID 登录"
-- 做法：给员工表加 login_id 字段（全局唯一），登录时用 login_id + 密码
-- ============================================================

-- 1. 新增登录名字段（先允许为空，避免已有数据冲突）
alter table public.profiles
  add column if not exists login_id text;

-- 2. 去掉可能的历史空值/重复，再设唯一约束
update public.profiles
  set login_id = 'u' || substr(id::text, 1, 8)
  where login_id is null or login_id = '';

alter table public.profiles
  add constraint profiles_login_id_unique unique (login_id);

-- 3. 用 login_id 反向查账号的辅助函数（登录用；security definer 避免 RLS 干扰）
create or replace function public.get_user_email_by_login_id(p_login_id text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.login_id) = lower(p_login_id)
  limit 1;
$$;

-- 4. 权限收紧：普通员工不能改自己的 login_id（防止冒充），仅管理员可改
revoke update on public.profiles from authenticated, anon;
grant update (name, role, status, login_id) on public.profiles to authenticated;

-- 5. 触发器：禁止普通员工改 login_id / role / status（数据库层强制）
create or replace function public.guard_profile_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role)
     or (new.status is distinct from old.status)
     or (new.login_id is distinct from old.login_id) then
    if current_user not in ('service_role','postgres','supabase_admin') and not public.is_admin() then
      raise exception '仅管理员可修改登录名、角色或账号状态';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privilege();

-- 完成。验证：Table Editor 打开 profiles，应看到 login_id 字段已出现。
