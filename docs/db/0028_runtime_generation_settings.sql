-- ============================================================
-- 0028：可在线调整的生成与参考图参数
-- 保存后 process-task 在下一个任务自动读取，无需重新部署函数
-- 执行位置：Supabase SQL Editor
-- ============================================================

insert into public.system_settings (key, value) values
  ('doubao_request_timeout_seconds', '130'::jsonb),
  ('output_width', '1600'::jsonb),
  ('output_height', '1600'::jsonb),
  ('output_format', '"jpeg"'::jsonb),
  ('output_max_mb', '2'::jsonb),
  ('reference_max_edge', '800'::jsonb),
  ('reference_jpeg_quality', '88'::jsonb),
  ('reference_max_total_mb', '8'::jsonb)
on conflict (key) do nothing;

-- 完成。
