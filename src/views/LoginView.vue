<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { isSupabaseConfigured } from '@/api/supabase'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const formRef = ref()
const loading = ref(false)
const form = reactive({
  loginId: '',
  password: ''
})

const rules = {
  loginId: [{ required: true, message: '请输入登录 ID', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin() {
  await formRef.value.validate()
  loading.value = true
  try {
    await userStore.login(form.loginId, form.password)
    ElMessage.success('登录成功')
    router.push((route.query.redirect as string) || '/dashboard')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-head">
        <span class="logo-badge">AI</span>
        <h1>AI 图片工场</h1>
        <p class="sub">内部系统 · 未开放注册</p>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large" @keyup.enter="handleLogin">
        <el-form-item label="登录 ID" prop="loginId">
          <el-input v-model="form.loginId" placeholder="请输入登录 ID" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" />
        </el-form-item>
        <el-button
          type="primary"
          class="login-btn"
          :loading="loading"
          :disabled="!isSupabaseConfigured"
          @click="handleLogin"
        >
          登 录
        </el-button>
      </el-form>

      <div v-if="!isSupabaseConfigured" class="hint">
        登录功能将在数据库接通（阶段4）后启用
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.login-page {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #f0f4f8 0%, #f5f7fa 100%);

  .login-card {
    width: 360px;
    padding: 36px 32px 28px;
    background: #fff;
    border: 1px solid #e4e7ed;
    border-radius: 12px;

    .login-head {
      text-align: center;
      margin-bottom: 24px;

      .logo-badge {
        display: inline-flex;
        width: 40px;
        height: 40px;
        border-radius: 10px;
        background: #185fa5;
        color: #fff;
        font-size: 16px;
        font-weight: 600;
        align-items: center;
        justify-content: center;
      }

      h1 {
        margin: 12px 0 4px;
        font-size: 18px;
        font-weight: 500;
        color: #303133;
      }

      .sub {
        margin: 0;
        font-size: 12px;
        color: #909399;
      }
    }

    .login-btn {
      width: 100%;
      margin-top: 8px;
    }

    .hint {
      margin-top: 12px;
      font-size: 12px;
      color: #e6a23c;
      text-align: center;
    }

    .preview-entry {
      margin-top: 12px;
      text-align: center;
    }
  }
}
</style>
