import dayjs from 'dayjs'
import { requireSupabase } from '@/api/supabase'
import { fetchTasks, type TaskRow } from '@/api/tasks'

export interface DashboardSummary {
  todayCreated: number
  queued: number
  processing: number
  todayFailed: number
  recent: TaskRow[]
}

/**
 * 工作台汇总数据。
 * 所有数字都来自真实任务视图，搜索/筛选口径不受任务列表页面当前条件影响。
 */
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const supabase = requireSupabase()
  const todayStart = dayjs().startOf('day').toISOString()

  const [todayCreatedResult, queuedResult, processingResult, todayFailedResult, recentResult] =
    await Promise.all([
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayStart),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued'),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'generating'),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed')
        .gte('created_at', todayStart),
      fetchTasks({ page: 1, pageSize: 8 })
    ])

  const firstError =
    todayCreatedResult.error ||
    queuedResult.error ||
    processingResult.error ||
    todayFailedResult.error
  if (firstError) throw new Error(firstError.message)

  return {
    todayCreated: todayCreatedResult.count ?? 0,
    queued: queuedResult.count ?? 0,
    processing: processingResult.count ?? 0,
    todayFailed: todayFailedResult.count ?? 0,
    recent: recentResult.rows
  }
}
