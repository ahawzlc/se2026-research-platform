<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { authApi } from '@/api'
import { useUserStore } from '@/store/user'

/**
 * 账号与安全（线③ 卡 E-3 的个人主页配套页）。
 *
 * 卡 A-补2 的改密接口与前端校验规则原样复用（同一套后端口径），
 * 改密成功后后端会签发新令牌，这里就地替换本地登录态。
 */
const router = useRouter()
const userStore = useUserStore()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

/** 与后端 UpdatePasswordDto 同一条正则：8-32 位且同时包含字母和数字 */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/

const rules: FormRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      pattern: PASSWORD_PATTERN,
      message: '密码需为 8-32 位且同时包含字母和数字',
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule: unknown, value: string, callback: (error?: Error) => void) => {
        if (value !== form.newPassword) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const result = await authApi.changePassword({
      oldPassword: form.oldPassword,
      newPassword: form.newPassword
    })
    // 后端改密后签发新令牌，就地替换本地登录态（旧令牌自然过期）
    userStore.setToken(result.token)
    userStore.setUserInfo(result.user)
    ElMessage.success('密码已修改，登录态已刷新')
    await router.push('/profile')
  } catch {
    // 提示由拦截器统一处理（旧密码错误 → 401 由拦截器弹出）
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <el-page-header content="账号与安全" @back="router.back()" />

    <el-card class="settings-card" shadow="never">
      <template #header>修改密码</template>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" @submit.prevent>
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="form.newPassword"
            type="password"
            show-password
            placeholder="8-32 位，须同时包含字母和数字"
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="handleSubmit">修改密码</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <el-card class="settings-card" shadow="never">
      <template #header>账号信息</template>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="用户名">
          {{ userStore.userInfo?.username }}
        </el-descriptions-item>
        <el-descriptions-item label="UID">
          <code>{{ userStore.userInfo?.publicUid || '未分配' }}</code>
        </el-descriptions-item>
        <el-descriptions-item label="昵称">
          {{ userStore.userInfo?.nickname }}
        </el-descriptions-item>
        <el-descriptions-item label="邮箱">
          {{ userStore.userInfo?.email || '未填写' }}
        </el-descriptions-item>
      </el-descriptions>
      <div class="settings-tip">
        UID 与用户名创建后不可修改；昵称、头像、简介与可见范围可在
        <el-link type="primary" @click="router.push('/profile')">个人主页</el-link>
        修改。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 640px;
  margin: 0 auto;
}

.settings-card {
  margin-top: 16px;
}

.settings-tip {
  margin-top: 12px;
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
}
</style>
