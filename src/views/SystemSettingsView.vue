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

.marketplace-select {
  width: min(650px, 100%);
}
</style>
