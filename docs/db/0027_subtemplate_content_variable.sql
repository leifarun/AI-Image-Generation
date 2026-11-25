-- ============================================================
-- 0027：子模板内容变量
-- 1) 现有母模板若包含子模板但尚未使用 {{子模板内容}}，在末尾补上变量，
--    保持原先“自动追加子模板内容”的行为，后续可移动到任意位置。
-- 2) 清理子模板的合规红线字段，合规红线统一由母模板维护。
-- 执行位置：Supabase SQL Editor
-- ============================================================

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
