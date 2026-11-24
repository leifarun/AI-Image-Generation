// ============================================================
// manage-staff Edge Function：管理员创建/编辑员工与重置密码
// 使用 service_role 调用 Auth Admin API；调用者必须是启用中的管理员。
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

interface ProfileRow {
  id: string
  name: string
  login_id: string
  role: 'admin' | 'operator'
  status: 'active' | 'disabled'
}

interface RequestBody {
  action?: 'create' | 'update' | 'reset_password'
  userId?: string
  name?: string
  loginId?: string
  password?: string
  role?: 'admin' | 'operator'
  status?: 'active' | 'disabled'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return json({ ok: true, service: 'manage-staff' })
  }

  if (req.method !== 'POST') {
    return json({ ok: false, error: '仅支持 POST 请求' }, 405)
  }

  try {
    const requester = await requireAdmin(req)
    const body = (await req.json()) as RequestBody

    if (body.action === 'create') {
      return json(await createStaff(body))
    }
    if (body.action === 'update') {
      return json(await updateStaff(body, requester.id))
    }
    if (body.action === 'reset_password') {
      return json(await resetPassword(body))
    }
    return json({ ok: false, error: '未知操作' }, 400)
  } catch (e) {
    console.error('[manage-staff]', e)
    const message = e instanceof Error ? e.message : String(e)
    return json({ ok: false, error: message }, errorStatus(message))
  }
})

async function requireAdmin(req: Request): Promise<ProfileRow> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) throw new Error('登录状态已失效，请重新登录')

  const { data: authData, error: authError } = await supabase.auth.getUser(token)
  if (authError || !authData.user) throw new Error('登录状态已失效，请重新登录')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, login_id, role, status')
    .eq('id', authData.user.id)
    .single()

  if (profileError || !profile) throw new Error('账号资料不存在')
  if (profile.role !== 'admin' || profile.status !== 'active') {
    throw new Error('仅启用中的管理员可管理员工账号')
  }
  return profile as ProfileRow
}

async function createStaff(body: RequestBody): Promise<Record<string, unknown>> {
  const name = validateName(body.name)
  const loginId = validateLoginId(body.loginId)
  const password = validatePassword(body.password)
  const role = validateRole(body.role)

  await ensureLoginIdAvailable(loginId)

  // Auth 底层仍要求唯一邮箱；这里生成内部标识，员工端仍只用登录 ID。
  // 该邮箱不用于收信，也不会展示给员工。
  const internalEmail = `login-${crypto.randomUUID()}@aipic.local`

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: { name, login_id: loginId }
  })

  if (createError || !created.user) {
    throw new Error(`创建登录账号失败：${createError?.message ?? '未知错误'}`)
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ name, login_id: loginId, role, status: 'active' })
    .eq('id', created.user.id)

  if (profileError) {
    await supabase.auth.admin.deleteUser(created.user.id)
    if (/duplicate|unique/i.test(profileError.message)) {
      throw new Error('登录 ID 已被使用')
    }
    throw new Error(`创建员工资料失败：${profileError.message}`)
  }

  return { ok: true, userId: created.user.id }
}

async function updateStaff(body: RequestBody, requesterId: string): Promise<Record<string, unknown>> {
  const userId = validateUserId(body.userId)
  const name = validateName(body.name)
  const loginId = validateLoginId(body.loginId)
  const role = validateRole(body.role)
  const status = validateStatus(body.status)

  const target = await getProfile(userId)
  if (userId === requesterId && (role !== 'admin' || status !== 'active')) {
    throw new Error('不能停用自己或将当前账号降为运营')
  }

  await ensureLoginIdAvailable(loginId, userId)

  if (target.role === 'admin' && target.status === 'active' && (role !== 'admin' || status !== 'active')) {
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
      .eq('status', 'active')
    if (error) throw new Error(error.message)
    if ((count ?? 0) <= 1) throw new Error('系统至少需要保留一名启用中的管理员')
  }

  const { error } = await supabase
    .from('profiles')
    .update({ name, login_id: loginId, role, status })
    .eq('id', userId)
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('登录 ID 已被使用')
    throw new Error(`更新员工资料失败：${error.message}`)
  }

  await supabase.auth.admin.updateUserById(userId, { user_metadata: { name, login_id: loginId } })
  return { ok: true, userId }
}

async function resetPassword(body: RequestBody): Promise<Record<string, unknown>> {
  const userId = validateUserId(body.userId)
  const password = validatePassword(body.password)
  await getProfile(userId)

  const { error } = await supabase.auth.admin.updateUserById(userId, { password })
  if (error) throw new Error(`重置密码失败：${error.message}`)
  return { ok: true, userId }
}

async function getProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, login_id, role, status')
    .eq('id', userId)
    .single()
  if (error || !data) throw new Error('员工账号不存在')
  return data as ProfileRow
}

async function ensureLoginIdAvailable(loginId: string, excludeId?: string): Promise<void> {
  let query = supabase.from('profiles').select('id').ilike('login_id', loginId)
  if (excludeId) query = query.neq('id', excludeId)
  const { data, error } = await query.limit(1)
  if (error) throw new Error(error.message)
  if (data?.length) throw new Error('登录 ID 已被使用')
}

function validateUserId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('员工账号标识无效')
  }
  return id
}

function validateName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (name.length < 1 || name.length > 50) throw new Error('姓名需为 1~50 个字符')
  return name
}

function validateLoginId(value: unknown): string {
  const loginId = String(value ?? '').trim()
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(loginId)) {
    throw new Error('登录 ID 需为 2~32 个字母、数字、下划线或短横线')
  }
  return loginId
}

function validatePassword(value: unknown): string {
  const password = String(value ?? '')
  if (password.length < 8 || password.length > 72) {
    throw new Error('密码需为 8~72 个字符')
  }
  return password
}

function validateRole(value: unknown): 'admin' | 'operator' {
  if (value !== 'admin' && value !== 'operator') throw new Error('员工角色无效')
  return value
}

function validateStatus(value: unknown): 'active' | 'disabled' {
  if (value !== 'active' && value !== 'disabled') throw new Error('账号状态无效')
  return value
}

function errorStatus(message: string): number {
  if (/登录状态|管理员|无权/.test(message)) return 403
  if (/无效|不存在|已被使用|已存在|格式|需为|至少/.test(message)) return 400
  return 500
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}
