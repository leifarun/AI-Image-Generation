<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
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
  estimateTaskCost,
  formatCostRange,
  getDoubaoImagePrice,
  MAX_REFERENCE_IMAGES
} from '@/constants/pricing'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'created'): void }>()

const formRef = ref()
const fileInput = ref<HTMLInputElement>()
const submitting = ref(false)
const uploading = ref(false)
const templates = ref<SopTemplateRow[]>([])
const defaultModelId = ref('')
const referenceImageLimit = ref(MAX_REFERENCE_IMAGES)
const outputWidth = ref(1600)
const outputHeight = ref(1600)
const supportedMarketplaces = ref<string[]>([])
const manualProductOpen = ref<string[]>([])

const form = reactive({
  asin: '',
  marketplace: 'US',
  selling_points: '',
  template_id: null as string | null,
  subtemplate_ids: [] as string[],
  product_title: '',
  brand_name: '',
  product_bullets_text: '',
  product_images_text: ''
})

const rules = {
  asin: [{ required: true, message: '请输入 ASIN', trigger: 'blur' }],
  marketplace: [{ required: true, message: '请选择站点', trigger: 'change' }],
  template_id: [{ required: true, message: '请选择指令模板', trigger: 'change' }]
}

const parentTemplates = computed(() =>
  templates.value.filter((t) => !t.parent_id)
)

const selectedTemplate = computed(
  () => parentTemplates.value.find((t) => t.id === form.template_id) ?? null
)

const selectedChildren = computed(() =>
  templates.value
    .filter((t) => t.parent_id === form.template_id)
    .sort((a, b) => a.sort_order - b.sort_order)
)

const marketplaceOptions = computed(() =>
  supportedMarketplaces.value.map((code) => ({
    value: code,
    label: formatMarketplaceLabel(code)
  }))
)

const manualImageCount = computed(
  () => form.product_images_text.split('\n').map((item) => item.trim()).filter(Boolean).length
)

const imageCount = computed(() => {
  if (selectedChildren.value.length) return form.subtemplate_ids.length
  return selectedTemplate.value?.image_count ?? 0
})

const costEstimate = computed(() =>
  estimateTaskCost(
    defaultModelId.value,
    imageCount.value,
    referenceImageLimit.value,
    outputWidth.value,
    outputHeight.value
  )
)

const costText = computed(() => {
  if (selectedChildren.value.length && imageCount.value <= 0) return '请选择至少一张图片'
  if (imageCount.value <= 0) return '选择模板后显示'
  return formatCostRange(costEstimate.value)
})

const costModelLabel = computed(
  () => getDoubaoImagePrice(defaultModelId.value).label
)

async function loadTemplates() {
  try {
    templates.value = await fetchActiveTemplates()
    // 默认选中"默认模板"
    if (!form.template_id && parentTemplates.value.length) {
      const def = parentTemplates.value.find((t) => t.is_default) ?? parentTemplates.value[0]
      form.template_id = def.id
      syncSubtemplateSelection()
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载模板失败')
  }
}

function syncSubtemplateSelection() {
  // 子模板默认全部不勾选，避免误生成全部图片并产生费用。
  form.subtemplate_ids = []
}

function handleTemplateChange() {
  syncSubtemplateSelection()
}

async function loadDefaultModel() {
  defaultModelId.value = await fetchDefaultDoubaoModel()
}

async function loadMarketplaces() {
  try {
    supportedMarketplaces.value = await fetchSupportedMarketplaces()
    if (supportedMarketplaces.value.length && !supportedMarketplaces.value.includes(form.marketplace)) {
      form.marketplace = supportedMarketplaces.value[0]
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载可用站点失败')
  }
}

async function loadReferenceImageLimit() {
  referenceImageLimit.value = await fetchReferenceImageLimit()
}

async function loadOutputResolution() {
  const resolution = await fetchOutputResolution()
  outputWidth.value = resolution.width
  outputHeight.value = resolution.height
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
    manualProductOpen.value = ['product']
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

function handleClose() {
  emit('update:modelValue', false)
  formRef.value?.resetFields()
  form.selling_points = ''
  form.subtemplate_ids = []
  form.product_title = ''
  form.brand_name = ''
  form.product_bullets_text = ''
  form.product_images_text = ''
  manualProductOpen.value = []
}

async function handleSubmit() {
  await formRef.value.validate()
  if (selectedChildren.value.length && !form.subtemplate_ids.length) {
    ElMessage.warning('请至少勾选一个要生成的子模板')
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
    await createTask({
      asin: form.asin,
      marketplace: form.marketplace,
      selling_points: form.selling_points,
      template_id: form.template_id,
      subtemplate_ids: selectedChildren.value.length ? form.subtemplate_ids : [],
      model: defaultModelId.value,
      product_title: form.product_title,
      brand_name: form.brand_name,
      product_bullets: form.product_bullets_text
        .split('\n')
        .map((item) => item.trim())
        .filter(Boolean),
      product_images: productImages
    })
    ElMessage.success('任务已提交')
    emit('created')
    handleClose()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '提交失败')
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    void loadTemplates()
    void loadDefaultModel()
    void loadMarketplaces()
    void loadReferenceImageLimit()
    void loadOutputResolution()
  },
  { immediate: true }
)
</script>

<template>
  <el-drawer
    :model-value="props.modelValue"
    title="新建生成任务"
    size="560px"
    @close="handleClose"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="ASIN（亚马逊商品编号）" prop="asin">
        <el-input v-model="form.asin" placeholder="例如 B0XXXXXXXX" clearable />
      </el-form-item>

      <el-form-item label="国家站点" prop="marketplace">
        <el-select
          v-model="form.marketplace"
          style="width: 100%"
          filterable
          default-first-option
          placeholder="输入代码或国家名搜索"
        >
          <el-option
            v-for="item in marketplaceOptions"
            :key="item.value"
            :value="item.value"
            :label="item.label"
          />
        </el-select>
      </el-form-item>

      <el-collapse v-model="manualProductOpen" class="manual-product">
        <el-collapse-item name="product">
          <template #title>
            <span class="manual-product-title">手动提供竞品资料（可选）</span>
          </template>
          <div class="field-hint manual-product-tip">
            全部留空时，系统会按所选站点到亚马逊前台自动抓取。填写任意资料后，将优先使用手动内容，不再自动覆盖。
            当前会按图片顺序发送前 {{ referenceImageLimit }} 张给豆包。
          </div>

          <el-form-item label="竞品品牌名">
            <el-input v-model="form.brand_name" placeholder="例如 Braun" clearable />
          </el-form-item>

          <el-form-item label="竞品标题">
            <el-input
              v-model="form.product_title"
              type="textarea"
              :rows="2"
              placeholder="填写竞品标题"
            />
          </el-form-item>

          <el-form-item label="竞品五点描述（每行一条）">
            <el-input
              v-model="form.product_bullets_text"
              type="textarea"
              :rows="4"
              placeholder="每行填写一条五点描述"
            />
          </el-form-item>

          <el-form-item>
            <template #label>
              <div class="manual-image-label">
                <span>竞品图片 URL（最多 {{ MAX_REFERENCE_IMAGES }} 张）</span>
                <el-button
                  size="small"
                  :icon="Upload"
                  :loading="uploading"
                  @click="fileInput?.click()"
                >
                  上传本地图片
                </el-button>
              </div>
            </template>
            <el-input
              v-model="form.product_images_text"
              type="textarea"
              :rows="3"
              :placeholder="`每行一个图片 URL，也可上传本地图片，最多 ${MAX_REFERENCE_IMAGES} 张`"
            />
            <div class="limit-hint" :class="{ danger: manualImageCount > MAX_REFERENCE_IMAGES }">
              已填写 {{ manualImageCount }} / {{ MAX_REFERENCE_IMAGES }} 张
            </div>
          </el-form-item>
        </el-collapse-item>
      </el-collapse>

      <el-form-item label="竞品卖点补充（可选，每行一条）" prop="selling_points">
        <el-input
          v-model="form.selling_points"
          type="textarea"
          :rows="5"
          placeholder="填写竞品需要补充或重点强调的卖点，例如：&#10;加厚防滑&#10;兼容多种墙面&#10;安装无需专业工具"
        />
        <div class="field-hint">
          这里只填写竞品的额外卖点、差异点或需要强调的信息。AI 会结合母模板和本次勾选的子模板统一使用，不需要按图片数量逐条对应。
        </div>
      </el-form-item>

      <el-form-item label="AI 指令模板（SOP）" prop="template_id">
        <el-select
          v-model="form.template_id"
          placeholder="请选择"
          style="width: 100%"
          @change="handleTemplateChange"
        >
          <el-option
            v-for="t in parentTemplates"
            :key="t.id"
            :value="t.id"
            :label="t.name + (t.is_default ? '（默认）' : '')"
          />
        </el-select>
        <div v-if="!parentTemplates.length" class="no-template-hint">
          暂无可用模板，请联系管理员先在「指令模板」中创建
        </div>
      </el-form-item>

      <el-form-item v-if="selectedChildren.length" label="本次生成哪些图（可多选）">
        <el-checkbox-group v-model="form.subtemplate_ids" class="subtemplate-check">
          <el-checkbox
            v-for="child in selectedChildren"
            :key="child.id"
            :value="child.id"
            class="subtemplate-item"
          >
            {{ child.name }}
          </el-checkbox>
        </el-checkbox-group>
        <div class="field-hint">勾选几张就生成几张，顺序按模板里的排序。</div>
      </el-form-item>

      <el-form-item label="预计调用成本">
        <div class="cost-line">
          <span class="cost-amount">{{ costText }}</span>
          <el-tag v-if="imageCount > 0" size="small" type="info" effect="plain">
            {{ costModelLabel }}
          </el-tag>
        </div>
        <div class="field-hint">
          按 {{ outputWidth }}×{{ outputHeight }} 输出、每张最多发送 {{ referenceImageLimit }} 张参考图估算；
          区间下限为无参考图，上限为带满参考图。仅作参考，实际以火山方舟账单为准。
        </div>
      </el-form-item>
    </el-form>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      hidden
      @change="handleFiles"
    />

    <template #footer>
      <el-button @click="handleClose">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">提交</el-button>
    </template>
  </el-drawer>
</template>

<style lang="scss" scoped>
.no-template-hint {
  font-size: 12px;
  color: #e6a23c;
  line-height: 1.5;
}

.field-hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin-top: 4px;
}

.manual-product {
  margin: -2px 0 18px;
  border-top: 0;
  border-bottom: 0;
}

.manual-product-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.manual-product-tip {
  margin: 0 0 12px;
}

.manual-image-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.limit-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;

  &.danger {
    color: #f56c6c;
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

.subtemplate-check {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.subtemplate-item {
  width: 100%;
  height: auto;
  margin-right: 0;
}
</style>
