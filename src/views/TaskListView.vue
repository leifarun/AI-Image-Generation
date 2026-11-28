<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleClose, Search } from '@element-plus/icons-vue'
import type { VxeGridProps, VxeGridInstance } from 'vxe-table'
import { useWindowSize } from '@vueuse/core'
import dayjs from 'dayjs'
import {
  fetchTasks,
  deleteTask,
  type TaskRow
} from '@/api/tasks'
import { TASK_STATUS_LIST, getStatusLabel } from '@/constants/task'
import { MARKETPLACE_OPTIONS, formatMarketplaceLabel } from '@/constants/marketplace'
import { calcActualCost, formatDoubaoModelLabel, formatMoney } from '@/constants/pricing'
import { formatDateTime } from '@/utils/datetime'
import { useUserStore } from '@/stores/user'

defineOptions({ name: 'TaskListView' })

const userStore = useUserStore()
const router = useRouter()
const isAdmin = computed(() => userStore.role === 'admin')
const gridRef = ref<VxeGridInstance>()
const { width: viewportWidth, height: viewportHeight } = useWindowSize()
const gridHeight = computed(() =>
  Math.max(360, viewportHeight.value - (viewportWidth.value < 1100 ? 330 : 220))
)

const filters = reactive({
  asin: '',
  status: '',
  marketplace: '',
  brand: '',
  creator: '',
  dateRange: [] as string[]
})

const parsedAsins = computed(() =>
  [...new Set(
    filters.asin
      .split(/[\s,，;；]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean)
  )]
)

const tableData = ref<TaskRow[]>([])
const loading = ref(false)
const selectedRows = ref<TaskRow[]>([])
const total = ref(0)
const page = reactive({ current: 1, size: 20 })
let lastLoadedAt = 0
const CACHE_TTL_MS = 30_000

async function loadData() {
  loading.value = true
  try {
    const result = await fetchTasks({
      page: page.current,
      pageSize: page.size,
      asins: parsedAsins.value.length ? parsedAsins.value : undefined,
      status: filters.status || undefined,
      marketplace: filters.marketplace || undefined,
      brand: filters.brand.trim() || undefined,
      creator: filters.creator.trim() || undefined,
      from: filters.dateRange[0] ? new Date(filters.dateRange[0]).toISOString() : undefined,
      to: filters.dateRange[1] ? new Date(filters.dateRange[1]).toISOString() : undefined
    })
    tableData.value = result.rows
    total.value = result.total
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载任务失败')
  } finally {
    loading.value = false
    lastLoadedAt = Date.now()
  }
}

function taskQuery(pageNumber: number, pageSize: number) {
  return {
    page: pageNumber,
    pageSize,
    asins: parsedAsins.value.length ? parsedAsins.value : undefined,
    status: filters.status || undefined,
    marketplace: filters.marketplace || undefined,
    brand: filters.brand.trim() || undefined,
    creator: filters.creator.trim() || undefined,
    from: filters.dateRange[0] ? new Date(filters.dateRange[0]).toISOString() : undefined,
    to: filters.dateRange[1] ? new Date(filters.dateRange[1]).toISOString() : undefined
  }
}

async function fetchAllFilteredTasks(): Promise<TaskRow[]> {
  const rows: TaskRow[] = []
  let current = 1
  let expectedTotal = 0
  while (true) {
    const result = await fetchTasks(taskQuery(current, 1000))
    rows.push(...result.rows)
    expectedTotal = result.total
    if (!result.rows.length || rows.length >= expectedTotal) break
    current++
  }
  return rows
}

function clearSelection() {
  selectedRows.value = []
  gridRef.value?.clearCheckboxRow()
}

function handleSelectionChange({ records }: { records: TaskRow[] }) {
  selectedRows.value = records
}

function handleSearch() {
  if (parsedAsins.value.length > 100) {
    ElMessage.warning(`最多查询 100 个 ASIN，当前识别到 ${parsedAsins.value.length} 个`)
    return
  }
  page.current = 1
  clearSelection()
  loadData()
}

function handleReset() {
  filters.asin = ''
  filters.status = ''
  filters.marketplace = ''
  filters.brand = ''
  filters.creator = ''
  filters.dateRange = []
  page.current = 1
  clearSelection()
  loadData()
}

function progressText(row: TaskRow): string {
  const done = Number(row.result_count ?? 0)
  const total = Math.max(1, Number(row.image_count ?? 0))
  return `${done}/${total}`
}

function modelText(row: TaskRow): string {
  return formatDoubaoModelLabel(row.model || row.result_models?.[0])
}

async function exportCsv() {
  try {
    const rows = selectedRows.value.length
      ? [...selectedRows.value]
      : await fetchAllFilteredTasks()
    const header = ['ASIN', '站点', '竞品品牌', '竞品标题', '模板', '模型', '提交人', '状态', '进度', '实际成本', '提交时间', '失败原因']
    const body = rows.map((r) => [
      r.asin,
      r.marketplace,
      r.brand_name ?? '',
      r.product_title ?? '',
      r.template_name ?? '',
      modelText(r),
      r.creator_name ?? '',
      getStatusLabel(r.status),
      progressText(r),
      Number(r.actual_cost ?? calcActualCost(r.result_models, r.result_reference_counts)).toFixed(2),
      formatDateTime(r.created_at),
      r.error_message ?? ''
    ])
    const csv = [header, ...body]
      .map((cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `任务导出-${dayjs().format('YYYYMMDD-HHmm')}.csv`
    link.click()
    URL.revokeObjectURL(url)
    ElMessage.success(
      `已导出 ${rows.length} 条${selectedRows.value.length ? '勾选' : '筛选'}任务`
    )
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '导出失败')
  }
}

async function handleDelete(row: TaskRow) {
  try {
    await ElMessageBox.confirm(
      `确定删除该任务（ASIN: ${row.asin}）吗？删除后结果图片也将一并删除。`,
      '确认删除任务？',
      {
        type: 'warning',
        confirmButtonText: '确认删除',
        cancelButtonText: '取消',
        closeOnClickModal: false,
        closeOnPressEscape: false,
        showClose: false
      }
    )
  } catch {
    return
  }
  try {
    await deleteTask(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

function openResults(row: TaskRow) {
  router.push(`/tasks/${row.id}`)
}

function handlePageChange({ currentPage, pageSize }: { currentPage: number; pageSize: number }) {
  page.current = currentPage
  page.size = pageSize
  loadData()
}

function autoLoad() {
  if (Date.now() - lastLoadedAt > CACHE_TTL_MS) loadData()
}

onMounted(() => {
  loadData()
})

onActivated(() => {
  autoLoad()
  gridRef.value?.recalculate()
})

const gridOptions = reactive<VxeGridProps>({
  border: true,
  showOverflow: true,
  height: gridHeight.value,
  minHeight: 320,
  rowConfig: { keyField: 'id' },
  checkboxConfig: { reserve: true, highlight: true },
  columnConfig: { resizable: true },
  columns: [
    { type: 'checkbox', width: 44, fixed: 'left' },
    { type: 'seq', width: 44, fixed: 'left', title: '#' },
    { field: 'created_at', title: '提交时间', width: 136, fixed: 'left', formatter: ({ cellValue }) => formatDateTime(cellValue) },
    { field: 'creator_name', title: '提交人', width: 82, fixed: 'left' },
    { field: 'asin', title: 'ASIN', width: 112, fixed: 'left' },
    { field: 'marketplace', title: '站点', width: 62 },
    { field: 'selling_points', title: '竞品卖点补充', width: 188, showOverflow: true },
    { field: 'template_name', title: '模板', width: 140, showOverflow: true },
    { field: 'model', title: '模型', width: 180, formatter: ({ row }) => modelText(row) },
    { title: '实际成本', width: 86, visible: isAdmin.value, slots: { default: 'cost' } },
    {
      field: 'status',
      title: '当前状态',
      width: 86,
      slots: { default: 'status' }
    },
    { title: '进度', width: 72, slots: { default: 'progress' } },
    {
      field: 'error_message',
      title: '失败原因',
      width: 315,
      showOverflow: true
    },
    { title: '生成结果', width: 77, fixed: 'right', slots: { default: 'results' } },
    {
      title: '操作',
      width: 68,
      fixed: 'right',
      showOverflow: false,
      slots: { default: 'action' }
    }
  ],
  pagerConfig: {
    pageSize: page.size,
    currentPage: page.current,
    total: total.value,
    pageSizes: [10, 20, 50, 100],
    layouts: ['Total', 'Sizes', 'PrevPage', 'Number', 'NextPage', 'FullJump']
  }
})

watch(gridHeight, (height) => {
  gridOptions.height = height
  gridRef.value?.recalculate()
})
</script>

<template>
  <div class="task-list">
    <el-card shadow="never" class="table-card">
      <div class="table-toolbar">
        <div class="search-box">
          <el-input
            v-model="filters.asin"
            class="asin-input"
            placeholder="搜索 ASIN，支持批量（最多 100 个）"
            @keyup.enter="handleSearch"
          >
            <template #prefix>
              <el-icon class="search-icon" @click="handleSearch"><Search /></el-icon>
            </template>
            <template #suffix>
              <el-icon
                v-if="filters.asin"
                class="clear-icon"
                title="清空"
                @click.stop="filters.asin = ''"
              >
                <CircleClose />
              </el-icon>
              <span class="asin-total" :class="{ danger: parsedAsins.length > 100 }">
                {{ parsedAsins.length }}/100
              </span>
            </template>
          </el-input>
        </div>

        <div class="status-wrap">
          <el-select
            v-model="filters.status"
            placeholder="状态"
            clearable
            class="status-filter"
          >
            <el-option v-for="o in TASK_STATUS_LIST" :key="o.value" :value="o.value" :label="o.label" />
          </el-select>
        </div>

        <el-select
          v-model="filters.marketplace"
          placeholder="站点"
          clearable
          filterable
          class="marketplace-filter"
        >
          <el-option
            v-for="o in MARKETPLACE_OPTIONS"
            :key="o.code"
            :value="o.code"
            :label="formatMarketplaceLabel(o.code)"
          />
        </el-select>

        <el-input
          v-model="filters.brand"
          class="brand-filter"
          placeholder="竞品品牌"
          clearable
          @keyup.enter="handleSearch"
        />

        <el-input
          v-model="filters.creator"
          class="creator-filter"
          placeholder="提交人"
          clearable
          @keyup.enter="handleSearch"
        />

        <div class="date-wrap">
          <el-date-picker
            v-model="filters.dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            class="date-filter"
          />
        </div>

        <el-button class="reset-button" @click="handleReset">重置</el-button>
        <el-button class="export-button" @click="exportCsv">导出 CSV</el-button>
        <el-button type="primary" class="create-button" @click="router.push('/tasks/new')">新建任务</el-button>
      </div>

      <vxe-grid
        ref="gridRef"
        v-bind="gridOptions"
        :data="tableData"
        :loading="loading"
        :pager-config="{ ...gridOptions.pagerConfig, total, currentPage: page.current, pageSize: page.size }"
        @page-change="handlePageChange"
        @checkbox-change="handleSelectionChange"
        @checkbox-all="handleSelectionChange"
      >
        <template #status="{ row }">
          <StatusTag :status="row.status" />
        </template>
        <template #progress="{ row }">
          <span :class="{ 'progress-done': row.result_count >= row.image_count }">
            {{ progressText(row) }}
          </span>
        </template>
        <template #cost="{ row }">
          {{ formatMoney(Number(row.actual_cost ?? calcActualCost(row.result_models, row.result_reference_counts))) }}
        </template>
        <template #results="{ row }">
          <el-button link type="primary" size="small" @click="openResults(row)">查看</el-button>
        </template>
        <template #action="{ row }">
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
        <template #empty>
          <el-empty description="暂无任务，点击左上方「新建任务」开始" :image-size="72" />
        </template>
      </vxe-grid>
    </el-card>

  </div>
</template>

<style lang="scss" scoped>
.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.table-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;

  :deep(> .el-card__body) {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-height: 0;
  }
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.search-box {
  position: relative;
  width: min(320px, 100%);
}

.asin-input {
  width: 100%;
}

.search-icon {
  cursor: pointer;
  color: #909399;

  &:hover {
    color: #409eff;
  }
}

.asin-total {
  font-size: 11px;
  color: #909399;
  margin-left: 4px;

  &.danger {
    color: #f56c6c;
  }
}

.clear-icon {
  cursor: pointer;
  color: #909399;

  &:hover {
    color: #c0c4cc;
  }
}

.status-filter {
  width: 100%;
}

.status-wrap {
  width: 130px;
  flex-shrink: 0;
}

.marketplace-filter {
  width: 120px;
  flex-shrink: 0;
}

.brand-filter,
.creator-filter {
  width: 130px;
  flex-shrink: 0;
}

.date-wrap {
  width: 210px;
  min-width: 0;
  flex-shrink: 0;

  :deep(.el-date-editor) {
    width: 100% !important;
    min-width: 0 !important;
  }

  :deep(.el-range-input) {
    width: 70px;
  }

  :deep(.el-range-separator) {
    padding: 0 4px;
  }
}

.reset-button,
.export-button,
.create-button {
  flex-shrink: 0;
}

.progress-done {
  color: #67c23a;
}

.create-button {
  margin-left: auto;
}

@media (max-width: 1100px) {
  .table-toolbar {
    flex-wrap: wrap;
  }

  .create-button {
    margin-left: 0;
  }

  .search-box {
    width: 300px;
  }
}
</style>
