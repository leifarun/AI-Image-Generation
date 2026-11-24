-- ============================================================
-- 0011：僵尸任务自愈 + 立即重置当前卡住的任务
-- 说明：任务被置为 generating 后若处理器崩溃，会永远卡在"生成中"。
--       这里把"生成中超过 5 分钟"的任务重置回 queued，让处理器重新领取。
-- ============================================================

-- 1. 立即把当前所有"生成中超过 5 分钟"的任务重置为排队中（应急用）
update public.tasks
set status = 'queued',
    error_message = null
where status = 'generating'
  and updated_at < now() - interval '5 minutes';

-- 2. 更激进：立即把当前所有"生成中"任务重置（因为刚发现卡死，直接全部重置一次）
update public.tasks
set status = 'queued',
    error_message = null
where status = 'generating';

-- 完成。重置后，任务会重新被 processor 领取处理。
