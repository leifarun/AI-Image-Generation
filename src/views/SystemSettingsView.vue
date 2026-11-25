<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  DEFAULT_SYSTEM_SETTINGS,
  fetchSystemSettings,
  saveSystemSettings,
  type SystemSettings
} from '@/api/settings'
import { MARKETPLACE_OPTIONS, formatMarketplaceLabel } from '@/constants/marketplace'

const loading = ref(false)
const saving = ref(false)
const form = reactive<SystemSettings>({ ...DEFAULT_SYSTEM_SETTINGS })

const modelOptions = [
  {
    value: 'doubao-seedream-5-5-261028',
    label: 'Doubao-Seedream-5.5'
  },
  {
    value: 'doubao-seedream-5-0-flash-260915',
    label: 'Doubao-Seedream-5.0-flash'
  },
  {
    value: 'doubao-seedream-5-0-pro-260628',
    label: 'Doubao-Seedream-5.0-pro'
  },
  {
    value: 'doubao-seedream-5-0-260128',
    label: 'Doubao-Seedream-5.0-lite'
  },
  {
    value: 'doubao-seedream-4-5-251128',
    label: 'Doubao-Seedream-4.5'
  },
  {
    value: 'doubao-seedream-4-0-250828',
    label: 'Doubao-Seedream-4.0'
  }
]

const outputFormatOptions = [
  { value: 'jpeg', label: 'JPEG（.jpg）' },
  { value: 'png', label: 'PNG（.png）' }
]

async function load() {
  loading.value = true
  try {
    Object.assign(form, await fetchSystemSettings())
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '系统设置加载失败')
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!form.default_doubao_model.trim()) {
    ElMessage.warning('请填写豆包模型 ID')
    return
  }

  saving.value = true
  try {
    await saveSystemSettings(form)
    ElMessage.success('系统设置已保存，新提交的任务会使用最新配置')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="settings-page" v-loading="loading">
    <el-card shadow="never">
      <template #header>
        <div class="card-head">
          <span>系统设置（管理员专属）</span>
          <el-button type="primary" :loading="saving" @click="handleSave">保存设置</el-button>
        </div>
      </template>

      <el-form :model="form" label-width="190px">
        <el-form-item label="同时生成任务数上限">
          <el-input-number v-model="form.max_concurrent_tasks" :min="1" :max="10" />
          <span class="form-tip">建议先保持 2，确认豆包账号限流后再调高</span>
        </el-form-item>

        <el-form-item label="每分钟豆包请求上限">
          <el-input-number v-model="form.max_requests_per_minute" :min="1" :max="600" />
          <span class="form-tip">参数已保存；当前版本主要由任务并发上限控制实际请求节奏</span>
        </el-form-item>

        <el-divider content-position="left">生成与超时</el-divider>

        <el-form-item label="单张生成超时">
          <el-input-number
            v-model="form.doubao_request_timeout_seconds"
            :min="30"
            :max="130"
            :step="5"
          />
          <span class="form-tip">秒。Supabase Free 的整段后台任务上限为 150 秒，当前最高 130 秒。</span>
        </el-form-item>

        <el-form-item label="默认豆包图片模型">
          <el-select
            v-model="form.default_doubao_model"
            filterable
            allow-create
            default-first-option
            class="model-select"
            placeholder="选择或粘贴火山方舟模型 ID"
          >
            <el-option
              v-for="item in modelOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
          <div class="field-help">
            填写火山方舟模型广场显示的完整模型 ID。任务处理器会自动读取这里的值，保存后无需重新部署云端函数。
          </div>
        </el-form-item>

        <el-form-item label="输出图片分辨率">
          <div class="inline-control">
            <el-input-number v-model="form.output_width" :min="512" :max="4096" :step="64" />
            <span>×</span>
            <el-input-number v-model="form.output_height" :min="512" :max="4096" :step="64" />
            <span>px</span>
          </div>
        </el-form-item>

        <el-form-item label="输出图片格式">
          <el-select v-model="form.output_format" class="compact-select">
            <el-option
              v-for="item in outputFormatOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="单张结果最大体积">
          <el-input-number v-model="form.output_max_mb" :min="1" :max="10" :step="0.5" />
          <span class="form-tip">MB。JPEG 会按质量自动压缩到该大小以内。</span>
        </el-form-item>

        <el-divider content-position="left">竞品参考图压缩</el-divider>

        <el-form-item label="参考图最长边">
          <el-input-number
            v-model="form.reference_max_edge"
            :min="256"
            :max="2048"
            :step="64"
          />
          <span class="form-tip">px。超过该尺寸的图片会等比缩小。</span>
        </el-form-item>

        <el-form-item label="参考图 JPEG 质量">
          <el-input-number
            v-model="form.reference_jpeg_quality"
            :min="50"
            :max="95"
            :step="1"
          />
          <span class="form-tip">建议 85～90。</span>
        </el-form-item>

        <el-form-item label="参考图总大小上限">
          <el-input-number
            v-model="form.reference_max_total_mb"
            :min="1"
            :max="32"
            :step="1"
          />
          <span class="form-tip">MB。压缩并转换 Base64 前的总大小。</span>
        </el-form-item>

        <el-form-item label="发送给豆包的参考图数量">
          <el-input-number
            v-model="form.reference_image_limit"
            :min="1"
            :max="9"
            :step="1"
          />
          <span class="form-tip">张。按竞品图片顺序取前 N 张，当前默认全部 9 张。</span>
        </el-form-item>

        <el-divider content-position="left">站点</el-divider>

        <el-form-item label="支持的亚马逊站点">
          <el-select
            v-model="form.marketplaces"
            multiple
            filterable
            allow-create
            default-first-option
            class="marketplace-select"
            placeholder="输入站点代码"
          >
            <el-option
              v-for="item in MARKETPLACE_OPTIONS"
              :key="item.code"
              :label="formatMarketplaceLabel(item.code)"
              :value="item.code"
            />
          </el-select>
        </el-form-item>
      </el-form>

      <div class="sync-tip">
        保存后，任务处理器会在下一次任务时读取最新配置，无需重新部署云端函数。
      </div>
    </el-card>

    <el-alert
      title="模型使用提示"
      type="warning"
      :closable="false"
      show-icon
    >
      <template #default>
        模型 ID 存在不等于账号已开通。若任务仍提示 404 / InvalidEndpointOrModel，请到火山方舟模型广场开通对应模型。
      </template>
    </el-alert>
  </div>
</template>

<style lang="scss" scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-tip {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
}

.field-help {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: #909399;
}

.model-select {
  width: min(520px, 100%);
}

.compact-select {
  width: 180px;
}

.inline-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.marketplace-select {
  width: min(650px, 100%);
}

.sync-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #67a23a;
}
</style>
