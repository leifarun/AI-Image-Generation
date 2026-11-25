<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { fetchDashboardSummary, type DashboardSummary } from '@/api/dashboard'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'
import { formatMoney } from '@/constants/pricing'

const router = useRouter()
const userStore = useUserStore()
const loading = ref(false)
const summary = ref<DashboardSummary>({
  todayCreated: 0,
  queued: 0,
  processing: 0,
  todayFailed: 0,
  totalImages: 0,
  totalCost: 0,
  todayCost: 0,
  recent: []
})

const stats = computed(() => [
  { label: '今日生成', value: summary.value.todayCreated, tone: 'blue' },
  { label: '排队中', value: summary.value.queued, tone: 'amber' },
  { label: '处理中', value: summary.value.processing, tone: 'green' },
  { label: '今日失败', value: summary.value.todayFailed, tone: 'red' },
  { label: '累计出图', value: summary.value.totalImages, tone: 'blue' },
  { label: '累计成本', value: formatMoney(summary.value.totalCost), tone: 'green' }
])

async function loadData() {
  loading.value = true
  try {
    summary.value = await fetchDashboardSummary()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '工作台数据加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div v-loading="loading" class="dashboard">
    <div class="welcome">
      <div>
        <div class="welcome-title">你好，{{ userStore.name || '运营同事' }}</div>
        <div class="welcome-sub">今天也一起把商品卖点变成更有转化力的图片。</div>
      </div>
      <el-button :icon="Refresh" @click="loadData">刷新数据</el-button>
    </div>

    <el-row :gutter="12">
      <el-col v-for="s in stats" :key="s.label" :span="4">
        <el-card shadow="never" class="stat-card" :class="`tone-${s.tone}`">
          <div class="stat-label">{{ s.label }}</div>
          <div class="stat-value">{{ s.value }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="recent-card">
      <template #header>
        <div class="card-head">
          <span>最近任务</span>
          <el-button type="primary" size="small" @click="router.push('/tasks')">查看全部任务</el-button>
        </div>
      </template>
      <el-table v-if="summary.recent.length" :data="summary.recent" stripe>
        <el-table-column prop="asin" label="ASIN" width="135">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/tasks/${row.id}`)">{{ row.asin }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="marketplace" label="站点" width="70" />
        <el-table-column prop="template_name" label="模板" min-width="140" show-overflow-tooltip />
        <el-table-column prop="creator_name" label="提交人" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <StatusTag :status="row.status" />
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="165">
          <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="还没有任务，创建第一个生成任务吧" :image-size="80">
        <el-button type="primary" @click="router.push('/tasks')">前往生成任务</el-button>
      </el-empty>
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

.stat-card {
  border-top: 3px solid #d9ecff;

  &.tone-amber {
    border-top-color: #f3d19e;
  }

  &.tone-green {
    border-top-color: #b3e19d;
  }

  &.tone-red {
    border-top-color: #fab6b6;
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
}

.recent-card {
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
}

@media (max-width: 900px) {
  .dashboard :deep(.el-col-6) {
    max-width: 50%;
    flex: 0 0 50%;
    margin-bottom: 12px;
  }

  .welcome {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
