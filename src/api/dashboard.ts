import { requireSupabase } from '@/api/supabase'
import { fetchTasks, type TaskRow } from '@/api/tasks'
import { calcActualCost } from '@/constants/pricing'

export type DashboardTaskFilter =
  | 'all'
  | 'queued'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'need_input'

export interface DashboardSummary {
  totalTasks: number
  queued: number
  processing: number
  totalSucceeded: number
  totalFailed: number
  totalImages: number
  totalCost: number
  recent: TaskRow[]
}

/**
 * 工作台汇总数据。
 * 数字来自全体员工可见的任务视图，不受任务列表页面当前筛选影响。
 */
export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  const supabase = requireSupabase()

  const [totalResult, queuedResult, processingResult, succeededResult, failedResult, costResult, recentResult] =
    await Promise.all([
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true }),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'queued'),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .in('status', ['fetching', 'generating']),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'succeeded'),
      supabase
        .from('task_view')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
      supabase
        .from('task_view')
        .select('id, result_count, result_models'),
      fetchTasks({ page: 1, pageSize: 8 })
    ])

  const firstError =
    totalResult.error ||
    queuedResult.error ||
    processingResult.error ||
    succeededResult.error ||
    failedResult.error ||
    costResult.error
  if (firstError) throw new Error(firstError.message)

  const costRows = (costResult.data ?? []) as Array<{
    result_count: number
    result_models: string[] | null
  }>
  let totalImages = 0
  let totalCost = 0
  for (const row of costRows) {
    const count = Number(row.result_count ?? 0)
    totalImages += count
    totalCost += calcActualCost(row.result_models)
  }

  return {
    totalTasks: totalResult.count ?? 0,
    queued: queuedResult.count ?? 0,
    processing: processingResult.count ?? 0,
    totalSucceeded: succeededResult.count ?? 0,
    totalFailed: failedResult.count ?? 0,
    totalImages,
    totalCost,
    recent: recentResult.rows
  }
}

/** 看板下钻：按状态读取全体任务明细 */
export async function fetchDashboardTasks(
  filter: DashboardTaskFilter,
  pageSize = 100
): Promise<TaskRow[]> {
  const statusMap: Record<Exclude<DashboardTaskFilter, 'all'>, string[]> = {
    queued: ['queued'],
    processing: ['fetching', 'generating'],
    succeeded: ['succeeded'],
    failed: ['failed'],
    need_input: ['need_input']
  }
  const result = await fetchTasks({
    page: 1,
    pageSize,
    statuses: filter === 'all' ? undefined : statusMap[filter]
  })
  return result.rows
}
