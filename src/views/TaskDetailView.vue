<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import {
  fetchTaskDetail,
  deleteTask,
  retryTask,
  retryTaskImage,
  updateTaskProductData,
  updateTaskSubtemplateNotes,
  uploadReferenceImage,
  resolveTaskResultUrls
} from '@/api/tasks'
import { fetchAllTemplates, type SopTemplateRow } from '@/api/sop'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'
import {
  calcActualCost,
  formatDoubaoModelLabel,
  formatMoney,
  MAX_REFERENCE_IMAGES
} from '@/constants/pricing'

interface DetailResult {
  id: string
  image_path: string
  model: string | null
  reference_count: number
  subtemplate_id: string | null
}

interface SubtemplateRow {
  key: string
  id: string | null
  name: string
}

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isAdmin = computed(() => userStore.role === 'admin')

const taskId = computed(() => route.params.id as string)
const loading = ref(false)
const detail = ref<Awaited<ReturnType<typeof fetchTaskDetail>> | null>(null)
const templates = ref<SopTemplateRow[]>([])
const resultUrls = ref<Record<string, string>>({})

const showPrompt = ref(false)
const savingNotes = ref(false)
const notes = reactive<Record<string, string>>({})

const productForm = reactive({
  product_title: '',
  brand_name: '',
  product_bullets_text: '',
  product_images_text: ''
})
const productSaving = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()

const productImageCount = computed(
  () => productForm.product_images_text.split('\n').map((s) => s.trim()).filter(Boolean).length
)

const isOwner = computed(
  () => Boolean(detail.value && userStore.user && detail.value.created_by === userStore.user.id)
)
const productEditable = computed(() => {
  if (!detail.value) return false
  const allowed = ['pending_fetch', 'queued', 'need_input', 'failed', 'succeeded']
  return (isAdmin.value || isOwner.value) && allowed.includes(detail.value.status)
})

const subtemplateRows = computed<SubtemplateRow[]>(() => {
  if (!detail.value) return []
  const ids = detail.value.subtemplate_ids ?? []
  if (ids.length) {
    return ids.map((id, index) => {
      const tpl = templates.value.find((t) => t.id === id)
      return { key: id, id, name: tpl?.name ?? `图${index + 1}` }
    })
  }
  const count = Math.max(1, detail.value.image_count ?? 0)
  return Array.from({ length: count }, (_, index) => ({
    key: `__image_${index + 1}`,
    id: null,
    name: `图${index + 1}`
  }))
})

function resultFor(row: unknown, index: number): DetailResult | undefined {
  const current = row as SubtemplateRow
  const results = detail.value?.results ?? []
  if (current.id) {
    return results.find((r) => r.subtemplate_id === current.id)
  }
  return results[index]
}

function firstMissingIndex(): number {
  return subtemplateRows.value.findIndex((row, index) => !resultFor(row, index))
}

function rowStatus(row: unknown, index: number): string {
  if (resultFor(row, index)) return 'succeeded'
  if (detail.value?.status === 'failed') return 'failed'
  if (detail.value?.status === 'generating') {
    return firstMissingIndex() === index ? 'generating' : 'queued'
  }
  if (detail.value?.status === 'succeeded') return 'succeeded'
  if (detail.value?.status === 'need_input') return 'need_input'
  if (detail.value?.status === 'fetching') return 'fetching'
  return 'queued'
}

const previewUrls = computed(() => Object.values(resultUrls.value).filter(Boolean))

async function load() {
  loading.value = true
  try {
    const [taskDetail, allTemplates] = await Promise.all([
      fetchTaskDetail(taskId.value),
      fetchAllTemplates()
    ])
    detail.value = taskDetail
    templates.value = allTemplates

    for (const key of Object.keys(notes)) delete notes[key]
    const sourceNotes = taskDetail.subtemplate_notes ?? {}
    for (const [key, value] of Object.entries(sourceNotes)) {
      notes[key] = value
    }
    for (const row of subtemplateRows.value) {
      if (row.id && notes[row.id] === undefined) notes[row.id] = ''
    }

    productForm.product_title = taskDetail.product_title ?? ''
    productForm.brand_name = taskDetail.brand_name ?? ''
    productForm.product_bullets_text = (taskDetail.product_bullets ?? []).join('\n')
    productForm.product_images_text = (taskDetail.product_images ?? []).join('\n')

    const urls = await resolveTaskResultUrls(
      (taskDetail.results ?? []).map((r) => r.image_path)
    )
    resultUrls.value = {}
    ;(taskDetail.results ?? []).forEach((result, index) => {
      resultUrls.value[result.id] = urls[index] ?? result.image_path
    })
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

async function saveNotes() {
  if (!detail.value) return
  const payload: Record<string, string> = {}
  for (const row of subtemplateRows.value) {
    if (row.id && (notes[row.id] ?? '').trim()) {
      payload[row.id] = notes[row.id].trim()
    }
  }
  savingNotes.value = true
  try {
    await updateTaskSubtemplateNotes(detail.value.id, payload)
    ElMessage.success('自定义说明已保存')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingNotes.value = false
  }
}

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return
  uploading.value = true
  try {
    const existing = productForm.product_images_text
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const remaining = MAX_REFERENCE_IMAGES - existing.length
    if (remaining <= 0) {
      ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
      return
    }
    const accepted = files.slice(0, remaining)
    const urls: string[] = []
    for (const file of accepted) {
      urls.push(await uploadReferenceImage(file))
    }
    productForm.product_images_text = [...existing, ...urls].join('\n')
    ElMessage.success(`已上传 ${urls.length} 张图片`)
    if (files.length > accepted.length) {
      ElMessage.warning(`超过 ${MAX_REFERENCE_IMAGES} 张的部分未上传`)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function saveProduct() {
  if (!detail.value || !productEditable.value) return
  const images = productForm.product_images_text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (images.length > MAX_REFERENCE_IMAGES) {
    ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
    return
  }
  productSaving.value = true
  try {
    await updateTaskProductData(detail.value.id, {
      product_title: productForm.product_title.trim(),
      brand_name: productForm.brand_name.trim(),
      product_bullets: productForm.product_bullets_text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      product_images: images
    })
    ElMessage.success('竞品资料已保存')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    productSaving.value = false
  }
}

async function handleDelete() {
  try {
    await ElMessageBox.confirm('确定删除该任务吗？删除后结果图片也将一并删除。', '删除确认', {
      type: 'warning'
    })
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

async function handleRetryRow(row: unknown) {
  const current = row as SubtemplateRow
  if (!current.id || !detail.value) return
  try {
    await ElMessageBox.confirm(
      `只重新生成「${current.name}」这一张图，可能产生模型调用费用。确定继续吗？`,
      '单张重做确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await retryTaskImage(detail.value.id, current.id)
    ElMessage.success('已重新排队生成该张图片')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '单张重做失败')
  }
}

onMounted(load)
</script>

<template>
  <div v-loading="loading" class="task-detail">
    <el-card v-if="detail" shadow="never" class="section-card">
      <template #header>
        <div class="card-head">
          <el-button size="small" @click="router.push('/tasks')">返回列表</el-button>
          <span class="title">任务详情</span>
          <div class="head-actions">
            <el-button
              v-if="['failed', 'succeeded', 'need_input'].includes(detail.status)"
              type="warning"
              size="small"
              @click="handleRetry"
            >
              全部重做
            </el-button>
            <el-button type="danger" size="small" @click="handleDelete">删除任务</el-button>
          </div>
        </div>
      </template>

      <el-descriptions :column="3" border size="small">
        <el-descriptions-item label="ASIN">{{ detail.asin }}</el-descriptions-item>
        <el-descriptions-item label="站点">{{ detail.marketplace }}</el-descriptions-item>
        <el-descriptions-item label="模型">{{ formatDoubaoModelLabel(detail.model) }}</el-descriptions-item>
        <el-descriptions-item label="使用模板">{{ detail.template_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="提交人">{{ detail.creator_name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="提交时间">{{ formatDateTime(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="当前状态">
          <StatusTag :status="detail.status" />
        </el-descriptions-item>
        <el-descriptions-item label="进度">
          {{ detail.results.length }} / {{ subtemplateRows.length || detail.image_count }}
        </el-descriptions-item>
        <el-descriptions-item label="实际成本">
          {{
            formatMoney(
              calcActualCost(
                detail.results.map((r) => r.model),
                detail.results.map((r) => r.reference_count)
              )
            )
          }}
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{ detail.remark || '—' }}</el-descriptions-item>
        <el-descriptions-item label="竞品卖点补充" :span="2">{{ detail.selling_points || '—' }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.error_message" label="失败原因" :span="3">
          <span class="error-text">{{ detail.error_message }}</span>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <el-card v-if="detail" shadow="never" class="section-card">
      <template #header>
        <div class="section-head">
          <span>竞品资料</span>
          <div class="head-actions">
            <el-button
              v-if="productEditable"
              size="small"
              :icon="Upload"
              :loading="uploading"
              @click="fileInput?.click()"
            >
              上传本地图片
            </el-button>
            <el-button
              v-if="productEditable"
              type="primary"
              size="small"
              :loading="productSaving"
              @click="saveProduct"
            >
              保存竞品资料
            </el-button>
          </div>
        </div>
      </template>

      <div class="field-hint section-tip">
        {{ productEditable ? '全部留空时后台自动抓取；填写任意资料后跳过前台抓取，可直接生成。' : '任务正在处理中，当前仅可查看，不可编辑。' }}
      </div>

      <el-form label-position="top" :disabled="!productEditable">
        <el-row :gutter="16">
          <el-col :xs="24" :md="8">
            <el-form-item label="竞品品牌名">
              <el-input v-model="productForm.brand_name" placeholder="后台自动抓取，可在此修正" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="16">
            <el-form-item label="竞品标题">
              <el-input v-model="productForm.product_title" type="textarea" :rows="2" placeholder="竞品标题" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item label="竞品五点描述（每行一条）">
              <el-input v-model="productForm.product_bullets_text" type="textarea" :rows="6" placeholder="每行一条五点描述" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item :label="`竞品图片 URL（最多 ${MAX_REFERENCE_IMAGES} 张，每行一个）`">
              <el-input
                v-model="productForm.product_images_text"
                type="textarea"
                :rows="6"
                :placeholder="`最多 ${MAX_REFERENCE_IMAGES} 张，每行一个图片 URL`"
              />
              <div class="limit-hint" :class="{ danger: productImageCount > MAX_REFERENCE_IMAGES }">
                已填写 {{ productImageCount }} / {{ MAX_REFERENCE_IMAGES }} 张
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFiles" />
    </el-card>

    <el-card v-if="detail && isAdmin" shadow="never" class="section-card">
      <template #header>
        <div class="section-head">
          <span>组装后的 AI 指令（仅管理员可见）</span>
          <el-button size="small" @click="showPrompt = true">查看全文</el-button>
        </div>
      </template>
      <div class="prompt-preview">{{ detail.prompt_assembled || '—（将在生成时组装）' }}</div>
    </el-card>

    <el-card v-if="detail" shadow="never" class="section-card">
      <template #header>
        <div class="section-head">
          <span>子模板生成清单</span>
          <div class="head-actions">
            <span class="section-count">共 {{ subtemplateRows.length }} 张</span>
            <el-button type="primary" size="small" :loading="savingNotes" @click="saveNotes">
              保存自定义说明
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="subtemplateRows" border>
        <el-table-column type="index" label="#" width="48" align="center" />
        <el-table-column label="图片名称（子模板名称）" min-width="150">
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column label="模型" min-width="150">
          <template #default="{ row, $index }">
            {{ formatDoubaoModelLabel(resultFor(row, $index)?.model || detail.model) }}
          </template>
        </el-table-column>
        <el-table-column label="自定义说明" min-width="220">
          <template #default="{ row }">
            <el-input
              v-if="row.id"
              v-model="notes[row.id]"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 3 }"
              placeholder="将追加到该子模板变量中"
            />
            <span v-else class="field-hint">独立模板暂不支持单图说明</span>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="90" align="center">
          <template #default="{ row, $index }">
            <StatusTag :status="rowStatus(row, $index)" />
          </template>
        </el-table-column>
        <el-table-column label="生成结果" width="120" align="center">
          <template #default="{ row, $index }">
            <el-image
              v-if="resultFor(row, $index)"
              :src="resultUrls[resultFor(row, $index)!.id]"
              :preview-src-list="previewUrls"
              :initial-index="detail.results.findIndex((r) => r.id === resultFor(row, $index)!.id)"
              fit="cover"
              class="result-thumb"
            />
            <span v-else class="field-hint">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.id"
              link
              type="warning"
              size="small"
              :disabled="['fetching', 'generating'].includes(detail.status)"
              @click="handleRetryRow(row)"
            >
              重做
            </el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-if="detail && isAdmin" v-model="showPrompt" title="组装后的 AI 指令" width="720px">
      <pre class="prompt-full">{{ detail.prompt_assembled || '—' }}</pre>
      <template #footer>
        <el-button @click="showPrompt = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.task-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 300px;
}

.section-card {
  :deep(> .el-card__header) {
    padding: 12px 16px;
  }
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;

  .title {
    font-size: 15px;
    font-weight: 600;
  }

  .head-actions {
    margin-left: auto;
    display: flex;
    gap: 8px;
  }
}

.section-head {
  display: flex;
  align-items: center;
  gap: 12px;

  .head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 8px;
  }
}

.section-count {
  color: #909399;
  font-size: 12px;
}

.section-tip {
  margin: 0 0 12px;
}

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.error-text {
  color: #f56c6c;
}

.limit-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;

  &.danger {
    color: #f56c6c;
  }
}

.prompt-preview {
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 12px;
  font-size: 12px;
  color: #606266;
  white-space: pre-wrap;
  max-height: 180px;
  overflow: auto;
}

.prompt-full {
  margin: 0;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 6px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow: auto;
}

.result-thumb {
  width: 64px;
  height: 64px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
</style>
