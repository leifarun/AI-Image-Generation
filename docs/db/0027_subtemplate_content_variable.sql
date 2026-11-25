-- ============================================================
-- 0027：子模板内容变量
-- 1) 现有母模板若包含子模板但尚未使用 {{子模板内容}}，在末尾补上变量，
--    保持原先“自动追加子模板内容”的行为，后续可移动到任意位置。
-- 2) 清理子模板的合规红线字段，合规红线统一由母模板维护。
-- 执行位置：Supabase SQL Editor
-- ============================================================

-- 已手写旧变量时，先移除此前自动补在末尾的新变量，避免重复执行。
update public.sop_templates
set
  content = regexp_replace(content, E'\\n\\n\\{\\{子模板内容\\}\\}\\s*$', ''),
  updated_at = now()
where parent_id is null
  and (
    position('{{指定子模版}}' in content) > 0
    or position('{{指定子模板}}' in content) > 0
  )
  and content ~ E'\\n\\n\\{\\{子模板内容\\}\\}\\s*$';

-- 统一旧变量名。
update public.sop_templates
set
  content = replace(
    replace(content, '{{指定子模版}}', '{{子模板内容}}'),
    '{{指定子模板}}',
    '{{子模板内容}}'
  ),
  updated_at = now()
where parent_id is null
  and (
    position('{{指定子模版}}' in content) > 0
    or position('{{指定子模板}}' in content) > 0
  );

update public.sop_templates parent
set
  content = rtrim(parent.content) || E'\n\n{{子模板内容}}',
  updated_at = now()
where parent.parent_id is null
  and exists (
    select 1
    from public.sop_templates child
    where child.parent_id = parent.id
  )
  and position('{{子模板内容}}' in parent.content) = 0;

update public.sop_templates
set
  compliance_redlines = '',
  updated_at = now()
where parent_id is not null
  and compliance_redlines <> '';

-- 完成。
