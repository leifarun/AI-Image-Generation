import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// 界面时区：默认北京时间，后续可改为企业/站点配置
export const UI_TIMEZONE = 'Asia/Shanghai'

/** 数据库存 UTC，界面按指定时区显示 */
export function formatDateTime(utcValue: string | null | undefined, pattern = 'YYYY-MM-DD HH:mm'): string {
  if (!utcValue) return '—'
  return dayjs.utc(utcValue).tz(UI_TIMEZONE).format(pattern)
}

export function formatDate(utcValue: string | null | undefined): string {
  return formatDateTime(utcValue, 'YYYY-MM-DD')
}
