<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { authApi } from '@/api'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const mode = ref<'login' | 'register'>('login')
const loading = ref(false)
const formRef = ref<FormInstance>()

const form = reactive({
  username: '',
  password: '',
  nickname: '',
  email: ''
})

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }]
}

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  formRef.value?.clearValidate()
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    const result =
      mode.value === 'login'
        ? await authApi.login({ username: form.username, password: form.password })
        : await authApi.register({
            username: form.username,
            password: form.password,
            nickname: form.nickname,
            email: form.email
          })
    userStore.setToken(result.token)
    userStore.setUserInfo(result.user)
    ElMessage.success(mode.value === 'login' ? '登录成功' : '注册成功')
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch {
    // 错误提示由 Axios 响应拦截器统一处理，此处无需重复提示
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-panel">
      <h1 class="login-title">校园科研项目协作与成果管理平台</h1>
      <p class="login-subtitle">
        {{ mode === 'login' ? '登录以继续' : '创建账号并加入课题组' }}
      </p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" size="large">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" clearable />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <template v-if="mode === 'register'">
          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="form.nickname" placeholder="用于在团队中显示" clearable />
          </el-form-item>
          <el-form-item label="邮箱（可选）" prop="email">
            <el-input v-model="form.email" placeholder="example@mail.com" clearable />
          </el-form-item>
        </template>

        <el-button type="primary" class="login-submit" :loading="loading" @click="handleSubmit">
          {{ mode === 'login' ? '登录' : '注册' }}
        </el-button>
      </el-form>

      <div class="login-switch">
        <span v-if="mode === 'login'">还没有账号？</span>
        <span v-else>已有账号？</span>
        <el-link
          type="primary"
          :underline="false"
          @click="switchMode(mode === 'login' ? 'register' : 'login')"
        >
          {{ mode === 'login' ? '注册' : '登录' }}
        </el-link>
      </div>

      <el-alert
        class="login-tip"
        type="info"
        :closable="false"
        show-icon
        title="后端尚未就绪"
        description="后端技术选型待定，接口暂不可用。当前页面用于确定前端登录流程与统一返回体对接方式。"
      />
    </div>
  </div>
</template>

<style scoped>
.login-page {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f7fa;
}

.login-panel {
  width: 400px;
  padding: 32px;
  background: #ffffff;
  border: 1px solid var(--app-border);
  border-radius: 12px;
}

.login-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 500;
  color: #303133;
  line-height: 1.5;
}

.login-subtitle {
  margin: 0 0 24px;
  font-size: 13px;
  color: #909399;
}

.login-submit {
  width: 100%;
}

.login-switch {
  margin-top: 16px;
  font-size: 13px;
  color: #909399;
  text-align: center;
}

.login-tip {
  margin-top: 20px;
}
</style>
