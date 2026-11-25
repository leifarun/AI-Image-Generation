<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchTaskDetail,
  supplementTask,
  deleteTask,
  retryTask,
  resolveTaskResultUrls
} from '@/api/tasks'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isAdmin = computed(() => userStore.role === 'admin')

const taskId = computed(() => route.params.id as string)
const loading = ref(false)
const detail = ref<Awaited<ReturnType<typeof fetchTaskDetail>> | null>(null)
const imageUrls = ref<string[]>([])

const showSupplement = ref(false)
const supplementForm = ref({
  product_title: '',
  brand_name: '',
  product_bullets_text: '',
  product_images_text: ''
})

const showPrompt = ref(false)

async function load() {
  loading.value = true
  try {
    detail.value = await fetchTaskDetail(taskId.value)
    imageUrls.value = await resolveTaskResultUrls(
      (detail.value.results ?? []).map((r) => r.image_path)
    )
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function openSupplement() {
  if (!detail.value) return
  supplementForm.value = {
    product_title: detail.value.product_title ?? '',
    brand_name: detail.value.brand_name ?? '',
    product_bullets_text: (detail.value.product_bullets ?? []).join('\n'),
    product_images_text: (detail.value.product_images ?? []).join('\n')
  }
  showSupplement.value = true
}

async function submitSupplement() {
  if (!detail.value) return
  const bullets = supplementForm.value.product_bullets_text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const images = supplementForm.value.product_images_text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  try {
    await supplementTask(taskId.value, {
      product_title: supplementForm.value.product_title.trim(),
      brand_name: supplementForm.value.brand_name.trim(),
      product_bullets: bullets,
      product_images: images
    })
    ElMessage.success('竞品资料已补充')
    showSupplement.value = false
    load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

async function handleDelete() {
  try {
    await ElMessageBox.confirm('确定删除该任务吗？', '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteTask(taskId.value)
    ElMessage.success('已删除')
    router.push('/tasks')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function handleRetry() {
  try {
    await ElMessageBox.confirm(
      '将忽略已有结果并从第 1 张重新生成，可能产生模型调用费用。确定继续吗？',
      '重新生成确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await retryTask(taskId.value)
    ElMessage.success('任务已重新排队')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '重新生成失败')
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="task-detail">
    <el-card v-if="detail" shadow="never">
      <template #header>
        <div class="card-head">
          <el-button size="small" @click="router.back()">返回</el-button>
          <span class="title">任务详情</span>
          <div class="head-actions">
            <el-button v-if="detail.status === 'need_input'" type="primary" size="small" @click="openSupplement">补充竞品资料</el-button>
            <el-button
              v-if="['failed', 'succeeded', 'need_input'].includes(detail.status)"
              type="warning"
              size="small"
              @click="handleRetry"
            >
              重新生成
            </el-button>
            <el-button type="danger" size="small" @click="handleDelete">删除</el-button>
          </div>
        </div>
      </template>

      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="ASIN">{{ detail.asin }}</el-descriptions-item>
        <el-descriptions-item label="站点">{{ detail.marketplace }}</el-descriptions-item>
        <el-descriptions-item label="提交人">{{ detail.creator_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatDateTime(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="使用模板">{{ detail.template_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <StatusTag :status="detail.status" />
        </el-descriptions-item>
        <el-descriptions-item label="竞品卖点补充" :span="2">{{ detail.selling_points || '—' }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.error_message" label="失败原因" :span="2">
          <span class="error-text">{{ detail.error_message }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">竞品资料</el-divider>
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="竞品标题">{{ detail.product_title || '—' }}</el-descriptions-item>
        <el-descriptions-item label="竞品品牌名">{{ detail.brand_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="竞品五点描述">
          <div v-if="detail.product_bullets?.length">
            <div v-for="(b, i) in detail.product_bullets" :key="i">{{ i + 1 }}. {{ b }}</div>
          </div>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="竞品图片 URL">
          <div v-if="detail.product_images?.length" class="image-url-list">
            <div v-for="(url, i) in detail.product_images" :key="i" class="image-url-row">
              <span class="image-url-index">{{ i + 1 }}.</span>
              <el-link :href="url" target="_blank" type="primary">{{ url }}</el-link>
            </div>
          </div>
          <span v-else>—</span>
        </el-descriptions-item>
        <el-descriptions-item label="抓取方式">
          {{ detail.fetch_mode === 'manual' ? '手动补充' : '自动抓取' }}
        </el-descriptions-item>
      </el-descriptions>

      <el-divider v-if="isAdmin" content-position="left">
        <span>组装后的 AI 指令</span>
        <el-button link type="primary" size="small" @click="showPrompt = true">查看全文</el-button>
      </el-divider>
      <div v-if="isAdmin" class="prompt-preview">{{ detail.prompt_assembled || '—（将在生成时组装）' }}</div>

      <el-divider content-position="left">生成结果</el-divider>
      <div v-if="imageUrls.length" class="result-grid">
        <el-image
          v-for="(url, i) in imageUrls"
          :key="i"
          :src="url"
          :preview-src-list="imageUrls"
          fit="cover"
          class="result-img"
        />
      </div>
      <el-empty v-else description="暂无结果图片" :image-size="80" />
    </el-card>

    <!-- 补充资料弹窗 -->
    <el-dialog v-model="showSupplement" title="补充竞品资料" width="560px">
      <el-form label-position="top">
        <el-form-item label="竞品标题">
          <el-input v-model="supplementForm.product_title" placeholder="粘贴竞品标题" />
        </el-form-item>
        <el-form-item label="竞品品牌名">
          <el-input v-model="supplementForm.brand_name" placeholder="粘贴竞品品牌名" />
        </el-form-item>
        <el-form-item label="竞品五点描述（每行一条）">
          <el-input v-model="supplementForm.product_bullets_text" type="textarea" :rows="6" placeholder="每行一条卖点" />
        </el-form-item>
        <el-form-item label="竞品图片链接（每行一个）">
          <el-input v-model="supplementForm.product_images_text" type="textarea" :rows="3" placeholder="每行一个图片 URL" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showSupplement = false">取消</el-button>
        <el-button type="primary" @click="submitSupplement">保存</el-button>
      </template>
    </el-dialog>

    <!-- 指令全文 -->
    <el-dialog v-if="isAdmin" v-model="showPrompt" title="组装后的 AI 指令" width="640px">
      <pre class="prompt-full">{{ detail?.prompt_assembled || '—' }}</pre>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.task-detail {
  min-height: 300px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;

  .title {
    font-size: 14px;
    font-weight: 500;
  }

  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
}

.error-text {
  color: #f56c6c;
}

.image-url-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.image-url-row {
  display: flex;
  gap: 6px;
  min-width: 0;

  :deep(.el-link__inner) {
    overflow-wrap: anywhere;
  }
}

.image-url-index {
  flex-shrink: 0;
  color: #909399;
}

.prompt-preview {
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
  max-height: 160px;
  overflow: auto;
}

.prompt-full {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}

.result-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;

  .result-img {
    width: 240px;
    height: 240px;
    border-radius: 6px;
    border: 1px solid #ebeef5;
  }
}
</style>
