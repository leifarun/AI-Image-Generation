-- ============================================================
-- 0020：启用 pg_net（Cron 调度任务处理器的前置依赖）
-- 现象：cron.job 显示任务在运行，但 job_run_details 全部失败：
--       ERROR: schema "net" does not exist
-- 原因：项目从未安装 pg_net，导致 net.http_post 不存在。
-- 执行位置：Supabase SQL Editor
-- ============================================================

create extension if not exists pg_net;

-- 验证扩展已安装
select
  extname as extension_name,
  extversion as installed_version
from pg_extension
where extname = 'pg_net';

-- 验证 Cron 最近一次运行（正常时应为 succeeded）
select
  jobid,
  start_time,
  end_time,
  status,
  return_message
from cron.job_run_details
order by start_time desc
limit 5;
