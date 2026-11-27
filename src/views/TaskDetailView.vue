<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowDown, ArrowRight, Download, Upload } from '@element-plus/icons-vue'
import JSZip from 'jszip'
import {
  createTask,
  fetchTaskDetail,
  retryTaskImage,
  updateTaskProductData,
  updateTaskSubtemplateNotes,
  uploadReferenceImage,
  resolveTaskResultUrls
} from '@/api/tasks'
import {
  fetchActiveTemplates,
  fetchAllTemplates,
  type SopTemplateRow
} from '@/api/sop'
import {
  fetchDefaultDoubaoModel,
  fetchOutputResolution,
  fetchReferenceImageLimit,
  fetchSupportedMarketplaces
} from '@/api/settings'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'
import { formatMarketplaceLabel } from '@/constants/marketplace'
import {
  DOUBAO_IMAGE_PRICES,
  calcActualCost,
  estimateTaskCost,
  formatCostRange,
  formatDoubaoModelLabel,
  formatMoney,
  getDoubaoImagePrice,
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
const isCreate = computed(() => route.name === 'task-create' || route.path === '/tasks/new')
const taskId = computed(() => (isCreate.value ? 'new' : String(route.params.id ?? '')))

const loading = ref(false)
const submitting = ref(false)
const savingTask = ref(false)
const downloadingZip = ref(false)
const uploading = ref(false)
const productPanelOpen = ref(false)
const showPrompt = ref(false)
const fileInput = ref<HTMLInputElement>()

const templates = ref<SopTemplateRow[]>([])
const detail = ref<Awaited<ReturnType<typeof fetchTaskDetail>> | null>(null)
const resultUrls = ref<Record<string, string>>({})
const referenceImageLimit = ref(MAX_REFERENCE_IMAGES)
const outputWidth = ref(1600)
const outputHeight = ref(1600)
const supportedMarketplaces = ref<string[]>([])

const createForm = reactive({
  asin: '',
  marketplace: 'US',
  selling_points: '',
  remark: '',
  template_id: null as string | null,
  model: ''
})

const productForm = reactive({
  product_title: '',
  brand_name: '',
  product_bullets_text: '',
  product_images_text: ''
})

const notes = reactive<Record<string, string>>({})
const selected = reactive<Record<string, boolean>>({})

const parentTemplates = computed(() => templates.value.filter((t) => !t.parent_id))
const selectedTemplate = computed(
  () => parentTemplates.value.find((t) => t.id === createForm.template_id) ?? null
)
const selectedChildren = computed(() =>
  templates.value
    .filter((t) => t.parent_id === createForm.template_id)
    .sort((a, b) => a.sort_order - b.sort_order)
)

const subtemplateRows = computed<SubtemplateRow[]>(() => {
  if (isCreate.value) {
    if (selectedChildren.value.length) {
      return selectedChildren.value.map((child) => ({
        key: child.id,
        id: child.id,
        name: child.name
      }))
    }
    const count = Math.max(1, selectedTemplate.value?.image_count ?? 0)
    return Array.from({ length: count }, (_, index) => ({
      key: `__image_${index + 1}`,
      id: null,
      name: `图${index + 1}`
    }))
  }
  if (!detail.value) return []
  const ids = detail.value.subtemplate_ids ?? []
  if (ids.length) {
    return ids.map((id, index) => {
      const tpl = templates.value.find((item) => item.id === id)
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

const selectedSubtemplateIds = computed(() =>
  subtemplateRows.value
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id && selected[id]))
)

const imageCount = computed(() =>
  isCreate.value
    ? selectedChildren.value.length
      ? selectedSubtemplateIds.value.length
      : subtemplateRows.value.length
    : subtemplateRows.value.length
)

const marketplaceOptions = computed(() =>
  supportedMarketplaces.value.map((code) => ({
    value: code,
    label: formatMarketplaceLabel(code)
  }))
)

const modelOptions = computed(() =>
  DOUBAO_IMAGE_PRICES.map((item) => ({
    value: item.modelId,
    label: `Doubao-${item.label.replace(/^Seedream /, 'Seedream-')}`
  }))
)

const manualImageCount = computed(
  () => productForm.product_images_text.split('\n').map((item) => item.trim()).filter(Boolean).length
)

const costEstimate = computed(() =>
  estimateTaskCost(
    createForm.model,
    imageCount.value,
    referenceImageLimit.value,
    outputWidth.value,
    outputHeight.value
  )
)

const costText = computed(() => {
  if (selectedChildren.value.length && imageCount.value <= 0) return '请选择要生成的图片'
  if (imageCount.value <= 0) return '选择模板后显示'
  return formatCostRange(costEstimate.value)
})

const costModelLabel = computed(() => getDoubaoImagePrice(createForm.model).label)
const previewUrls = computed(() => Object.values(resultUrls.value).filter(Boolean))

const isOwner = computed(
  () => Boolean(detail.value && userStore.user && detail.value.created_by === userStore.user.id)
)
const productEditable = computed(() => {
  if (isCreate.value) return true
  if (!detail.value) return false
  const allowed = ['pending_fetch', 'queued', 'need_input', 'failed', 'succeeded']
  return (isAdmin.value || isOwner.value) && allowed.includes(detail.value.status)
})
const canSaveTask = computed(() => (isCreate.value ? true : isAdmin.value || isOwner.value))

function resetCreateSelections() {
  for (const key of Object.keys(notes)) delete notes[key]
  for (const key of Object.keys(selected)) delete selected[key]
  for (const row of subtemplateRows.value) {
    if (row.id) {
      notes[row.id] = ''
      selected[row.id] = false
    }
  }
}

function handleTemplateChange() {
  resetCreateSelections()
}

async function initializeCreate() {
  detail.value = null
  resultUrls.value = {}
  templates.value = await fetchActiveTemplates()

  const results = await Promise.allSettled([
    fetchDefaultDoubaoModel(),
    fetchSupportedMarketplaces(),
    fetchReferenceImageLimit(),
    fetchOutputResolution()
  ])
  const [model, marketplaces, refLimit, resolution] = results
  if (model.status === 'fulfilled') createForm.model = model.value
  if (marketplaces.status === 'fulfilled') {
    supportedMarketplaces.value = marketplaces.value
    if (supportedMarketplaces.value.length && !supportedMarketplaces.value.includes(createForm.marketplace)) {
      createForm.marketplace = supportedMarketplaces.value[0]
    }
  }
  if (refLimit.status === 'fulfilled') referenceImageLimit.value = refLimit.value
  if (resolution.status === 'fulfilled') {
    outputWidth.value = resolution.value.width
    outputHeight.value = resolution.value.height
  }

  if (!createForm.template_id && parentTemplates.value.length) {
    const def = parentTemplates.value.find((item) => item.is_default) ?? parentTemplates.value[0]
    createForm.template_id = def.id
  }
  resetCreateSelections()
}

function populateDetailFields(taskDetail: NonNullable<typeof detail.value>) {
  for (const key of Object.keys(notes)) delete notes[key]
  const sourceNotes = taskDetail.subtemplate_notes ?? {}
  for (const [key, value] of Object.entries(sourceNotes)) notes[key] = value
  for (const row of subtemplateRows.value) {
    if (row.id && notes[row.id] === undefined) notes[row.id] = ''
  }

  productForm.product_title = taskDetail.product_title ?? ''
  productForm.brand_name = taskDetail.brand_name ?? ''
  productForm.product_bullets_text = (taskDetail.product_bullets ?? []).join('\n')
  productForm.product_images_text = (taskDetail.product_images ?? []).join('\n')
}

async function initializeDetail() {
  const [taskDetail, allTemplates] = await Promise.all([
    fetchTaskDetail(taskId.value),
    fetchAllTemplates()
  ])
  detail.value = taskDetail
  templates.value = allTemplates
  populateDetailFields(taskDetail)

  const urls = await resolveTaskResultUrls(
    (taskDetail.results ?? []).map((item) => item.image_path)
  )
  resultUrls.value = {}
  ;(taskDetail.results ?? []).forEach((result, index) => {
    resultUrls.value[result.id] = urls[index] ?? result.image_path
  })
}

async function initialize() {
  loading.value = true
  try {
    if (isCreate.value) {
      await initializeCreate()
    } else {
      await initializeDetail()
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function resultFor(row: unknown, index: number): DetailResult | undefined {
  const current = row as SubtemplateRow
  const results = detail.value?.results ?? []
  if (current.id) {
    const exact = results.find((item) => item.subtemplate_id === current.id)
    if (exact) return exact
    const legacy = results[index]
    if (legacy && !legacy.subtemplate_id) return legacy
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

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function safeFileName(name: string, index: number): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'image'
  return `${String(index + 1).padStart(2, '0')}-${cleaned}`
}

async function downloadSingle(row: unknown, index: number) {
  const current = row as SubtemplateRow
  const result = resultFor(row, index)
  if (!result) return
  const url = resultUrls.value[result.id]
  if (!url) {
    ElMessage.warning('图片地址尚未就绪')
    return
  }
  try {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(String(resp.status))
    const blob = await resp.blob()
    const ext = blob.type.includes('jpeg') ? 'jpg' : 'png'
    downloadBlob(blob, `${safeFileName(current.name, index)}.${ext}`)
  } catch {
    window.open(url, '_blank')
  }
}

async function downloadBatch() {
  const urls = previewUrls.value
  if (!urls.length) {
    ElMessage.warning('暂无结果图片可下载')
    return
  }
  downloadingZip.value = true
  try {
    const zip = new JSZip()
    const files = await Promise.all(
      urls.map(async (url, index) => {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`第 ${index + 1} 张图片下载失败`)
        return { index, blob: await resp.blob() }
      })
    )
    for (const { index, blob } of files) {
      const ext = blob.type.includes('jpeg') ? 'jpg' : 'png'
      const row = subtemplateRows.value[index] ?? { name: `图${index + 1}` }
      zip.file(`${safeFileName(row.name, index)}.${ext}`, blob)
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `task-${taskId.value}-images.zip`)
    ElMessage.success(`已打包 ${files.length} 张图片`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下载失败')
  } finally {
    downloadingZip.value = false
  }
}

function productPayload() {
  return {
    product_title: productForm.product_title.trim(),
    brand_name: productForm.brand_name.trim(),
    product_bullets: productForm.product_bullets_text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean),
    product_images: productForm.product_images_text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
  }
}

function notesPayload(): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const row of subtemplateRows.value) {
    if (row.id && (notes[row.id] ?? '').trim()) payload[row.id] = notes[row.id].trim()
  }
  return payload
}

async function submitCreate() {
  if (!createForm.asin.trim()) {
    ElMessage.warning('请输入 ASIN')
    return
  }
  if (!createForm.template_id) {
    ElMessage.warning('请选择指令模板')
    return
  }
  if (!createForm.model) {
    ElMessage.warning('请选择模型')
    return
  }
  if (selectedChildren.value.length && !selectedSubtemplateIds.value.length) {
    ElMessage.warning('请至少勾选一张要生成的图片')
    return
  }
  const product = productPayload()
  if (product.product_images.length > MAX_REFERENCE_IMAGES) {
    ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
    return
  }

  submitting.value = true
  try {
    const id = await createTask({
      asin: createForm.asin,
      marketplace: createForm.marketplace,
      selling_points: createForm.selling_points,
      remark: createForm.remark,
      template_id: createForm.template_id,
      subtemplate_ids: selectedChildren.value.length ? selectedSubtemplateIds.value : [],
      subtemplate_notes: notesPayload(),
      model: createForm.model,
      ...product
    })
    ElMessage.success('任务已提交')
    await router.replace(`/tasks/${id}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    submitting.value = false
  }
}

async function saveAll() {
  if (!detail.value) return
  const product = productPayload()
  if (product.product_images.length > MAX_REFERENCE_IMAGES) {
    ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
    return
  }

  savingTask.value = true
  try {
    if (productEditable.value) {
      await updateTaskProductData(detail.value.id, product)
    }
    await updateTaskSubtemplateNotes(detail.value.id, notesPayload())
    ElMessage.success('任务已保存')
    await initialize()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    savingTask.value = false
  }
}

async function handlePrimaryAction() {
  if (isCreate.value) {
    await submitCreate()
  } else {
    await saveAll()
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
      .map((item) => item.trim())
      .filter(Boolean)
    const remaining = MAX_REFERENCE_IMAGES - existing.length
    if (remaining <= 0) {
      ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
      return
    }
    const accepted = files.slice(0, remaining)
    const urls: string[] = []
    for (const file of accepted) urls.push(await uploadReferenceImage(file))
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
    await initialize()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '单张重做失败')
  }
}

watch(taskId, initialize, { immediate: true })
</script>

<template>
  <div v-loading="loading" class="task-workspace">
    <div class="detail-toolbar">
      <el-button size="small" @click="router.push('/tasks')">返回列表</el-button>
      <span class="title">{{ isCreate ? '新建生成任务' : '任务详情' }}</span>
      <div class="head-actions">
        <el-button
          type="primary"
          size="small"
          :loading="isCreate ? submitting : savingTask"
          :disabled="!canSaveTask"
          @click="handlePrimaryAction"
        >
          {{ isCreate ? '提交任务' : '保存任务' }}
        </el-button>
      </div>
    </div>

    <el-card v-if="isCreate" shadow="never" class="section-card">
      <template #header><span class="section-title">基础信息</span></template>
      <el-form label-position="top">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="ASIN（亚马逊商品编号）" required>
              <el-input v-model="createForm.asin" placeholder="例如 B0XXXXXXXX" clearable />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="国家站点" required>
              <el-select v-model="createForm.marketplace" filterable default-first-option style="width: 100%">
                <el-option
                  v-for="item in marketplaceOptions"
                  :key="item.value"
                  :value="item.value"
                  :label="item.label"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="AI 指令模板（SOP）" required>
              <el-select
                v-model="createForm.template_id"
                style="width: 100%"
                @change="handleTemplateChange"
              >
                <el-option
                  v-for="tpl in parentTemplates"
                  :key="tpl.id"
                  :value="tpl.id"
                  :label="tpl.name + (tpl.is_default ? '（默认）' : '')"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="模型" required>
              <el-select v-model="createForm.model" filterable style="width: 100%">
                <el-option
                  v-for="item in modelOptions"
                  :key="item.value"
                  :value="item.value"
                  :label="item.label"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="预计成本">
              <div class="cost-line">
                <span class="cost-amount">{{ costText }}</span>
                <el-tag v-if="imageCount > 0" size="small" type="info" effect="plain">
                  {{ costModelLabel }}
                </el-tag>
              </div>
              <div class="field-hint">
                按 {{ outputWidth }}×{{ outputHeight }} 输出、每张最多发送 {{ referenceImageLimit }} 张参考图估算。
              </div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="备注">
              <el-input
                v-model="createForm.remark"
                maxlength="1000"
                show-word-limit
                placeholder="可选，记录这条任务的说明"
              />
            </el-form-item>
          </el-col>
          <el-col :xs="24">
            <el-form-item label="竞品卖点补充（可选，每行一条）">
              <el-input
                v-model="createForm.selling_points"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 6 }"
                placeholder="竞品需要补充或重点强调的卖点"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card v-else-if="detail" shadow="never" class="section-card">
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
                detail.results.map((item) => item.model),
                detail.results.map((item) => item.reference_count)
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

    <el-card v-if="isCreate || detail" shadow="never" class="section-card">
      <template #header>
        <div class="section-head collapsible-head" @click="productPanelOpen = !productPanelOpen">
          <el-icon class="collapse-icon">
            <ArrowDown v-if="productPanelOpen" />
            <ArrowRight v-else />
          </el-icon>
          <span>竞品资料</span>
          <span class="collapse-hint">&gt; 点击展开 / 收起</span>
        </div>
      </template>
      <div v-show="productPanelOpen">
        <div class="field-hint section-tip">
          {{ isCreate
            ? '全部留空时后台自动抓取；填写任意资料后跳过前台抓取，可直接生成。'
            : productEditable
              ? '全部留空时后台自动抓取；填写任意资料后跳过前台抓取，可直接生成。'
              : '任务正在处理中，当前竞品资料仅可查看。'
          }}
        </div>
        <el-form label-position="top" :disabled="!productEditable">
          <el-row :gutter="16">
            <el-col :xs="24" :md="8">
              <el-form-item label="竞品品牌名">
                <el-input v-model="productForm.brand_name" placeholder="例如 Braun" clearable />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="16">
              <el-form-item label="竞品标题">
                <el-input v-model="productForm.product_title" type="textarea" :rows="2" placeholder="填写竞品标题" />
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
                  :placeholder="`每行一个图片 URL，最多 ${MAX_REFERENCE_IMAGES} 张`"
                />
                <div class="image-action-row">
                  <span class="limit-hint" :class="{ danger: manualImageCount > MAX_REFERENCE_IMAGES }">
                    已填写 {{ manualImageCount }} / {{ MAX_REFERENCE_IMAGES }} 张
                  </span>
                  <el-button
                    v-if="productEditable"
                    size="small"
                    :icon="Upload"
                    :loading="uploading"
                    @click="fileInput?.click()"
                  >
                    上传本地图片
                  </el-button>
                </div>
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      </div>
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

    <el-card v-if="isCreate || detail" shadow="never" class="section-card">
      <template #header>
        <div class="section-head">
          <span>子模板生成清单</span>
          <div class="head-actions">
            <span class="section-count">
              {{ isCreate
                ? `已选 ${selectedSubtemplateIds.length} / 共 ${subtemplateRows.length} 张`
                : `共 ${subtemplateRows.length} 张`
              }}
            </span>
            <el-button
              type="primary"
              size="small"
              :icon="Download"
              :loading="downloadingZip"
              :disabled="!previewUrls.length"
              @click="downloadBatch"
            >
              批量下载
            </el-button>
          </div>
        </div>
      </template>

      <el-table :data="subtemplateRows" border class="subtemplate-table">
        <el-table-column type="index" label="#" width="68" align="center" />
        <el-table-column label="图片名称（子模板名称）" width="212">
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column label="模型" width="211">
          <template #default="{ row, $index }">
            {{ formatDoubaoModelLabel(isCreate ? createForm.model : resultFor(row, $index)?.model || detail?.model) }}
          </template>
        </el-table-column>
        <el-table-column label="自定义说明" width="278">
          <template #default="{ row }">
            <el-input
              v-if="row.id"
              v-model="notes[row.id]"
              type="textarea"
              :rows="2"
              resize="none"
              placeholder="将追加到该子模板变量中"
            />
            <span v-else class="field-hint">独立模板暂不支持单图说明</span>
          </template>
        </el-table-column>
        <el-table-column v-if="isCreate" label="开关" width="68" align="center">
          <template #default="{ row }">
            <el-checkbox v-if="row.id" v-model="selected[row.id]" />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="116" align="center">
          <template #default="{ row, $index }">
            <span v-if="isCreate">—</span>
            <StatusTag v-else :status="rowStatus(row, $index)" />
          </template>
        </el-table-column>
        <el-table-column label="生成结果" width="220" align="center">
          <template #default="{ row, $index }">
            <template v-if="isCreate">—</template>
            <el-image
              v-else-if="resultFor(row, $index)"
              :src="resultUrls[resultFor(row, $index)!.id]"
              :preview-src-list="previewUrls"
              :initial-index="detail?.results.findIndex((item) => item.id === resultFor(row, $index)!.id) ?? 0"
              :z-index="4000"
              preview-teleported
              fit="cover"
              class="result-thumb"
            />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="113" align="center">
          <template #default="{ row }">
            <template v-if="isCreate">—</template>
            <el-button
              v-else-if="row.id"
              link
              type="warning"
              size="small"
              :disabled="['fetching', 'generating'].includes(detail?.status ?? '')"
              @click="handleRetryRow(row)"
            >
              重做
            </el-button>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="下载" width="76" align="center">
          <template #default="{ row, $index }">
            <template v-if="isCreate">—</template>
            <el-button
              v-else-if="resultFor(row, $index)"
              link
              type="primary"
              size="small"
              :icon="Download"
              @click="downloadSingle(row, $index)"
            />
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
.task-workspace {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 300px;
}

.detail-toolbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);

  &::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 100%;
    height: 60px;
    background: #fff;
  }

  .title {
    font-size: 14px;
    font-weight: 600;
  }

  .head-actions {
    margin-left: auto;
  }
}

.section-card {
  :deep(> .el-card__header) {
    padding: 12px 16px;
  }
}

.section-title {
  font-size: 14px;
  font-weight: 600;
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

.collapsible-head {
  cursor: pointer;
  user-select: none;
}

.collapse-icon,
.collapse-hint,
.section-count {
  color: #909399;
  font-size: 12px;
}

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.section-tip {
  margin: 0 0 12px;
}

.cost-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cost-amount {
  font-size: 16px;
  font-weight: 600;
  color: #e6a23c;
}

.image-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.limit-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;

  &.danger {
    color: #f56c6c;
  }
}

.image-action-row .limit-hint {
  margin-top: 0;
}

.error-text {
  color: #f56c6c;
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

.subtemplate-table {
  :deep(.el-table__row) {
    height: 196px;
  }

  :deep(.el-table__cell) {
    padding: 4px 0;
  }

  :deep(.el-table__cell .cell) {
    line-height: 1.4;
    white-space: nowrap;
  }

  :deep(.el-textarea__inner) {
    line-height: 1.4;
  }
}

.result-thumb {
  width: 180px;
  height: 180px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}

:global(.el-image-viewer__wrapper) {
  z-index: 4000 !important;
}
</style>
