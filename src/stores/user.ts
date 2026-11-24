import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { isSupabaseConfigured, requireSupabase } from '@/api/supabase'
import type { User } from '@supabase/supabase-js'

export type Role = 'admin' | 'operator'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
  /** 预览模式下的虚拟身份，仅用于浏览界面骨架 */
  preview?: boolean
}

interface ProfileRow {
  id: string
  name: string
  role: Role
  status: 'active' | 'disabled'
}

export const useUserStore = defineStore(
  'user',
  () => {
    const user = ref<SessionUser | null>(null)

    const isAuthenticated = computed(() => user.value !== null)
    const role = computed<Role | null>(() => user.value?.role ?? null)
    const isPreview = computed(() => user.value?.preview === true)
    const name = computed(() => user.value?.name ?? '')
    const previewModeEnabled = import.meta.env.VITE_PREVIEW_MODE === 'true'

    /** 从 profiles 表读取员工资料；校验状态与建档 */
    async function fetchProfile(authUser: User): Promise<SessionUser> {
      const supabase = requireSupabase()
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, role, status')
        .eq('id', authUser.id)
        .single<ProfileRow>()

      if (error || !data) {
        await supabase.auth.signOut()
        throw new Error('账号尚未建档，请联系管理员在后台创建账号')
      }
      if (data.status === 'disabled') {
        await supabase.auth.signOut()
        throw new Error('账号已被停用，请联系管理员')
      }
      return {
        id: data.id,
        email: authUser.email ?? '',
        name: data.name || authUser.email?.split('@')[0] || '',
        role: data.role
      }
    }

    /** 登录：登录名 + 密码 → 系统定位真实账号 → 认证 → 拉取角色资料 */
    async function login(loginId: string, password: string): Promise<void> {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase 尚未接通：请检查 .env 配置')
      }
      const supabase = requireSupabase()

      // 第 1 步：用登录名反查真实账号邮箱（ID 全局唯一，登录名不区分大小写）
      const { data: emailData, error: lookupError } = await supabase
        .rpc('get_user_email_by_login_id', { p_login_id: loginId })

      if (lookupError || !emailData) {
        throw new Error('登录名或密码错误')
      }

      // 第 2 步：用真实邮箱 + 密码认证
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailData as string,
        password
      })
      if (error) throw new Error('登录名或密码错误')
      if (data.user) {
        user.value = await fetchProfile(data.user)
      }
    }

    /** 应用启动时恢复已有会话（避免刷新后掉登录） */
    async function restoreSession(): Promise<void> {
      if (!isSupabaseConfigured) return
      const supabase = requireSupabase()
      // 给会话恢复加超时保护：极端情况下浏览器存储/网络卡住也不应导致白屏
      const result = await Promise.race([
        supabase.auth.getSession(),
        new Promise<{ data: { session: null } }>((resolve) => {
          setTimeout(() => resolve({ data: { session: null } }), 5000)
        })
      ])
      if (result.data.session?.user) {
        try {
          user.value = await fetchProfile(result.data.session.user)
        } catch (e) {
          // 资料异常时清理本地残留会话
          user.value = null
          // eslint-disable-next-line no-console
          console.warn('[restoreSession] 恢复会话失败:', e)
        }
      } else {
        user.value = null
      }
    }

    /** 订阅认证状态变化（登录/登出/Token 刷新） */
    function applySession(session: { user: User | null } | null): void {
      if (session?.user) {
        void fetchProfile(session.user)
          .then((u) => {
            user.value = u
          })
          .catch((e) => {
            user.value = null
            // eslint-disable-next-line no-console
            console.warn('[applySession] 资料获取失败:', e)
          })
      } else {
        user.value = null
      }
    }

    function enterPreview() {
      user.value = {
        id: 'preview',
        email: 'preview@local',
        name: '界面预览',
        role: 'admin',
        preview: true
      }
    }

    function logout() {
      user.value = null
      if (isSupabaseConfigured) {
        void requireSupabase().auth.signOut()
      }
    }

    return {
      user,
      isAuthenticated,
      role,
      isPreview,
      name,
      previewModeEnabled,
      login,
      restoreSession,
      applySession,
      enterPreview,
      logout
    }
  },
  {
    persist: true
  }
)
