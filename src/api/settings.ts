import { requireSupabase } from '@/api/supabase'
import { FALLBACK_DOUBAO_MODEL_ID } from '@/constants/pricing'

export interface SystemSettings {
  max_concurrent_tasks: number
  max_requests_per_minute: number
  default_doubao_model: string
  marketplaces: string[]
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  max_concurrent_tasks: 2,
  max_requests_per_minute: 10,
  default_doubao_model: 'doubao-seedream-4-5-251128',
  marketplaces: ['US', 'UK', 'DE', 'JP', 'CA', 'FR', 'IT', 'ES', 'AU', 'AE', 'SA']
}

interface SettingRow {
  key: string
  value: unknown
}

/** 读取管理员可调的系统参数，并为缺失项补上安全默认值 */
export async function fetchSystemSettings(): Promise<SystemSettings> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.from('system_settings').select('key,value')
  if (error) throw new Error(error.message)

  const values = Object.fromEntries(
    ((data ?? []) as SettingRow[]).map((row) => [row.key, row.value])
  )

  return {
    max_concurrent_tasks: toPositiveInt(
      values.max_concurrent_tasks,
      DEFAULT_SYSTEM_SETTINGS.max_concurrent_tasks
    ),
    max_requests_per_minute: toPositiveInt(
      values.max_requests_per_minute,
      DEFAULT_SYSTEM_SETTINGS.max_requests_per_minute
    ),
    default_doubao_model:
      typeof values.default_doubao_model === 'string' && values.default_doubao_model.trim()
        ? values.default_doubao_model.trim()
        : DEFAULT_SYSTEM_SETTINGS.default_doubao_model,
    marketplaces: Array.isArray(values.marketplaces)
      ? values.marketplaces.filter((item): item is string => typeof item === 'string')
      : DEFAULT_SYSTEM_SETTINGS.marketplaces
  }
}

/** 读取当前默认豆包模型（运营提交任务前估算费用时也需要） */
export async function fetchDefaultDoubaoModel(): Promise<string> {
  const supabase = requireSupabase()

  // 管理员可直读系统设置，保证切换模型后费用估算立即跟随
  const { data: direct, error: directError } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'default_doubao_model')
    .maybeSingle()
  if (!directError && typeof direct?.value === 'string' && direct.value.trim()) {
    return direct.value.trim()
  }

  // 运营无法直读 system_settings，走 0022 提供的安全函数
  const { data, error } = await supabase.rpc('get_default_doubao_model')
  if (error) return FALLBACK_DOUBAO_MODEL_ID
  return typeof data === 'string' && data.trim() ? data.trim() : FALLBACK_DOUBAO_MODEL_ID
}

/** 读取管理员配置的可用站点；普通员工通过安全函数读取 */
export async function fetchSupportedMarketplaces(): Promise<string[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc('get_supported_marketplaces')
  if (error) return DEFAULT_SYSTEM_SETTINGS.marketplaces
  if (!Array.isArray(data)) return DEFAULT_SYSTEM_SETTINGS.marketplaces
  return data.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
}

/** 逐项保存管理员的运行参数 */
export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  const supabase = requireSupabase()
  const entries: Array<[keyof SystemSettings, SystemSettings[keyof SystemSettings]]> = [
    ['max_concurrent_tasks', settings.max_concurrent_tasks],
    ['max_requests_per_minute', settings.max_requests_per_minute],
    ['default_doubao_model', settings.default_doubao_model.trim()],
    ['marketplaces', settings.marketplaces]
  ]

  for (const [key, value] of entries) {
    const { data, error } = await supabase
      .from('system_settings')
      .update({ value, updated_at: new Date().toISOString() })
      .eq('key', key)
      .select('key')
    if (error) throw new Error(`${key} 保存失败：${error.message}`)
    if (!data?.length) throw new Error(`系统设置缺少 ${key} 记录，请联系开发人员补建`)
  }
}

function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
