<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleClose, Search } from '@element-plus/icons-vue'
import type { VxeGridProps, VxeGridInstance } from 'vxe-table'
import {
  fetchTasks,
  fetchTaskDetail,
  deleteTask,
  retryTask,
  type TaskRow
} from '@/api/tasks'
import { TASK_STATUS_LIST } from '@/constants/task'
import { formatDateTime } from '@/utils/datetime'
import { useUserStore } from '@/stores/user'
import CreateTaskDrawer from '@/views/tasks/CreateTaskDrawer.vue'
import PromptDialog from '@/views/tasks/PromptDialog.vue'
import ProductDataDialog from '@/views/tasks/ProductDataDialog.vue'
import ResultsDialog from '@/views/tasks/ResultsDialog.vue'

const userStore = useUserStore()
const isAdmin = computed(() => userStore.role === 'admin')
const gridRef = ref<VxeGridInstance>()

const filters = reactive({
  asin: '',
  status: '',
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
const total = ref(0)
const page = reactive({ current: 1, size: 20 })

const createDrawerVisible = ref(false)
const currentTask = ref<TaskRow | null>(null)
const promptVisible = ref(false)
const productVisible = ref(false)
const resultsVisible = ref(false)
const resultImagePaths = ref<string[]>([])

async function loadData() {
  loading.value = true
  try {
    const result = await fetchTasks({
      page: page.current,
      pageSize: page.size,
      asins: parsedAsins.value.length ? parsedAsins.value : undefined,
      status: filters.status || undefined,
      from: filters.dateRange[0] ? new Date(filters.dateRange[0]).toISOString() : undefined,
      to: filters.dateRange[1] ? new Date(filters.dateRange[1]).toISOString() : undefined
    })
    tableData.value = result.rows
    total.value = result.total
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载任务失败')
  } finally {
    loading.value = false
  }
}

function handleSearch() {
  if (parsedAsins.value.length > 100) {
    ElMessage.warning(`最多查询 100 个 ASIN，当前识别到 ${parsedAsins.value.length} 个`)
    return
  }
  page.current = 1
  loadData()
}

function handleReset() {
  filters.asin = ''
  filters.status = ''
  filters.dateRange = []
  page.current = 1
  loadData()
}

async function handleDelete(row: TaskRow) {
  try {
    await ElMessageBox.confirm(`确定删除该任务（ASIN: ${row.asin}）吗？删除后结果图片将一并删除。`, '删除确认', {
      type: 'warning'
    })
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

function openPrompt(row: TaskRow) {
  currentTask.value = row
  promptVisible.value = true
}

function openProduct(row: TaskRow) {
  currentTask.value = row
  productVisible.value = true
}

async function openResults(row: TaskRow) {
  currentTask.value = row
  resultImagePaths.value = []
  resultsVisible.value = true
  try {
    const detail = await fetchTaskDetail(row.id)
    resultImagePaths.value = detail.results.map((r) => r.image_path)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '生成结果加载失败')
  }
}

async function handleRetry(row: TaskRow) {
  try {
    await ElMessageBox.confirm(
      `确定重做该任务（ASIN: ${row.asin}）吗？将按最新竞品资料重新生成图片，可能产生模型调用费用。`,
      '重做确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await retryTask(row.id)
    ElMessage.success('已重新排队，等待生成')
    loadData()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重做失败')
  }
}

function handlePageChange({ currentPage, pageSize }: { currentPage: number; pageSize: number }) {
  page.current = currentPage
  page.size = pageSize
  loadData()
}

function handleCreated() {
  createDrawerVisible.value = false
  page.current = 1
  loadData()
}

onMounted(loadData)

const gridOptions = reactive<VxeGridProps>({
  border: true,
  showOverflow: true,
  height: 'calc(100vh - 250px)',
  minHeight: 320,
  rowConfig: { keyField: 'id' },
  columnConfig: { resizable: true },
  columns: [
    { type: 'seq', width: 56, title: '#' },
    { field: 'created_at', title: '提交时间', width: 150, formatter: ({ cellValue }) => formatDateTime(cellValue) },
    { field: 'creator_name', title: '提交人', width: 100 },
    { field: 'asin', title: 'ASIN', width: 130 },
    { field: 'marketplace', title: '站点', width: 70 },
    { field: 'selling_points', title: '竞品卖点补充', minWidth: 180, showOverflow: true },
    { field: 'template_name', title: '模板', minWidth: 120, showOverflow: true },
    { title: '组装后的 AI 指令', width: 160, slots: { default: 'prompt' } },
    { title: '竞品资料', width: 110, slots: { default: 'product' } },
    {
      field: 'status',
      title: '当前状态',
      width: 100,
      slots: { default: 'status' }
    },
    {
      field: 'error_message',
      title: '失败原因',
      minWidth: 180,
      showOverflow: true
    },
    { title: '生成结果', width: 110, slots: { default: 'results' } },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
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
        <el-button type="primary" class="create-button" @click="createDrawerVisible = true">新建任务</el-button>
      </div>

      <vxe-grid
        ref="gridRef"
        v-bind="gridOptions"
        :data="tableData"
        :loading="loading"
        :pager-config="{ ...gridOptions.pagerConfig, total, currentPage: page.current, pageSize: page.size }"
        @page-change="handlePageChange"
      >
        <template #status="{ row }">
          <StatusTag :status="row.status" />
        </template>
        <template #prompt="{ row }">
          <el-button v-if="isAdmin" link type="primary" size="small" @click="openPrompt(row)">查看</el-button>
          <span v-else class="no-auth">无权限</span>
        </template>
        <template #product="{ row }">
          <el-button link type="primary" size="small" @click="openProduct(row)">查看</el-button>
        </template>
        <template #results="{ row }">
          <el-button link type="primary" size="small" @click="openResults(row)">查看</el-button>
        </template>
        <template #action="{ row }">
          <el-button link type="warning" size="small" @click="handleRetry(row)">重做</el-button>
          <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
        </template>
        <template #empty>
          <el-empty description="暂无任务，点击左上方「新建任务」开始" :image-size="72" />
        </template>
      </vxe-grid>
    </el-card>

    <CreateTaskDrawer v-model="createDrawerVisible" @created="handleCreated" />
    <PromptDialog v-model="promptVisible" :prompt="currentTask?.prompt_assembled ?? null" />
    <ProductDataDialog
      v-model="productVisible"
      :task="currentTask"
      @saved="loadData"
    />
    <ResultsDialog
      v-model="resultsVisible"
      :task-id="currentTask?.id ?? ''"
      :image-paths="resultImagePaths"
    />
  </div>
</template>

<style lang="scss" scoped>
.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.no-auth {
  color: #c0c4cc;
  font-size: 12px;
}

.table-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
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
.create-button {
  flex-shrink: 0;
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
