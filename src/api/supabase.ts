import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 前端只允许持有公开键（Publishable Key）；任何 Secret 一律放服务端 */
export const isSupabaseConfigured = Boolean(url && key)

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, key as string)
  : null

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase 未配置：请在 .env 填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY')
  }
  return supabase
}
