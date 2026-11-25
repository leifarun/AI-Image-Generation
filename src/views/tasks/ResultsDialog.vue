<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import JSZip from 'jszip'
import { resolveTaskResultUrls } from '@/api/tasks'

const props = defineProps<{
  modelValue: boolean
  taskId: string
  imagePaths: string[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

const loading = ref(false)
const urls = ref<string[]>([])
const downloading = ref(false)

watch(
  () => [props.modelValue, props.imagePaths] as const,
  async ([open, paths]) => {
    if (!open) return
    loading.value = true
    try {
      urls.value = await resolveTaskResultUrls(paths)
    } catch (e) {
      ElMessage.error(e instanceof Error ? e.message : '图片加载失败')
      urls.value = []
    } finally {
      loading.value = false
    }
  },
  { immediate: true }
)

async function downloadAll() {
  if (!urls.value.length) return
  downloading.value = true
  try {
    const zip = new JSZip()
    const files = await Promise.all(
      urls.value.map(async (url, index) => {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`第 ${index + 1} 张图片下载失败`)
        const blob = await resp.blob()
        return { index, blob }
      })
    )
    for (const { index, blob } of files) {
      const extension = blob.type.includes('jpeg') ? 'jpg' : 'png'
      zip.file(`image-${String(index + 1).padStart(2, '0')}.${extension}`, blob)
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(zipBlob)
    link.download = `task-${props.taskId}-images.zip`
    link.click()
    URL.revokeObjectURL(link.href)
    ElMessage.success(`已打包 ${files.length} 张图片`)
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '下载失败')
  } finally {
    downloading.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" width="880px">
    <template #header>
      <div class="dialog-head">
        <span>生成结果</span>
        <el-button
          type="primary"
          size="small"
          :icon="Download"
          :loading="downloading"
          :disabled="!urls.length"
          @click="downloadAll"
        >
          批量下载
        </el-button>
      </div>
    </template>

    <div v-loading="loading" class="result-body">
      <div v-if="urls.length" class="result-grid">
        <el-image
          v-for="(url, index) in urls"
          :key="index"
          :src="url"
          :preview-src-list="urls"
          :initial-index="index"
          fit="cover"
          class="result-img"
        />
      </div>
      <el-empty v-else-if="!loading" description="暂无结果图片" :image-size="80" />
    </div>
  </el-dialog>
</template>

<style lang="scss" scoped>
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.result-body {
  min-height: 160px;
}

.result-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.result-img {
  width: 200px;
  height: 200px;
  border-radius: 6px;
  border: 1px solid #ebeef5;
}
</style>
