<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import {
  fetchDashboardSummary,
  fetchDashboardTasks,
  type DashboardSummary,
  type DashboardTaskFilter
} from '@/api/dashboard'
import type { TaskRow } from '@/api/tasks'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'
import { calcActualCost, formatDoubaoModelLabel, formatMoney } from '@/constants/pricing'

interface StatCard {
  label: string
  value: number | string
  tone: string
  filter?: DashboardTaskFilter
}

defineOptions({ name: 'DashboardView' })

const router = useRouter()
const userStore = useUserStore()
const dashboardLoading = ref(false)
const taskLoading = ref(false)
const summary = ref<DashboardSummary>({
  totalTasks: 0,
  queued: 0,
  processing: 0,
  pendingFetch: 0,
  needInput: 0,
  totalSucceeded: 0,
  totalFailed: 0,
  totalImages: 0,
  totalCost: 0,
  recent: []
})
const taskRows = ref<TaskRow[]>([])
const selectedFilter = ref<DashboardTaskFilter>('all')
const tableCardRef = ref<HTMLElement>()
const chartRef = ref<HTMLElement>()
let chartInstance: echarts.ECharts | null = null
let lastLoadedAt = 0
const CACHE_TTL_MS = 30_000

const filterOptions: Array<{ label: string; value: DashboardTaskFilter }> = [
  { label: '全部', value: 'all' },
  { label: '排队中', value: 'queued' },
  { label: '处理中', value: 'processing' },
  { label: '已完成', value: 'succeeded' },
  { label: '失败', value: 'failed' },
  { label: '待补充', value: 'need_input' }
]

const stats = computed<StatCard[]>(() => [
  { label: '累计任务', value: summary.value.totalTasks, tone: 'blue', filter: 'all' },
  { label: '排队中', value: summary.value.queued, tone: 'amber', filter: 'queued' },
  { label: '处理中', value: summary.value.processing, tone: 'green', filter: 'processing' },
  { label: '累计完成', value: summary.value.totalSucceeded, tone: 'green', filter: 'succeeded' },
  { label: '累计失败', value: summary.value.totalFailed, tone: 'red', filter: 'failed' },
  { label: '累计出图', value: summary.value.totalImages, tone: 'blue' },
  { label: '累计成本', value: formatMoney(summary.value.totalCost), tone: 'green' }
])

function progressText(row: { result_count?: number | null; image_count?: number | null }): string {
  const done = Number(row.result_count ?? 0)
  const total = Math.max(1, Number(row.image_count ?? 0))
  return `${done}/${total}`
}

function modelText(row: {
  model?: string | null
  result_models?: string[] | null
}): string {
  return formatDoubaoModelLabel(row.model || row.result_models?.[0])
}

function actualCost(row: {
  result_models?: string[] | null
  result_reference_counts?: number[] | null
}): string {
  return formatMoney(calcActualCost(row.result_models, row.result_reference_counts))
}

const statusDistribution = computed(() => [
  { name: '排队中', value: summary.value.queued },
  { name: '处理中', value: summary.value.processing },
  { name: '待抓取', value: summary.value.pendingFetch },
  { name: '待补充', value: summary.value.needInput },
  { name: '已完成', value: summary.value.totalSucceeded },
  { name: '失败', value: summary.value.totalFailed }
].filter((item) => item.value > 0))

const hasStatusData = computed(() => statusDistribution.value.length > 0)

function renderStatusChart() {
  if (!chartRef.value) return
  if (!chartInstance) {
    chartInstance = echarts.init(chartRef.value)
  }
  chartInstance.setOption({
    color: ['#e6a23c', '#409eff', '#909399', '#f56c6c', '#67c23a', '#c0c4cc'],
    tooltip: { trigger: 'item', formatter: '{b}：{c}（{d}%）' },
    legend: { bottom: 0, icon: 'circle' },
    series: [
      {
        name: '任务状态占比',
        type: 'pie',
        radius: ['42%', '70%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { formatter: '{b}\n{d}%' },
        data: statusDistribution.value
      }
    ]
  }, true)
}

async function loadSummary() {
  dashboardLoading.value = true
  try {
    summary.value = await fetchDashboardSummary()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '工作台数据加载失败')
  } finally {
    dashboardLoading.value = false
  }
}

async function loadTasks() {
  taskLoading.value = true
  try {
    taskRows.value = await fetchDashboardTasks(selectedFilter.value, 100)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '任务明细加载失败')
  } finally {
    taskLoading.value = false
  }
}

async function handleStatClick(card: StatCard) {
  if (!card.filter) return
  selectedFilter.value = card.filter
  await loadTasks()
  await nextTick()
  tableCardRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleFilterChange() {
  void loadTasks()
}

async function loadAll() {
  await Promise.all([loadSummary(), loadTasks()])
  await nextTick()
  renderStatusChart()
  lastLoadedAt = Date.now()
}

onMounted(() => {
  loadAll()
})

onActivated(() => {
  if (Date.now() - lastLoadedAt > CACHE_TTL_MS) {
    loadAll()
  } else {
    nextTick(() => renderStatusChart())
  }
})

onBeforeUnmount(() => {
  chartInstance?.dispose()
  chartInstance = null
})
</script>

<template>
  <div v-loading="dashboardLoading" class="dashboard">
    <div class="welcome">
      <div>
        <div class="welcome-title">你好，{{ userStore.name || '运营同事' }}</div>
        <div class="welcome-sub">全局任务看板，快速定位排队、处理中和失败任务。</div>
      </div>
      <el-button :icon="Refresh" @click="loadAll">刷新数据</el-button>
    </div>

    <div class="stat-grid">
      <el-card
        v-for="card in stats"
        :key="card.label"
        shadow="never"
        class="stat-card"
        :class="[
          `tone-${card.tone}`,
          { clickable: card.filter, active: card.filter === selectedFilter }
        ]"
        :role="card.filter ? 'button' : undefined"
        :tabindex="card.filter ? 0 : undefined"
        @click="handleStatClick(card)"
        @keyup.enter="handleStatClick(card)"
      >
        <div class="stat-label">{{ card.label }}</div>
        <div class="stat-value">{{ card.value }}</div>
        <div v-if="card.filter" class="stat-hint">点击查看明细</div>
      </el-card>
    </div>

    <div ref="tableCardRef" class="task-card-anchor">
      <el-card shadow="never" class="task-card">
        <template #header>
          <div class="card-head">
            <div>
              <span class="card-title">任务明细</span>
              <span class="card-subtitle">展示全员任务，不只是当前账号</span>
            </div>
            <el-button type="primary" size="small" @click="router.push('/tasks')">
              查看全部任务
            </el-button>
          </div>
        </template>

        <el-radio-group v-model="selectedFilter" class="filter-tabs" @change="handleFilterChange">
          <el-radio-button v-for="item in filterOptions" :key="item.value" :value="item.value">
            {{ item.label }}
          </el-radio-button>
        </el-radio-group>

        <el-table v-loading="taskLoading" :data="taskRows" stripe max-height="430">
          <el-table-column prop="asin" label="ASIN" min-width="130">
            <template #default="{ row }">
              <el-link type="primary" @click="router.push(`/tasks/${row.id}`)">{{ row.asin }}</el-link>
            </template>
          </el-table-column>
          <el-table-column prop="marketplace" label="站点" width="70" />
          <el-table-column prop="template_name" label="模板" min-width="140" show-overflow-tooltip />
          <el-table-column prop="creator_name" label="提交人" width="100" />
          <el-table-column label="模型" min-width="150" show-overflow-tooltip>
            <template #default="{ row }">{{ modelText(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <StatusTag :status="row.status" />
            </template>
          </el-table-column>
          <el-table-column label="进度" width="90">
            <template #default="{ row }">{{ progressText(row) }}</template>
          </el-table-column>
          <el-table-column label="实际成本" width="110">
            <template #default="{ row }">{{ actualCost(row) }}</template>
          </el-table-column>
          <el-table-column label="提交时间" width="165">
            <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="当前筛选下暂无任务" :image-size="72" />
          </template>
        </el-table>
      </el-card>
    </div>

    <el-card shadow="never" class="chart-card">
      <template #header>
        <span class="card-title">任务状态占比</span>
      </template>
      <div v-if="hasStatusData" ref="chartRef" class="status-chart"></div>
      <el-empty v-else description="暂无任务数据" :image-size="72" />
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.welcome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 2px 2px;
}

.welcome-title {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.welcome-sub {
  margin-top: 5px;
  font-size: 13px;
  color: #909399;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.stat-card {
  border-top: 3px solid #9ac8f5;
  transition: transform 0.15s ease, box-shadow 0.15s ease;

  &.tone-amber {
    border-top-color: #f3d19e;
  }

  &.tone-green {
    border-top-color: #b3e19d;
  }

  &.tone-red {
    border-top-color: #fab6b6;
  }

  &.clickable {
    cursor: pointer;

    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 18px rgb(24 95 165 / 10%);
    }
  }

  &.active {
    box-shadow: 0 0 0 2px rgb(64 158 255 / 28%);
  }

  .stat-label {
    font-size: 13px;
    color: #909399;
  }

  .stat-value {
    font-size: 26px;
    font-weight: 500;
    color: #303133;
    margin-top: 8px;
  }

  .stat-hint {
    margin-top: 5px;
    font-size: 11px;
    color: #b1b3b8;
  }
}

.task-card-anchor {
  scroll-margin-top: 12px;
}

.task-card {
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .card-title {
    font-size: 14px;
    font-weight: 500;
    color: #303133;
  }

  .card-subtitle {
    margin-left: 8px;
    font-size: 12px;
    color: #909399;
  }
}

.chart-card {
  .card-title {
    font-size: 14px;
    font-weight: 500;
    color: #303133;
  }
}

.status-chart {
  width: 100%;
  height: 320px;
}

.filter-tabs {
  margin-bottom: 12px;
}

@media (max-width: 900px) {
  .welcome {
    align-items: flex-start;
    flex-direction: column;
  }

  .stat-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .task-card .card-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
