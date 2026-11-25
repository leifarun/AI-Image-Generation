<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  fetchAllTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  type SopTemplateRow,
  type SopTemplateInput
} from '@/api/sop'
import { formatDateTime } from '@/utils/datetime'

const loading = ref(false)
const list = ref<SopTemplateRow[]>([])

const dialogVisible = ref(false)
const expandedKeys = ref<string[]>([])
const dialogMode = ref<'create' | 'edit' | 'create_child' | 'edit_child'>('create')
const editingId = ref<string | null>(null)
const parentId = ref<string | null>(null)
const submitting = ref(false)

const formRef = ref()
const form = reactive<SopTemplateInput>({
  name: '',
  content: '',
  compliance_redlines: '',
  is_default: false,
  is_active: true,
  image_count: 1,
  parent_id: null,
  sort_order: 0
})

const rules = {
  name: [{ required: true, message: '请输入模板名称', trigger: 'blur' }],
  content: [{ required: true, message: '请输入指令内容', trigger: 'blur' }]
}

const placeholders = [
  { key: '{{图片数量}}', desc: '图片数量' },
  { key: '{{竞品图片}}', desc: '竞品图片' },
  { key: '{{竞品标题}}', desc: '竞品标题' },
  { key: '{{竞品品牌名}}', desc: '竞品品牌名' },
  { key: '{{竞品五点描述}}', desc: '竞品五点描述' },
  { key: '{{竞品卖点补充}}', desc: '竞品卖点补充' },
  { key: '{{违禁词合规红线}}', desc: '违禁词合规红线' },
  { key: '{{竞品资料}}', desc: '全部竞品资料' },
  { key: '{{子模板内容}}', desc: '当前子模板内容' }
]

const parentTemplates = computed(() =>
  list.value.filter((row) => !row.parent_id)
)

const tableData = computed<Array<SopTemplateRow & { children?: SopTemplateRow[] }>>(() =>
  parentTemplates.value.map((parent) => ({
    ...parent,
    children: list.value
      .filter((row) => row.parent_id === parent.id)
      .sort((a, b) => a.sort_order - b.sort_order)
  }))
)

const dialogTitle = computed(() => {
  if (dialogMode.value === 'create') return '新建独立模板'
  if (dialogMode.value === 'create_child') return '新增子模板'
  if (dialogMode.value === 'edit_child') return '编辑子模板'
  return '编辑母模板'
})

const isChildMode = computed(
  () => dialogMode.value === 'create_child' || dialogMode.value === 'edit_child'
)
const contentPlaceholders = computed(() =>
  isChildMode.value
    ? placeholders.filter(
        (p) => p.key !== '{{子模板内容}}' && p.key !== '{{违禁词合规红线}}'
      )
    : placeholders
)
const hasSubtemplateVariable = computed(() => form.content.includes('{{子模板内容}}'))

const isMotherTemplate = computed(
  () => !isChildMode.value && Boolean(editingId.value) && childCount(editingId.value ?? '') > 0
)

async function load() {
  loading.value = true
  try {
    list.value = await fetchAllTemplates()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function childCount(parentId: string): number {
  return list.value.filter((row) => row.parent_id === parentId).length
}

function handleExpandChange(
  row: { id: string },
  expanded: boolean | Array<{ id: string }>
) {
  if (Array.isArray(expanded)) {
    expandedKeys.value = expanded.map((item) => item.id)
    return
  }
  if (expanded) {
    if (!expandedKeys.value.includes(row.id)) expandedKeys.value.push(row.id)
  } else {
    expandedKeys.value = expandedKeys.value.filter((id) => id !== row.id)
  }
}

function openCreate() {
  dialogMode.value = 'create'
  editingId.value = null
  parentId.value = null
  Object.assign(form, {
    name: '',
    content: '',
    compliance_redlines: '',
    is_default: false,
    is_active: true,
    image_count: 1,
    parent_id: null,
    sort_order: 0
  })
  dialogVisible.value = true
}

function openEdit(source: unknown) {
  const row = source as SopTemplateRow
  dialogMode.value = row.parent_id ? 'edit_child' : 'edit'
  editingId.value = row.id
  parentId.value = row.parent_id
  Object.assign(form, {
    name: row.name,
    content: row.content,
    compliance_redlines: row.compliance_redlines ?? '',
    is_default: row.is_default,
    is_active: row.is_active,
    image_count: row.image_count,
    parent_id: row.parent_id,
    sort_order: row.sort_order ?? 0
  })
  dialogVisible.value = true
}

function openCreateChild(source: unknown) {
  const parent = source as SopTemplateRow
  dialogMode.value = 'create_child'
  editingId.value = null
  parentId.value = parent.id
  Object.assign(form, {
    name: '',
    content: '',
    compliance_redlines: '',
    is_default: false,
    is_active: true,
    image_count: 1,
    parent_id: parent.id,
    sort_order: childCount(parent.id) + 1
  })
  dialogVisible.value = true
}

function insertPlaceholder(
  key: string,
  target: 'content' | 'compliance_redlines' = 'content'
) {
  form[target] += key
}

const previewSamples: Record<string, string> = {
  '{{图片数量}}': '3',
  '{{竞品图片}}': '[示例竞品图片 1]\n[示例竞品图片 2]',
  '{{竞品标题}}': '示例竞品标题（Demo Competitor Title）',
  '{{竞品品牌名}}': '示例竞品品牌',
  '{{竞品五点描述}}': '1. 示例卖点一\n2. 示例卖点二\n3. 示例卖点三',
  '{{竞品卖点补充}}': '示例补充卖点',
  '{{违禁词合规红线}}': '[示例合规要求]',
  '{{竞品资料}}': '[完整竞品资料示例]',
  '{{子模板内容}}': '【示例子模板】\n[当前子模板的具体要求]'
}

function renderPreview(text: string): string {
  let out = text || ''
  for (const [key, value] of Object.entries(previewSamples)) {
    out = out.split(key).join(value)
  }
  return out || '（填写内容后显示预览）'
}

const contentPreview = computed(() => renderPreview(form.content))
const redlinePreview = computed(() => renderPreview(form.compliance_redlines))

async function handleSubmit() {
  await formRef.value.validate()
  submitting.value = true
  try {
    const payload: SopTemplateInput = {
      name: form.name,
      content: form.content,
      compliance_redlines: isChildMode.value ? '' : form.compliance_redlines,
      is_default: isChildMode.value ? false : form.is_default,
      is_active: form.is_active,
      image_count: isChildMode.value ? 1 : form.image_count,
      parent_id: isChildMode.value ? parentId.value : null,
      sort_order: isChildMode.value ? form.sort_order : 0
    }

    if (dialogMode.value === 'create' || dialogMode.value === 'create_child') {
      await createTemplate(payload)
      ElMessage.success(isChildMode.value ? '子模板已创建' : '模板已创建')
    } else if (editingId.value) {
      await updateTemplate(editingId.value, payload)
      ElMessage.success(isChildMode.value ? '子模板已更新' : '模板已更新')
    }
    dialogVisible.value = false
    load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(source: unknown) {
  const row = source as SopTemplateRow
  const tip = row.parent_id
    ? `确定删除子模板「${row.name}」吗？`
    : `确定删除模板「${row.name}」吗？其下所有子模板会一并删除。`
  await ElMessageBox.confirm(tip, '删除确认', { type: 'warning' })
  try {
    await deleteTemplate(row.id)
    ElMessage.success('已删除')
    load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function handleToggleActive(source: unknown) {
  const row = source as SopTemplateRow
  try {
    await updateTemplate(row.id, {
      name: row.name,
      content: row.content,
      compliance_redlines: row.compliance_redlines ?? '',
      is_default: row.is_default,
      is_active: !row.is_active,
      image_count: row.image_count,
      parent_id: row.parent_id,
      sort_order: row.sort_order ?? 0
    })
    ElMessage.success(row.is_active ? '已停用' : '已启用')
    load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '操作失败')
  }
}

onMounted(load)
</script>

<template>
  <div class="sop-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>AI 指令 SOP 模板</span>
          <el-button type="primary" size="small" @click="openCreate">新建独立模板</el-button>
        </div>
      </template>

      <el-table
        v-loading="loading"
        :data="tableData"
        border
        row-key="id"
        :tree-props="{ children: 'children' }"
        :expand-row-keys="expandedKeys"
        @expand-change="handleExpandChange"
        :row-class-name="({ row }) => (row.parent_id ? 'child-row' : 'parent-row')"
      >
        <el-table-column label="模板名称" min-width="180">
          <template #default="{ row }">
            <span :class="{ 'child-name': row.parent_id }">{{ row.name }}</span>
            <el-tag
              v-if="!row.parent_id && row.children?.length"
              size="small"
              type="warning"
              effect="plain"
              class="role-tag"
            >
              母模板
            </el-tag>
            <el-tag v-else-if="row.parent_id" size="small" type="info" effect="plain" class="role-tag">
              子模板
            </el-tag>
            <el-tag v-else size="small" effect="plain" class="role-tag">独立模板</el-tag>
          </template>
        </el-table-column>

        <el-table-column label="指令内容" min-width="320">
          <template #default="{ row }">
            <span class="content-preview">{{ row.content }}</span>
          </template>
        </el-table-column>

        <el-table-column label="默认" width="70" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.is_default" type="success" size="small">默认</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>

        <el-table-column label="张数" width="80" align="center">
          <template #default="{ row }">
            {{ row.parent_id ? '—' : `${row.children?.length || row.image_count} 张` }}
          </template>
        </el-table-column>

        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.is_active" @change="handleToggleActive(row)" />
          </template>
        </el-table-column>

        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">{{ formatDateTime(row.updated_at) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button
              v-if="!row.parent_id"
              link
              type="primary"
              size="small"
              @click="openCreateChild(row)"
            >
              新增子模板
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无模板，点击右上角「新建独立模板」开始" :image-size="72" />
        </template>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="680px"
      align-center
      class="sop-template-dialog"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="模板名称" prop="name">
          <el-input v-model="form.name" :placeholder="isChildMode ? '例如：图2 使用场景图' : '例如：主图+附图6张标准版'" />
        </el-form-item>

        <el-form-item v-if="!isChildMode" label="违禁词合规红线（可选）">
          <el-input
            v-model="form.compliance_redlines"
            type="textarea"
            :rows="3"
            placeholder="填写本模板需要遵守的违禁词和合规边界"
          />
          <div class="placeholder-bar">
            <span class="ph-label">红线内可插入变量：</span>
            <el-tag
              v-for="p in contentPlaceholders"
              :key="`redline-${p.key}`"
              class="ph-tag"
              size="small"
              :title="p.desc"
              @click="insertPlaceholder(p.key, 'compliance_redlines')"
            >
              {{ p.key }}
            </el-tag>
          </div>
          <div v-if="redlinePreview" class="preview-box">
            <span class="ph-label">实时预览：</span>
            <pre>{{ redlinePreview }}</pre>
          </div>
        </el-form-item>

        <el-form-item label="指令内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            :placeholder="isChildMode ? '只写这一张图的具体要求，公共规则由母模板提供' : '公共规则：规格、配色、字体、合规红线等'"
          />
          <div class="placeholder-bar">
            <span class="ph-label">可插入变量：</span>
            <el-tag
              v-for="p in contentPlaceholders"
              :key="`content-${p.key}`"
              class="ph-tag"
              size="small"
              :title="p.desc"
              @click="insertPlaceholder(p.key, 'content')"
            >
              {{ p.key }}
            </el-tag>
          </div>
          <div
            v-if="isMotherTemplate && !hasSubtemplateVariable"
            class="form-tip warning-tip"
          >
            母模板包含子模板时，请在需要的位置插入「子模板内容」变量
          </div>
          <div v-if="contentPreview" class="preview-box">
            <span class="ph-label">实时预览：</span>
            <pre>{{ contentPreview }}</pre>
          </div>
        </el-form-item>

        <el-form-item v-if="!isChildMode && !isMotherTemplate" label="生成张数">
          <el-input-number v-model="form.image_count" :min="1" :max="10" />
          <span class="form-tip">母模板按勾选的子模板数生成，此值仅作旧版兼容</span>
        </el-form-item>

        <el-form-item v-if="isChildMode" label="排序">
          <el-input-number v-model="form.sort_order" :min="1" :max="99" />
          <span class="form-tip">数字越小越靠前</span>
        </el-form-item>

        <el-form-item v-if="!isChildMode">
          <el-checkbox v-model="form.is_default">设为默认模板</el-checkbox>
          <el-checkbox v-model="form.is_active">启用</el-checkbox>
        </el-form-item>
        <el-form-item v-else>
          <el-checkbox v-model="form.is_active">启用</el-checkbox>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.content-preview {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
}

.role-tag {
  margin-left: 6px;
}

.child-name {
  padding-left: 18px;
  color: #606266;
}

.form-tip {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
}

.warning-tip {
  display: block;
  margin: 6px 0 0;
  color: #e6a23c;
}

.placeholder-bar {
  margin-top: 8px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;

  .ph-label {
    font-size: 12px;
    color: #909399;
  }

  .ph-tag {
    cursor: pointer;
  }
}

.preview-box {
  margin-top: 8px;
  padding: 10px 12px;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 6px;

  .ph-label {
    font-size: 12px;
    color: #909399;
  }

  pre {
    margin: 6px 0 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.6;
    color: #606266;
  }
}

:global(.sop-template-dialog) {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 32px);
  margin: 0 auto;
}

:global(.sop-template-dialog .el-dialog__body) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 16px;
  scrollbar-width: auto;
  scrollbar-gutter: stable;
}

:global(.sop-template-dialog .el-dialog__footer) {
  flex-shrink: 0;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
  background: #fff;
}

:global(.sop-template-dialog .el-dialog__body::-webkit-scrollbar),
:global(.sop-template-dialog .preview-box::-webkit-scrollbar) {
  width: 14px;
  height: 14px;
}

:global(.sop-template-dialog .el-dialog__body::-webkit-scrollbar-track),
:global(.sop-template-dialog .preview-box::-webkit-scrollbar-track) {
  background: #f2f3f5;
  border-radius: 7px;
}

:global(.sop-template-dialog .el-dialog__body::-webkit-scrollbar-thumb),
:global(.sop-template-dialog .preview-box::-webkit-scrollbar-thumb) {
  min-height: 48px;
  background: #b1b3b8;
  border: 3px solid #f2f3f5;
  border-radius: 7px;
}

:global(.sop-template-dialog .el-dialog__body::-webkit-scrollbar-thumb:hover),
:global(.sop-template-dialog .preview-box::-webkit-scrollbar-thumb:hover) {
  background: #909399;
}

:deep(.child-row) {
  background-color: #fafafa;
}
</style>
