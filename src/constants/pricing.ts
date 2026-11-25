/**
 * 豆包 Seedream 图片模型单价（元/张）
 * 来源：火山方舟官方《模型价格》页，输出档位按本项目实际使用的
 * 1600×1600（256 万像素 ≤ 261 万像素）取价。
 * 仅用于界面“预计费用”展示，实际扣费以火山方舟账单为准。
 */
export interface DoubaoImagePrice {
  modelId: string
  label: string
  /** 单张输出图价格 */
  outputPrice: number
  /** 单张输入参考图价格（0 表示免费） */
  inputPrice: number
  /** 是否首张输入图免费（Seedream 5.0 Pro 规则） */
  inputFirstFree: boolean
}

export const DOUBAO_IMAGE_PRICES: DoubaoImagePrice[] = [
  {
    modelId: 'doubao-seedream-5-5-261028',
    label: 'Seedream 5.5',
    outputPrice: 0.13,
    inputPrice: 0.05,
    inputFirstFree: false
  },
  {
    modelId: 'doubao-seedream-5-0-pro-260628',
    label: 'Seedream 5.0 Pro',
    outputPrice: 0.3,
    inputPrice: 0.02,
    inputFirstFree: true
  },
  {
    modelId: 'doubao-seedream-5-0-flash-260915',
    label: 'Seedream 5.0 Flash',
    outputPrice: 0.12,
    inputPrice: 0,
    inputFirstFree: false
  },
  {
    modelId: 'doubao-seedream-5-0-260128',
    label: 'Seedream 5.0 Lite',
    outputPrice: 0.22,
    inputPrice: 0,
    inputFirstFree: false
  },
  {
    modelId: 'doubao-seedream-4-5-251128',
    label: 'Seedream 4.5',
    outputPrice: 0.25,
    inputPrice: 0,
    inputFirstFree: false
  },
  {
    modelId: 'doubao-seedream-4-0-250828',
    label: 'Seedream 4.0',
    outputPrice: 0.2,
    inputPrice: 0,
    inputFirstFree: false
  }
]

export const FALLBACK_DOUBAO_MODEL_ID = 'doubao-seedream-5-5-261028'

/** 任务处理器每次最多附带 9 张参考图 */
export const MAX_REFERENCE_IMAGES = 9

/** 按模型 ID 查找单价；未知模型回退到 Seedream 5.5 */
export function getDoubaoImagePrice(modelId: string | null | undefined): DoubaoImagePrice {
  const id = (modelId ?? '').trim()
  const exact = DOUBAO_IMAGE_PRICES.find((item) => item.modelId === id)
  if (exact) return exact

  const byPrefix = DOUBAO_IMAGE_PRICES.find((item) => id.startsWith(item.modelId.replace(/-\d{4,}$/, '')))
  return byPrefix ?? DOUBAO_IMAGE_PRICES[0]
}

/** 单张参考图输入成本（考虑首张免费规则） */
export function calcReferenceInputCost(price: DoubaoImagePrice, referenceCount: number): number {
  const count = Math.max(0, Math.min(referenceCount, MAX_REFERENCE_IMAGES))
  if (count <= 0 || price.inputPrice <= 0) return 0
  const billable = price.inputFirstFree ? count - 1 : count
  return Math.max(0, billable) * price.inputPrice
}

export interface TaskCostEstimate {
  perImageMin: number
  perImageMax: number
  totalMin: number
  totalMax: number
}

export function estimateTaskCost(
  modelId: string | null | undefined,
  imageCount: number,
  referenceCount = 0
): TaskCostEstimate {
  const price = getDoubaoImagePrice(modelId)
  const count = Math.max(0, imageCount)
  const referenceMax = Math.min(referenceCount || MAX_REFERENCE_IMAGES, MAX_REFERENCE_IMAGES)

  const perImageMin = price.outputPrice
  const perImageMax = price.outputPrice + calcReferenceInputCost(price, referenceMax)

  return {
    perImageMin: roundMoney(perImageMin),
    perImageMax: roundMoney(perImageMax),
    totalMin: roundMoney(perImageMin * count),
    totalMax: roundMoney(perImageMax * count)
  }
}

export function formatCostRange(estimate: TaskCostEstimate): string {
  if (estimate.totalMin === estimate.totalMax) {
    return `约 ¥${estimate.totalMin.toFixed(2)}`
  }
  return `约 ¥${estimate.totalMin.toFixed(2)} ~ ¥${estimate.totalMax.toFixed(2)}`
}

/** 单张结果成本：输出图 + 该次实际使用的参考图输入成本 */
export function calcImageCost(
  model: string | null | undefined,
  referenceCount = 0
): number {
  const price = getDoubaoImagePrice(model)
  return roundMoney(price.outputPrice + calcReferenceInputCost(price, referenceCount))
}

/** 已生成图片的实际成本：逐张累加输出图与参考图输入成本 */
export function calcActualCost(
  models: Array<string | null | undefined> | null | undefined,
  referenceCounts: Array<number | null | undefined> | null | undefined = []
): number {
  const list = (models ?? []).filter((m): m is string => Boolean(m))
  const total = list.reduce(
    (sum, model, index) => sum + calcImageCost(model, Number(referenceCounts?.[index] ?? 0)),
    0
  )
  return roundMoney(total)
}

export function formatMoney(value: number): string {
  return `¥${value.toFixed(2)}`
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
