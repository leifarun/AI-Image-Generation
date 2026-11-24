import type { VxeTableProps } from 'vxe-table'

declare module 'vue' {
  export interface GlobalComponents {
    VxeTable: VxeTableProps extends never ? never : typeof import('vxe-table')['VxeTable']
    VxeColumn: typeof import('vxe-table')['VxeColumn']
  }
}

export {}
