-- ============================================================
-- 0034：自定义说明变量统一改名为自定义要求
-- 将现有 SOP 模板中的 {{自定义说明}} 全部替换为 {{自定义要求}}
-- 执行位置：Supabase SQL Editor
-- ============================================================

update public.sop_templates
set content = replace(content, '{{自定义说明}}', '{{自定义要求}}')
where content like '%{{自定义说明}}%';

update public.sop_templates
set compliance_redlines = replace(
  compliance_redlines,
  '{{自定义说明}}',
  '{{自定义要求}}'
)
where compliance_redlines like '%{{自定义说明}}%';

-- 完成。
