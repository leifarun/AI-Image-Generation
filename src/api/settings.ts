import { requireSupabase } from '@/api/supabase'
import { FALLBACK_DOUBAO_MODEL_ID } from '@/constants/pricing'

export interface SystemSettings {
  max_concurrent_tasks: number
  max_requests_per_minute: number
  default_doubao_model: string
  marketplaces: string[]
  doubao_request_timeout_seconds: number
  output_width: number
  output_height: number
  output_format: 'jpeg' | 'png'
  output_max_mb: number
  reference_max_edge: number
  reference_jpeg_quality: number
  reference_max_total_mb: number
  reference_image_limit: number
}

export const DEFAULT_SYSTEM_SETTINGS: SystemSettings = {
  max_concurrent_tasks: 2,
  max_requests_per_minute: 10,
  default_doubao_model: 'doubao-seedream-4-5-251128',
  marketplaces: ['US', 'UK', 'DE', 'JP', 'CA', 'FR', 'IT', 'ES', 'AU', 'AE', 'SA'],
  doubao_request_timeout_seconds: 130,
  output_width: 1600,
  output_height: 1600,
  output_format: 'jpeg',
  output_max_mb: 2,
  reference_max_edge: 800,
  reference_jpeg_quality: 88,
  reference_max_total_mb: 8,
  reference_image_limit: 9
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
      : DEFAULT_SYSTEM_SETTINGS.marketplaces,
    doubao_request_timeout_seconds: toNumberInRange(
      values.doubao_request_timeout_seconds,
      30,
      130,
      DEFAULT_SYSTEM_SETTINGS.doubao_request_timeout_seconds
    ),
    output_width: toNumberInRange(
      values.output_width,
      512,
      4096,
      DEFAULT_SYSTEM_SETTINGS.output_width
    ),
    output_height: toNumberInRange(
      values.output_height,
      512,
      4096,
      DEFAULT_SYSTEM_SETTINGS.output_height
    ),
    output_format: values.output_format === 'png' ? 'png' : 'jpeg',
    output_max_mb: toNumberInRange(
      values.output_max_mb,
      1,
      10,
      DEFAULT_SYSTEM_SETTINGS.output_max_mb
    ),
    reference_max_edge: toNumberInRange(
      values.reference_max_edge,
      256,
      2048,
      DEFAULT_SYSTEM_SETTINGS.reference_max_edge
    ),
    reference_jpeg_quality: toNumberInRange(
      values.reference_jpeg_quality,
      50,
      95,
      DEFAULT_SYSTEM_SETTINGS.reference_jpeg_quality
    ),
    reference_max_total_mb: toNumberInRange(
      values.reference_max_total_mb,
      1,
      32,
      DEFAULT_SYSTEM_SETTINGS.reference_max_total_mb
    ),
    reference_image_limit: toNumberInRange(
      values.reference_image_limit,
      1,
      9,
      DEFAULT_SYSTEM_SETTINGS.reference_image_limit
    )
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

/** 运营估算成本时读取当前实际发送的参考图数量 */
export async function fetchReferenceImageLimit(): Promise<number> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.rpc('get_reference_image_limit')
  if (error) return DEFAULT_SYSTEM_SETTINGS.reference_image_limit
  return toNumberInRange(
    data,
    1,
    9,
    DEFAULT_SYSTEM_SETTINGS.reference_image_limit
  )
}

/** 逐项保存管理员的运行参数 */
export async function saveSystemSettings(settings: SystemSettings): Promise<void> {
  const supabase = requireSupabase()
  const entries: Array<[keyof SystemSettings, SystemSettings[keyof SystemSettings]]> = [
    ['max_concurrent_tasks', settings.max_concurrent_tasks],
    ['max_requests_per_minute', settings.max_requests_per_minute],
    ['default_doubao_model', settings.default_doubao_model.trim()],
    ['marketplaces', settings.marketplaces],
    ['doubao_request_timeout_seconds', settings.doubao_request_timeout_seconds],
    ['output_width', settings.output_width],
    ['output_height', settings.output_height],
    ['output_format', settings.output_format],
    ['output_max_mb', settings.output_max_mb],
    ['reference_max_edge', settings.reference_max_edge],
    ['reference_jpeg_quality', settings.reference_jpeg_quality],
    ['reference_max_total_mb', settings.reference_max_total_mb],
    ['reference_image_limit', settings.reference_image_limit]
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

function toNumberInRange(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}
