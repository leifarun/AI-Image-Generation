-- ============================================================
-- 0002（v3）：把账号 elfredariffon@gmail.com 设为管理员，登录 ID 设为"雷发润"
-- 直接复制本文件全部内容运行即可，无需修改任何内容
-- ============================================================

update public.profiles
set login_id = '雷发润',
    role = 'admin',
    status = 'active'
where id = (
  select id from auth.users where email = 'elfredariffon@gmail.com'
);

-- 验证：运行下面这行（去掉注释）可查看结果，应看到 login_id=雷发润、role=admin
-- select p.login_id, p.role, p.status, u.email
-- from public.profiles p join auth.users u on u.id = p.id
-- where u.email = 'elfredariffon@gmail.com';
