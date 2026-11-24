-- ============================================================
-- 0018：支持的亚马逊站点加入 AE（阿联酋）和 SA（沙特）
-- ============================================================

update public.system_settings
set value = '["US","UK","DE","JP","CA","FR","IT","ES","AU","AE","SA"]'::jsonb,
    updated_at = now()
where key = 'marketplaces';
