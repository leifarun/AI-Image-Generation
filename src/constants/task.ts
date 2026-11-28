import type { VxeGlobalRendererHandles } from 'vxe-table'

/** 任务状态统一配置：value 对应数据库枚举，供列表、详情、筛选共用 */
export interface TaskStatusDef {
  value: string
  label: string
  /** Element Plus tag 类型 */
  type: 'info' | 'primary' | 'warning' | 'success' | 'danger'
}

export const TASK_STATUS_LIST: TaskStatusDef[] = [
  { value: 'pending_fetch', label: '待抓取', type: 'info' },
  { value: 'fetching', label: '抓取中', type: 'primary' },
  { value: 'queued', label: '排队中', type: 'primary' },
  { value: 'generating', label: '生成中', type: 'primary' },
  { value: 'succeeded', label: '已完成', type: 'success' },
  { value: 'failed', label: '失败', type: 'danger' }
]

export const FETCH_FAILURE_REASON = '竞品资料抓取失败（反爬、ASIN 找不到、网络错误等）'

/** 仅失败任务展示失败原因。 */
export function getTaskFailureReason(
  status: string | null | undefined,
  errorMessage: string | null | undefined
): string {
  if (status === 'failed') return errorMessage ?? ''
  return ''
}

const STATUS_MAP = new Map(TASK_STATUS_LIST.map((s) => [s.value, s]))

export function getStatusDef(value: string | null | undefined): TaskStatusDef {
  return STATUS_MAP.get(value ?? '') ?? { value: value ?? '', label: value ?? '未知', type: 'info' }
}

export function getStatusLabel(value: string | null | undefined): string {
  return getStatusDef(value).label
}

export function getStatusType(value: string | null | undefined): TaskStatusDef['type'] {
  return getStatusDef(value).type
}

/** 状态标签组件名（供 vxe-table 列渲染用） */
export const STATUS_TAG_COMPONENT = 'TaskStatusTag'
