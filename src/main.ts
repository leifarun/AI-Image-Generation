import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import VxeUIAll from 'vxe-pc-ui'
import 'vxe-pc-ui/lib/style.css'
import VxeUITable from 'vxe-table'
import 'vxe-table/lib/style.css'
import App from './App.vue'
import router from './router'
import { useUserStore } from '@/stores/user'
import { isSupabaseConfigured, supabase } from '@/api/supabase'
import { registerGlobalComponents } from '@/components/index'
// ElMessage / ElMessageBox / ElNotification 是命令式调用（不在模板里），
// 按需自动引入无法为它们注入样式，必须手动引入，否则错误提示会"隐形"
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/notification/style/css'
import '@/styles/index.scss'

const app = createApp(App)

// 防白屏保险丝：任何未捕获的代码错误都会在页面上显示红色错误条，而不是无声白屏
app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[全局错误]', info, err)
  const message = err instanceof Error ? err.message : String(err)
  const banner = document.createElement('div')
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99999;background:#fef0f0;color:#c45656;padding:8px 16px;font:13px sans-serif;border-bottom:1px solid #fbc4c4;white-space:pre-wrap;'
  banner.textContent = `页面发生错误：${message}（请联系开发负责人，截图反馈）`
  document.body.appendChild(banner)
}

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
app.use(pinia)

// 接通 Supabase 后：先恢复已有会话，再订阅登录状态变化，最后挂载
const userStore = useUserStore()
if (isSupabaseConfigured && supabase) {
  await userStore.restoreSession()
  supabase.auth.onAuthStateChange((_event, session) => {
    userStore.applySession(session)
  })
}

app.use(router)
// vxe-table 4.x 要求先注册 vxe-pc-ui（基础组件库），再注册 vxe-table（表格）
app.use(VxeUIAll)
app.use(VxeUITable)
registerGlobalComponents(app)
app.mount('#app')
