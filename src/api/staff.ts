import { requireSupabase } from '@/api/supabase'

export type StaffRole = 'admin' | 'operator'
export type StaffStatus = 'active' | 'disabled'

export interface StaffRow {
  id: string
  name: string
  login_id: string
  role: StaffRole
  status: StaffStatus
  created_at: string
  updated_at: string
}

export interface CreateStaffInput {
  name: string
  loginId: string
  password: string
  role: StaffRole
}

export interface UpdateStaffInput {
  userId: string
  name: string
  loginId: string
  role: StaffRole
  status: StaffStatus
}

/** 管理员读取员工列表（RLS 会在数据库层再次校验管理员身份） */
export async function fetchStaff(): Promise<StaffRow[]> {
  const supabase = requireSupabase()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, login_id, role, status, created_at, updated_at')
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as StaffRow[]
}

async function invokeStaffAction<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = requireSupabase()
  const { data, error } = await supabase.functions.invoke('manage-staff', { body })

  if (error) {
    let message = error.message
    const context = (error as Error & { context?: Response }).context
    if (context) {
      try {
        const payload = (await context.json()) as { error?: string }
        message = payload.error || message
      } catch {
        // 保留 FunctionsHttpError 的原始提示
      }
    }
    throw new Error(message)
  }

  if (!data || data.ok === false) {
    throw new Error(data?.error || '员工账号操作失败')
  }
  return data as T
}

export async function createStaff(input: CreateStaffInput): Promise<{ userId: string }> {
  return invokeStaffAction({ action: 'create', ...input })
}

export async function updateStaff(input: UpdateStaffInput): Promise<{ userId: string }> {
  return invokeStaffAction({ action: 'update', ...input })
}

export async function resetStaffPassword(userId: string, password: string): Promise<{ userId: string }> {
  return invokeStaffAction({ action: 'reset_password', userId, password })
}
