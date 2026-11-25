import dayjs from 'dayjs'
import { requireSupabase } from '@/api/supabase'
import { fetchTasks, type TaskRow } from '@/api/tasks'
import { calcActualCost } from '@/constants/pricing'

export interface DashboardSummary {
  todayCreated: number
  queued: number
  processing: number
  todayFailed: number
  totalImages: number
  totalCost: number
  todayCost: number
  recent: TaskRow[]
}

/**
 * 工作台汇总数据。
 * 所有数字都来自真实任务视图，搜索/筛选口径不受任务列表页面当前条件影响。
 */
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const supabase = requireSupabase()
  const todayStart = dayjs().startOf('day').toISOString()

  const [todayCreatedResult, queuedResult, processingResult, todayFailedResult, costResult, recentResult] =
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
      supabase
        .from('task_view')
        .select('id, created_at, result_count, result_models'),
      fetchTasks({ page: 1, pageSize: 8 })
    ])

  const firstError =
    todayCreatedResult.error ||
    queuedResult.error ||
    processingResult.error ||
    todayFailedResult.error ||
    costResult.error
  if (firstError) throw new Error(firstError.message)

  const costRows = (costResult.data ?? []) as Array<{
    created_at: string
    result_count: number
    result_models: string[] | null
  }>
  let totalImages = 0
  let totalCost = 0
  let todayCost = 0
  for (const row of costRows) {
    const count = Number(row.result_count ?? 0)
    const cost = calcActualCost(row.result_models)
    totalImages += count
    totalCost += cost
    if (row.created_at >= todayStart) todayCost += cost
  }

  return {
    todayCreated: todayCreatedResult.count ?? 0,
    queued: queuedResult.count ?? 0,
    processing: processingResult.count ?? 0,
    todayFailed: todayFailedResult.count ?? 0,
    totalImages,
    totalCost,
    todayCost,
    recent: recentResult.rows
  }
}
