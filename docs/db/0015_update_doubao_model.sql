-- ============================================================
-- 0015：更新豆包图片模型默认值
-- 火山方舟当前可访问的模型 ID 可直接填写，不要求 ep- 接入点 ID。
-- 4.5 支持文本+参考图生图，适合当前商品卖点图流程。
-- ============================================================

insert into public.system_settings (key, value)
values ('default_doubao_model', '"doubao-seedream-4-5-251128"'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

-- 确保管理员页面可以保存设置
grant select, update on public.system_settings to authenticated;
grant select, update on public.system_settings to service_role;
