<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowDown, ArrowRight, Upload } from '@element-plus/icons-vue'
import { createTask, uploadReferenceImage } from '@/api/tasks'
import { fetchActiveTemplates, type SopTemplateRow } from '@/api/sop'
import {
  fetchDefaultDoubaoModel,
  fetchOutputResolution,
  fetchReferenceImageLimit,
  fetchSupportedMarketplaces
} from '@/api/settings'
import { formatMarketplaceLabel } from '@/constants/marketplace'
import {
  DOUBAO_IMAGE_PRICES,
  estimateTaskCost,
  formatCostRange,
  formatDoubaoModelLabel,
  getDoubaoImagePrice,
  MAX_REFERENCE_IMAGES
} from '@/constants/pricing'

interface SubtemplateRow {
  key: string
  id: string | null
  name: string
}

const router = useRouter()
const formRef = ref()
const fileInput = ref<HTMLInputElement>()
const loading = ref(false)
const submitting = ref(false)
const uploading = ref(false)
const productPanelOpen = ref(false)

const templates = ref<SopTemplateRow[]>([])
const defaultModelId = ref('')
const referenceImageLimit = ref(MAX_REFERENCE_IMAGES)
const outputWidth = ref(1600)
const outputHeight = ref(1600)
const supportedMarketplaces = ref<string[]>([])

const form = reactive({
  asin: '',
  marketplace: 'US',
  selling_points: '',
  remark: '',
  template_id: null as string | null,
  model: '',
  product_title: '',
  brand_name: '',
  product_bullets_text: '',
  product_images_text: ''
})

const notes = reactive<Record<string, string>>({})
const selected = reactive<Record<string, boolean>>({})

const rules = {
  asin: [{ required: true, message: '请输入 ASIN', trigger: 'blur' }],
  marketplace: [{ required: true, message: '请选择站点', trigger: 'change' }],
  template_id: [{ required: true, message: '请选择指令模板', trigger: 'change' }],
  model: [{ required: true, message: '请选择模型', trigger: 'change' }]
}

const parentTemplates = computed(() => templates.value.filter((t) => !t.parent_id))

const selectedTemplate = computed(
  () => parentTemplates.value.find((t) => t.id === form.template_id) ?? null
)

const selectedChildren = computed(() =>
  templates.value
    .filter((t) => t.parent_id === form.template_id)
    .sort((a, b) => a.sort_order - b.sort_order)
)

const subtemplateRows = computed<SubtemplateRow[]>(() => {
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
})

const selectedSubtemplateIds = computed(() =>
  subtemplateRows.value
    .map((row) => row.id)
    .filter((id): id is string => Boolean(id && selected[id]))
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
  () => form.product_images_text.split('\n').map((item) => item.trim()).filter(Boolean).length
)

const imageCount = computed(() =>
  selectedChildren.value.length
    ? selectedSubtemplateIds.value.length
    : subtemplateRows.value.length
)

const costEstimate = computed(() =>
  estimateTaskCost(
    form.model,
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

const costModelLabel = computed(() => getDoubaoImagePrice(form.model).label)

async function loadTemplates() {
  try {
    templates.value = await fetchActiveTemplates()
    if (!form.template_id && parentTemplates.value.length) {
      const def = parentTemplates.value.find((t) => t.is_default) ?? parentTemplates.value[0]
      form.template_id = def.id
    }
    resetNotesForTemplate()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载模板失败')
  }
}

function resetNotesForTemplate() {
  for (const key of Object.keys(notes)) delete notes[key]
  for (const key of Object.keys(selected)) delete selected[key]
  for (const row of subtemplateRows.value) {
    if (row.id) notes[row.id] = ''
    if (row.id) selected[row.id] = false
  }
}

function handleTemplateChange() {
  resetNotesForTemplate()
}

async function loadDefaults() {
  const results = await Promise.allSettled([
    fetchDefaultDoubaoModel(),
    fetchSupportedMarketplaces(),
    fetchReferenceImageLimit(),
    fetchOutputResolution()
  ])

  const [model, marketplaces, refLimit, resolution] = results
  if (model.status === 'fulfilled') {
    defaultModelId.value = model.value
    form.model = form.model || model.value
  }
  if (marketplaces.status === 'fulfilled') {
    supportedMarketplaces.value = marketplaces.value
    if (supportedMarketplaces.value.length && !supportedMarketplaces.value.includes(form.marketplace)) {
      form.marketplace = supportedMarketplaces.value[0]
    }
  }
  if (refLimit.status === 'fulfilled') referenceImageLimit.value = refLimit.value
  if (resolution.status === 'fulfilled') {
    outputWidth.value = resolution.value.width
    outputHeight.value = resolution.value.height
  }
}

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return

  uploading.value = true
  try {
    const existing = form.product_images_text
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
    for (const file of accepted) {
      urls.push(await uploadReferenceImage(file))
    }
    form.product_images_text = [...existing, ...urls].join('\n')
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

async function handleSubmit() {
  await formRef.value.validate()
  if (selectedChildren.value.length && !selectedSubtemplateIds.value.length) {
    ElMessage.warning('请至少勾选一张要生成的图片')
    return
  }
  const productImages = form.product_images_text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
  if (productImages.length > MAX_REFERENCE_IMAGES) {
    ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张`)
    return
  }

  submitting.value = true
  try {
    const subtemplateIds = selectedChildren.value.length
      ? selectedSubtemplateIds.value
      : []
    const payloadNotes: Record<string, string> = {}
    for (const row of subtemplateRows.value) {
      if (row.id && (notes[row.id] ?? '').trim()) {
        payloadNotes[row.id] = notes[row.id].trim()
      }
    }

    const id = await createTask({
      asin: form.asin,
      marketplace: form.marketplace,
      selling_points: form.selling_points,
      remark: form.remark,
      template_id: form.template_id,
      subtemplate_ids: subtemplateIds,
      subtemplate_notes: payloadNotes,
      model: form.model,
      product_title: form.product_title,
      brand_name: form.brand_name,
      product_bullets: form.product_bullets_text
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      product_images: productImages
    })
    ElMessage.success('任务已提交')
    router.push(`/tasks/${id}`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await loadTemplates()
    await loadDefaults()
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div v-loading="loading" class="task-create">
    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="card-head">
          <el-button size="small" @click="router.push('/tasks')">返回列表</el-button>
          <span class="title">新建生成任务</span>
          <div class="head-actions">
            <el-button type="primary" :loading="submitting" @click="handleSubmit">提交任务</el-button>
          </div>
        </div>
      </template>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-row :gutter="16">
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="ASIN（亚马逊商品编号）" prop="asin">
              <el-input v-model="form.asin" placeholder="例如 B0XXXXXXXX" clearable />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="国家站点" prop="marketplace">
              <el-select v-model="form.marketplace" filterable default-first-option style="width: 100%">
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
            <el-form-item label="AI 指令模板（SOP）" prop="template_id">
              <el-select v-model="form.template_id" style="width: 100%" @change="handleTemplateChange">
                <el-option
                  v-for="t in parentTemplates"
                  :key="t.id"
                  :value="t.id"
                  :label="t.name + (t.is_default ? '（默认）' : '')"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="模型" prop="model">
              <el-select v-model="form.model" filterable style="width: 100%">
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
                按 {{ outputWidth }}×{{ outputHeight }} 输出、每张最多发送 {{ referenceImageLimit }} 张参考图估算，实际以火山方舟账单为准。
              </div>
            </el-form-item>
          </el-col>
          <el-col :xs="24" :sm="12" :md="8">
            <el-form-item label="备注">
              <el-input v-model="form.remark" maxlength="1000" show-word-limit placeholder="可选，记录这条任务的说明" />
            </el-form-item>
          </el-col>
          <el-col :xs="24">
            <el-form-item label="竞品卖点补充（可选，每行一条）">
              <el-input
                v-model="form.selling_points"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 6 }"
                placeholder="竞品需要补充或重点强调的卖点，例如：加厚防滑&#10;兼容多种墙面&#10;安装无需专业工具"
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card shadow="never" class="section-card">
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
          全部留空时，系统会按所选站点到亚马逊前台自动抓取；填写任意资料后，将优先使用手动内容，不再自动覆盖。当前会按图片顺序发送前 {{ referenceImageLimit }} 张给豆包。
        </div>
        <el-row :gutter="16">
          <el-col :xs="24" :md="8">
            <el-form-item label="竞品品牌名">
              <el-input v-model="form.brand_name" placeholder="例如 Braun" clearable />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="16">
            <el-form-item label="竞品标题">
              <el-input v-model="form.product_title" type="textarea" :rows="2" placeholder="填写竞品标题" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item label="竞品五点描述（每行一条）">
              <el-input v-model="form.product_bullets_text" type="textarea" :rows="6" placeholder="每行填写一条五点描述" />
            </el-form-item>
          </el-col>
          <el-col :xs="24" :md="12">
            <el-form-item :label="`竞品图片 URL（最多 ${MAX_REFERENCE_IMAGES} 张，每行一个）`">
              <el-input
                v-model="form.product_images_text"
                type="textarea"
                :rows="6"
                :placeholder="`每行一个图片 URL，最多 ${MAX_REFERENCE_IMAGES} 张`"
              />
              <div class="image-action-row">
                <span class="limit-hint" :class="{ danger: manualImageCount > MAX_REFERENCE_IMAGES }">
                  已填写 {{ manualImageCount }} / {{ MAX_REFERENCE_IMAGES }} 张
                </span>
                <el-button size="small" :icon="Upload" :loading="uploading" @click="fileInput?.click()">
                  上传本地图片
                </el-button>
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="handleFiles" />
      </div>
    </el-card>

    <el-card shadow="never" class="section-card">
      <template #header>
        <div class="section-head">
          <span>子模板生成清单</span>
          <span class="section-count">
            已选 {{ selectedSubtemplateIds.length }} / 共 {{ subtemplateRows.length }} 张
          </span>
        </div>
      </template>
      <el-table :data="subtemplateRows" border>
        <el-table-column type="index" label="#" width="48" align="center" />
        <el-table-column label="图片名称（子模板名称）" min-width="160">
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column label="模型" min-width="150">
          <template #default>{{ formatDoubaoModelLabel(form.model) }}</template>
        </el-table-column>
        <el-table-column label="自定义说明" min-width="220">
          <template #default="{ row }">
            <el-input
              v-if="row.id"
              v-model="notes[row.id]"
              type="textarea"
              :autosize="{ minRows: 1, maxRows: 3 }"
              placeholder="可选，将追加到该子模板变量中"
            />
            <span v-else class="field-hint">独立模板暂不支持单图说明</span>
          </template>
        </el-table-column>
        <el-table-column label="开关" width="64" align="center">
          <template #default="{ row }">
            <el-checkbox v-if="row.id" v-model="selected[row.id]" />
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="当前状态" width="90" align="center">
          <template #default>—</template>
        </el-table-column>
        <el-table-column label="生成结果" width="100" align="center">
          <template #default>—</template>
        </el-table-column>
        <el-table-column label="操作" width="80" align="center">
          <template #default>—</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style lang="scss" scoped>
.task-create {
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  }
}

.section-head {
  display: flex;
  align-items: center;
  gap: 12px;

  .section-count {
    margin-left: auto;
    color: #909399;
    font-size: 12px;
  }
}

.collapsible-head {
  cursor: pointer;
  user-select: none;
}

.collapse-icon {
  color: #909399;
}

.collapse-hint {
  color: #909399;
  font-size: 12px;
}

.section-tip {
  margin: 0 0 12px;
}

.image-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;

  .limit-hint {
    margin-top: 0;
  }
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

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.limit-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;

  &.danger {
    color: #f56c6c;
  }
}
</style>
