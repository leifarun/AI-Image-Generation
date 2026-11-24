<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { createTask } from '@/api/tasks'
import { fetchActiveTemplates, type SopTemplateRow } from '@/api/sop'
import { fetchDefaultDoubaoModel } from '@/api/settings'
import { MARKETPLACE_OPTIONS, formatMarketplaceLabel } from '@/constants/marketplace'
import {
  estimateTaskCost,
  formatCostRange,
  getDoubaoImagePrice,
  MAX_REFERENCE_IMAGES
} from '@/constants/pricing'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'created'): void }>()

const formRef = ref()
const submitting = ref(false)
const templates = ref<SopTemplateRow[]>([])
const defaultModelId = ref('')

const form = reactive({
  asin: '',
  marketplace: 'US',
  selling_points: '',
  template_id: null as string | null,
  subtemplate_ids: [] as string[]
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

const imageCount = computed(() => {
  if (selectedChildren.value.length) return form.subtemplate_ids.length
  return selectedTemplate.value?.image_count ?? 0
})

const costEstimate = computed(() =>
  estimateTaskCost(defaultModelId.value, imageCount.value, MAX_REFERENCE_IMAGES)
)

const costText = computed(() => {
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
      syncSubtemplateSelection(def.id)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载模板失败')
  }
}

function syncSubtemplateSelection(templateId: string | null) {
  form.subtemplate_ids = templateId
    ? templates.value
        .filter((t) => t.parent_id === templateId)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((t) => t.id)
    : []
}

function handleTemplateChange(templateId: string | null) {
  syncSubtemplateSelection(templateId)
}

async function loadDefaultModel() {
  defaultModelId.value = await fetchDefaultDoubaoModel()
}

function handleClose() {
  emit('update:modelValue', false)
  formRef.value?.resetFields()
  form.selling_points = ''
  form.subtemplate_ids = []
}

async function handleSubmit() {
  await formRef.value.validate()
  if (selectedChildren.value.length && !form.subtemplate_ids.length) {
    ElMessage.warning('请至少勾选一个要生成的子模板')
    return
  }
  submitting.value = true
  try {
    await createTask({
      asin: form.asin,
      marketplace: form.marketplace,
      selling_points: form.selling_points,
      template_id: form.template_id,
      subtemplate_ids: selectedChildren.value.length ? form.subtemplate_ids : []
    })
    ElMessage.success('任务已提交，系统将自动抓取商品资料')
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
  },
  { immediate: true }
)
</script>

<template>
  <el-drawer
    :model-value="props.modelValue"
    title="新建生成任务"
    size="480px"
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
            v-for="item in MARKETPLACE_OPTIONS"
            :key="item.code"
            :value="item.code"
            :label="formatMarketplaceLabel(item.code)"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="卖点补充（可选，每行一条）" prop="selling_points">
        <el-input
          v-model="form.selling_points"
          type="textarea"
          :rows="5"
          placeholder="填写需要补充或重点强调的卖点，例如：&#10;加厚防滑&#10;兼容多种墙面&#10;安装无需专业工具"
        />
        <div class="field-hint">
          这里只填写额外卖点、差异点或需要强调的信息。AI 会结合母模板和本次勾选的子模板统一使用，不需要按图片数量逐条对应。
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
          按 1600×1600 输出、每张最多 {{ MAX_REFERENCE_IMAGES }} 张参考图估算；
          区间下限为无参考图，上限为带满参考图。仅作参考，实际以火山方舟账单为准。
        </div>
      </el-form-item>
    </el-form>

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
