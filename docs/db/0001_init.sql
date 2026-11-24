-- ============================================================
-- AI 卖点图工场 · 数据库初始化脚本 v1.1（对应设计文档 v0.1）
-- 执行方式：Supabase 控制台 → SQL Editor → 粘贴全文 → Run
-- 说明：含 5 张表 + RLS 行级安全 + 存储桶 + 索引 + 审计触发器
-- v1.1 修正：调整函数与表的创建顺序（先建表，后建依赖表的函数）
-- ============================================================

-- ---------- 1. 通用工具函数（不依赖任何业务表） ----------

-- 自动更新 updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- 2. 员工表（先建表，后面的权限函数要用它） ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'operator' check (role in ('admin','operator')),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is '员工资料：与登录账号一一对应';

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- 3. 权限检查函数（现在 profiles 表已存在） ----------

-- 判断当前用户是否为"启用中的管理员"（security definer 避免 RLS 递归）
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'active'
  );
$$;

-- 判断当前用户是否"启用中的员工"（被停用的人应失去所有数据访问）
create or replace function public.is_active_user()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and status = 'active'
  );
$$;

-- 新账号注册时自动建档
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    'operator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 防越权：非管理员不得修改角色和启用状态（数据库层强制，前端绕不过去）
create or replace function public.guard_profile_privilege()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role) or (new.status is distinct from old.status) then
    if current_user not in ('service_role','postgres','supabase_admin') and not public.is_admin() then
      raise exception '仅管理员可修改角色或账号状态';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_privilege();

-- ---------- 4. 指令模板表 ----------
create table public.sop_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content text not null,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.sop_templates is 'AI 指令 SOP 模板（管理员维护）';

drop trigger if exists trg_sop_updated on public.sop_templates;
create trigger trg_sop_updated
  before update on public.sop_templates
  for each row execute function public.set_updated_at();

-- ---------- 5. 任务表（核心台账） ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  asin text not null,
  marketplace text not null,
  selling_points text not null default '',
  template_id uuid references public.sop_templates(id),
  prompt_assembled text,
  fetch_mode text check (fetch_mode in ('auto','manual')),
  product_title text,
  product_bullets jsonb,
  product_images jsonb,
  status text not null default 'pending_fetch'
    check (status in ('pending_fetch','fetching','need_input','queued','generating','succeeded','failed')),
  error_message text,
  retry_count integer not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.tasks is '每次图片生成任务一条记录';

drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated
  before update on public.tasks
  for each row execute function public.set_updated_at();

create index idx_tasks_status_created on public.tasks (status, created_at desc);
create index idx_tasks_asin on public.tasks (asin);
create index idx_tasks_created_by on public.tasks (created_by);

-- ---------- 6. 结果表 ----------
create table public.task_results (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  image_path text not null,
  model text,
  created_at timestamptz not null default now()
);

comment on table public.task_results is '豆包生成的图片记录（仅云端程序写入）';

create index idx_results_task on public.task_results (task_id);

-- ---------- 7. 系统设置表 ----------
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.system_settings is '管理员可调的运行参数';

insert into public.system_settings (key, value) values
  ('max_concurrent_tasks', '2'::jsonb),
  ('max_requests_per_minute', '10'::jsonb),
  ('default_doubao_model', '"doubao-seedream-4-0-250828"'::jsonb),
  ('marketplaces', '["US","UK","DE","JP","CA"]'::jsonb)
on conflict (key) do nothing;

-- ---------- 8. 开启 RLS 行级安全 ----------
alter table public.profiles enable row level security;
alter table public.sop_templates enable row level security;
alter table public.tasks enable row level security;
alter table public.task_results enable row level security;
alter table public.system_settings enable row level security;

-- ---------- 9. 访问策略 ----------

-- profiles：本人可读自己；管理员可读全部、可改全部；其余一律禁止
drop policy if exists p_profiles_select on public.profiles;
create policy p_profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 收紧可改字段：普通员工只能改姓名；角色/状态由触发器额外把关
revoke update on public.profiles from authenticated, anon;
grant update (name, role, status) on public.profiles to authenticated;

-- sop_templates：启用中的员工可读；仅管理员可增删改
drop policy if exists p_sop_select on public.sop_templates;
create policy p_sop_select on public.sop_templates
  for select to authenticated
  using (public.is_active_user());

drop policy if exists p_sop_insert on public.sop_templates;
create policy p_sop_insert on public.sop_templates
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists p_sop_update on public.sop_templates;
create policy p_sop_update on public.sop_templates
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists p_sop_delete on public.sop_templates;
create policy p_sop_delete on public.sop_templates
  for delete to authenticated
  using (public.is_admin());

-- tasks：启用员工可读全部；本人可建、可删自己的；管理员可删任意
drop policy if exists p_tasks_select on public.tasks;
create policy p_tasks_select on public.tasks
  for select to authenticated
  using (public.is_active_user());

drop policy if exists p_tasks_insert on public.tasks;
create policy p_tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_active_user() and created_by = auth.uid());

drop policy if exists p_tasks_delete on public.tasks;
create policy p_tasks_delete on public.tasks
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- 状态变更仅允许服务端（云端程序）操作：普通员工只能补填资料
drop policy if exists p_tasks_update on public.tasks;
create policy p_tasks_update on public.tasks
  for update to authenticated
  using (created_by = auth.uid() and status = 'need_input')
  with check (created_by = auth.uid() and status = 'need_input');

revoke update on public.tasks from authenticated, anon;
grant update (selling_points, product_title, product_bullets, product_images, fetch_mode)
  on public.tasks to authenticated;

-- task_results：员工可读；写入仅限云端程序（不开放给普通用户，故无写策略）
drop policy if exists p_results_select on public.task_results;
create policy p_results_select on public.task_results
  for select to authenticated
  using (public.is_active_user());

-- system_settings：仅管理员可读可改
drop policy if exists p_settings_select on public.system_settings;
create policy p_settings_select on public.system_settings
  for select to authenticated
  using (public.is_admin());

drop policy if exists p_settings_update on public.system_settings;
create policy p_settings_update on public.system_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- 10. 文件仓库（两个私有存储桶） ----------
insert into storage.buckets (id, name, public)
values ('task-references', 'task-references', false),
       ('task-results', 'task-results', false)
on conflict (id) do nothing;

-- 结果图：登录员工可读；写入仅云端程序（无写策略）
drop policy if exists p_storage_results_read on storage.objects;
create policy p_storage_results_read on storage.objects
  for select to authenticated
  using (bucket_id = 'task-results' and public.is_active_user());

-- 参考图：登录员工可读；员工可上传到自己的目录（路径以用户 id 开头）
drop policy if exists p_storage_refs_read on storage.objects;
create policy p_storage_refs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'task-references' and public.is_active_user());

drop policy if exists p_storage_refs_insert on storage.objects;
create policy p_storage_refs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-references' and public.is_active_user()
              and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 完成 ----------
-- 执行成功后可到 Table Editor 核对：profiles / sop_templates / tasks / task_results / system_settings
