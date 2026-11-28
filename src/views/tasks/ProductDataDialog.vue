<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Upload } from '@element-plus/icons-vue'
import { updateTaskProductData, uploadReferenceImage, type TaskRow } from '@/api/tasks'
import { MAX_REFERENCE_IMAGES } from '@/constants/pricing'
import { useUserStore } from '@/stores/user'

const props = defineProps<{
  modelValue: boolean
  task: TaskRow | null
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'saved'): void }>()

const userStore = useUserStore()
const fileInput = ref<HTMLInputElement>()
const saving = ref(false)
const uploading = ref(false)

const title = ref('')
const brand = ref('')
const bulletsText = ref('')
const imagesText = ref('')
const imageUrlCount = computed(
  () => imagesText.value.split('\n').map((s) => s.trim()).filter(Boolean).length
)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const isOwner = computed(
  () => Boolean(props.task && userStore.user && props.task.created_by === userStore.user.id)
)
const editable = computed(() => {
  if (!props.task) return false
  const allowedStatus = ['pending_fetch', 'queued', 'failed', 'succeeded']
  return (userStore.role === 'admin' || isOwner.value) && allowedStatus.includes(props.task.status)
})

function fillForm() {
  if (!props.task) return
  title.value = props.task.product_title ?? ''
  brand.value = props.task.brand_name ?? ''
  bulletsText.value = (props.task.product_bullets ?? []).join('\n')
  imagesText.value = (props.task.product_images ?? []).join('\n')
}

watch(
  () => [props.modelValue, props.task] as const,
  ([open]) => {
    if (open) fillForm()
  }
)

async function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (!files.length) return

  uploading.value = true
  try {
    const existing = imagesText.value
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const remaining = MAX_REFERENCE_IMAGES - existing.length
    if (remaining <= 0) {
      ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张，请先删除多余图片`)
      return
    }
    const acceptedFiles = files.slice(0, remaining)
    const urls: string[] = []
    for (const file of acceptedFiles) {
      urls.push(await uploadReferenceImage(file))
    }
    imagesText.value = [...existing, ...urls].join('\n')
    ElMessage.success(`已上传 ${urls.length} 张图片`)
    if (files.length > acceptedFiles.length) {
      ElMessage.warning(`超过 ${MAX_REFERENCE_IMAGES} 张的部分未上传`)
    }
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '上传失败')
  } finally {
    uploading.value = false
    input.value = ''
  }
}

async function save() {
  if (!props.task || !editable.value) return
  const images = imagesText.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  if (images.length > MAX_REFERENCE_IMAGES) {
    ElMessage.warning(`竞品图片最多 ${MAX_REFERENCE_IMAGES} 张，请删除多余图片后再保存`)
    return
  }
  saving.value = true
  try {
    await updateTaskProductData(props.task.id, {
      product_title: title.value.trim(),
      brand_name: brand.value.trim(),
      product_bullets: bulletsText.value
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      product_images: images
    })
    ElMessage.success('竞品资料已保存')
    visible.value = false
    emit('saved')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="竞品资料" width="680px">
    <div class="edit-tip">
      {{ editable ? '可编辑竞品品牌名、标题、五点描述与图片 URL；保存后“重做”会按最新竞品资料重新生成。' : '任务正在处理中，当前仅可查看，不可编辑。' }}
    </div>

    <el-form label-position="top" :disabled="!editable">
      <el-form-item label="竞品品牌名">
        <el-input v-model="brand" placeholder="后台自动抓取，可在此修正" />
      </el-form-item>

      <el-form-item label="竞品标题">
        <el-input v-model="title" type="textarea" :rows="3" placeholder="竞品标题" />
      </el-form-item>

      <el-form-item label="竞品五点描述（每行一条）">
        <el-input v-model="bulletsText" type="textarea" :rows="7" placeholder="每行一条五点描述" />
      </el-form-item>

      <el-form-item>
        <template #label>
          <div class="label-row">
            <span>竞品图片 URL（最多 {{ MAX_REFERENCE_IMAGES }} 张，每行一个）</span>
            <el-button
              v-if="editable"
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
          v-model="imagesText"
          type="textarea"
          :rows="5"
          :placeholder="`最多 ${MAX_REFERENCE_IMAGES} 张，每行一个图片 URL，也可点击上方按钮上传本地图片`"
        />
        <div class="limit-hint" :class="{ danger: imageUrlCount > MAX_REFERENCE_IMAGES }">
          已填写 {{ imageUrlCount }} / {{ MAX_REFERENCE_IMAGES }} 张
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
      <el-button @click="visible = false">关闭</el-button>
      <el-button v-if="editable" type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style lang="scss" scoped>
.edit-tip {
  margin-bottom: 12px;
  font-size: 12px;
  color: #909399;
}

.label-row {
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
</style>
