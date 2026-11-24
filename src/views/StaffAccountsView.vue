<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { Key, Plus, Refresh } from '@element-plus/icons-vue'
import {
  createStaff,
  fetchStaff,
  resetStaffPassword,
  updateStaff,
  type StaffRole,
  type StaffRow,
  type StaffStatus
} from '@/api/staff'
import { useUserStore } from '@/stores/user'
import { formatDateTime } from '@/utils/datetime'

const userStore = useUserStore()
const loading = ref(false)
const rows = ref<StaffRow[]>([])
const search = ref('')
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const submitting = ref(false)
const formRef = ref<FormInstance>()

const resetVisible = ref(false)
const resetSubmitting = ref(false)
const resetTarget = ref<StaffRow | null>(null)
const resetPassword = ref('')
const resetFormRef = ref<FormInstance>()

const form = reactive({
  id: '',
  name: '',
  loginId: '',
  password: '',
  role: 'operator' as StaffRole,
  status: 'active' as StaffStatus
})

const filteredRows = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return rows.value
  return rows.value.filter(
    (row) =>
      row.name.toLowerCase().includes(keyword) ||
      row.login_id.toLowerCase().includes(keyword)
  )
})

const dialogTitle = computed(() => (dialogMode.value === 'create' ? '新增员工账号' : '编辑员工账号'))
const isEditingSelf = computed(() => dialogMode.value === 'edit' && form.id === userStore.user?.id)

const formRules: FormRules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  loginId: [
    { required: true, message: '请输入登录 ID', trigger: 'blur' },
    {
      pattern: /^[\p{L}\p{N}_-]{2,32}$/u,
      message: '2~32 个字母、数字、下划线或短横线',
      trigger: 'blur'
    }
  ],
  password: [
    { required: true, message: '请设置初始密码', trigger: 'blur' },
    { min: 8, max: 72, message: '密码需为 8~72 个字符', trigger: 'blur' }
  ]
}

const resetRules: FormRules = {
  password: [
    { required: true, message: '请设置新密码', trigger: 'blur' },
    { min: 8, max: 72, message: '密码需为 8~72 个字符', trigger: 'blur' }
  ]
}

async function loadData() {
  loading.value = true
  try {
    rows.value = await fetchStaff()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '员工列表加载失败')
  } finally {
    loading.value = false
  }
}

function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '23456789'
  const symbols = '!@#$%&*'
  const all = upper + lower + digits + symbols
  const target = new Uint32Array(14)
  crypto.getRandomValues(target)
  const required = [
    upper[target[0] % upper.length],
    lower[target[1] % lower.length],
    digits[target[2] % digits.length],
    symbols[target[3] % symbols.length]
  ]
  const rest = Array.from(target.slice(4), (value) => all[value % all.length])
  const chars = [...required, ...rest]
  const random = new Uint32Array(chars.length)
  crypto.getRandomValues(random)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = random[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

function openCreate() {
  dialogMode.value = 'create'
  Object.assign(form, {
    id: '',
    name: '',
    loginId: '',
    password: generatePassword(),
    role: 'operator',
    status: 'active'
  })
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

function openEdit(source: unknown) {
  const row = source as StaffRow
  dialogMode.value = 'edit'
  Object.assign(form, {
    id: row.id,
    name: row.name,
    loginId: row.login_id,
    password: '',
    role: row.role,
    status: row.status
  })
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    if (dialogMode.value === 'create') {
      await createStaff({
        name: form.name.trim(),
        loginId: form.loginId.trim(),
        password: form.password,
        role: form.role
      })
      ElMessage.success('员工账号已创建')
    } else {
      await updateStaff({
        userId: form.id,
        name: form.name.trim(),
        loginId: form.loginId.trim(),
        role: form.role,
        status: form.status
      })
      ElMessage.success('员工资料已更新')
    }
    dialogVisible.value = false
    await loadData()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

function openReset(source: unknown) {
  const row = source as StaffRow
  resetTarget.value = row
  resetPassword.value = generatePassword()
  resetVisible.value = true
  resetFormRef.value?.clearValidate()
}

async function submitReset() {
  if (!resetTarget.value) return
  const valid = await resetFormRef.value?.validate().catch(() => false)
  if (!valid) return

  resetSubmitting.value = true
  try {
    await resetStaffPassword(resetTarget.value.id, resetPassword.value)
    ElMessage.success(`已重置 ${resetTarget.value.name} 的密码`)
    resetVisible.value = false
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '密码重置失败')
  } finally {
    resetSubmitting.value = false
  }
}

function roleText(role: StaffRole): string {
  return role === 'admin' ? '管理员' : '运营'
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never" class="staff-card">
    <template #header>
      <div class="card-head">
        <div>
          <div class="card-title">员工账号</div>
          <div class="card-sub">内部邀请制，账号由管理员统一创建与停用</div>
        </div>
        <div class="head-actions">
          <el-button :icon="Refresh" @click="loadData">刷新</el-button>
          <el-button type="primary" :icon="Plus" @click="openCreate">新增员工账号</el-button>
        </div>
      </div>
    </template>

    <div class="toolbar">
      <el-input
        v-model="search"
        clearable
        placeholder="搜索姓名或登录 ID"
        class="search-input"
      />
      <span class="count">共 {{ rows.length }} 个账号</span>
    </div>

    <el-table v-loading="loading" :data="filteredRows" stripe row-key="id">
      <el-table-column prop="login_id" label="登录 ID" min-width="140">
        <template #default="{ row }">
          <div class="login-cell">
            <span>{{ row.login_id }}</span>
            <el-tag v-if="row.id === userStore.user?.id" size="small" type="info">当前账号</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="name" label="姓名" min-width="120" />
      <el-table-column label="角色" width="100">
        <template #default="{ row }">
          <el-tag :type="row.role === 'admin' ? 'warning' : 'info'" effect="plain">
            {{ roleText(row.role) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'danger'" effect="plain">
            {{ row.status === 'active' ? '启用' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ formatDateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="warning" :icon="Key" @click="openReset(row)">重置密码</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无员工账号" :image-size="72" />
      </template>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top">
        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="姓名" prop="name">
              <el-input v-model="form.name" maxlength="50" placeholder="例如：张三" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="登录 ID" prop="loginId">
              <el-input v-model="form.loginId" maxlength="32" placeholder="登录时使用" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-form-item v-if="dialogMode === 'create'" label="初始密码" prop="password">
          <div class="password-row">
            <el-input v-model="form.password" show-password />
            <el-button @click="form.password = generatePassword()">重新生成</el-button>
          </div>
          <div class="field-tip">创建后请通过安全方式将登录 ID 和初始密码交给员工。</div>
        </el-form-item>

        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="角色">
              <el-select v-model="form.role" :disabled="isEditingSelf" class="full-width">
                <el-option label="运营" value="operator" />
                <el-option label="管理员" value="admin" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col v-if="dialogMode === 'edit'" :span="12">
            <el-form-item label="账号状态">
              <el-select v-model="form.status" :disabled="isEditingSelf" class="full-width">
                <el-option label="启用" value="active" />
                <el-option label="停用" value="disabled" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          v-if="isEditingSelf"
          title="为避免把自己锁在系统外，当前账号不能在这里调整角色或停用。"
          type="info"
          :closable="false"
          show-icon
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          {{ dialogMode === 'create' ? '创建账号' : '保存修改' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetVisible" title="重置密码" width="480px" destroy-on-close>
      <div class="reset-tip">
        正在为 <strong>{{ resetTarget?.name }}</strong>（{{ resetTarget?.login_id }}）设置新密码。
      </div>
      <el-form ref="resetFormRef" :model="{ password: resetPassword }" :rules="resetRules" label-position="top">
        <el-form-item label="新密码" prop="password">
          <div class="password-row">
            <el-input v-model="resetPassword" show-password />
            <el-button @click="resetPassword = generatePassword()">重新生成</el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetVisible = false">取消</el-button>
        <el-button type="primary" :loading="resetSubmitting" @click="submitReset">确认重置</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style lang="scss" scoped>
.staff-card {
  min-height: calc(100vh - 74px);
}

.card-head,
.head-actions,
.login-cell,
.password-row {
  display: flex;
  align-items: center;
}

.card-head {
  justify-content: space-between;
  gap: 16px;
}

.head-actions,
.login-cell {
  gap: 8px;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.card-sub {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.search-input {
  width: 280px;
}

.count {
  font-size: 12px;
  color: #909399;
}

.password-row {
  width: 100%;
  gap: 8px;
}

.field-tip,
.reset-tip {
  color: #909399;
  font-size: 12px;
  line-height: 1.6;
}

.field-tip {
  margin-top: 5px;
}

.reset-tip {
  margin-bottom: 14px;
}

.full-width {
  width: 100%;
}

@media (max-width: 720px) {
  .card-head,
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .search-input {
    width: 100%;
  }
}
</style>
