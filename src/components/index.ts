import type { App } from 'vue'
import StatusTag from '@/components/StatusTag.vue'

/**
 * 全局注册业务组件：这些组件需要被 vxe-table 的列渲染器（JSX/h 函数）使用，
 * 不能只靠模板自动导入，因此在此显式注册。
 */
export function registerGlobalComponents(app: App): void {
  app.component('StatusTag', StatusTag)
}
