<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { authApi } from '@/api'
import { useUserStore } from '@/store/user'

/**
 * 个人设置弹窗（卡 A-补1 资料 / A-补2 改密），挂在 BasicLayout 顶栏下拉里。
 * 两个独立 tab、独立表单与提交，避免一次提交互相干扰校验。
 */
const visible = defineModel<boolean>({ default: false })

const userStore = useUserStore()

// ---------------------------------------------------------------- 资料（A-补1）

const profileFormRef = ref<FormInstance>()
const profileLoading = ref(false)
const profileForm = reactive({ nickname: '', email: '' })

/** 昵称/邮箱至少填一个（与后端口径一致的前端预检） */
const validateAtLeastOne = (
  _rule: unknown,
  _value: string,
  callback: (error?: Error) => void
) => {
  if (!profileForm.nickname.trim() && !profileForm.email.trim()) {
    callback(new Error('昵称与邮箱至少填一个'))
  } else {
    callback()
  }
}

const profileRules: FormRules = {
  nickname: [
    { max: 50, message: '昵称最长 50 个字符', trigger: 'blur' },
    { validator: validateAtLeastOne, trigger: 'blur' }
  ],
  email: [
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
    { max: 100, message: '邮箱最长 100 个字符', trigger: 'blur' },
    { validator: validateAtLeastOne, trigger: 'blur' }
  ]
}

async function handleProfileSubmit(): Promise<void> {
  if (!profileFormRef.value) return
  const valid = await profileFormRef.value.validate().catch(() => false)
  if (!valid) return
  profileLoading.value = true
  try {
    const updated = await authApi.updateProfile({
      nickname: profileForm.nickname.trim() || undefined,
      email: profileForm.email.trim() || undefined
    })
    userStore.setUserInfo(updated)
    ElMessage.success('资料已更新')
    visible.value = false
  } catch {
    // 提示由拦截器统一处理
  } finally {
    profileLoading.value = false
  }
}

// ---------------------------------------------------------------- 改密（A-补2）

const passwordFormRef = ref<FormInstance>()
const passwordLoading = ref(false)
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })

/** 与后端 UpdatePasswordDto 同一条正则：8-32 位且同时包含字母和数字 */
const PASSWORD_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).{8,32}$/

const passwordRules: FormRules = {
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
        if (value !== passwordForm.newPassword) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur'
    }
  ]
}

async function handlePasswordSubmit(): Promise<void> {
  if (!passwordFormRef.value) return
  const valid = await passwordFormRef.value.validate().catch(() => false)
  if (!valid) return
  passwordLoading.value = true
  try {
    const result = await authApi.changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword
    })
    // 成功后端签发新令牌，就地替换本地登录态（旧令牌自然过期，docs/08 卡 A-补2 的取舍）
    userStore.setToken(result.token)
    userStore.setUserInfo(result.user)
    ElMessage.success('密码已修改，登录态已刷新')
    visible.value = false
  } catch {
    // 提示由拦截器统一处理（旧密码错误 → 401 由拦截器弹出）
  } finally {
    passwordLoading.value = false
  }
}

// ---------------------------------------------------------------- 打开时回填/重置

watch(visible, (open) => {
  if (open) {
    profileForm.nickname = userStore.userInfo?.nickname ?? ''
    profileForm.email = userStore.userInfo?.email ?? ''
    passwordForm.oldPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
  }
})
</script>

<template>
  <el-dialog v-model="visible" title="个人设置" width="460px">
    <el-tabs>
      <el-tab-pane label="个人资料">
        <el-form
          ref="profileFormRef"
          :model="profileForm"
          :rules="profileRules"
          label-width="70px"
          @submit.prevent
        >
          <el-form-item label="用户名">
            <span class="fixed-value">{{ userStore.userInfo?.username }}</span>
          </el-form-item>
          <el-form-item label="昵称" prop="nickname">
            <el-input v-model="profileForm.nickname" maxlength="50" placeholder="1-50 个字符" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="profileForm.email" maxlength="100" placeholder="选填" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="profileLoading" @click="handleProfileSubmit">
              保存资料
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="修改密码">
        <el-form
          ref="passwordFormRef"
          :model="passwordForm"
          :rules="passwordRules"
          label-width="90px"
          @submit.prevent
        >
          <el-form-item label="旧密码" prop="oldPassword">
            <el-input v-model="passwordForm.oldPassword" type="password" show-password />
          </el-form-item>
          <el-form-item label="新密码" prop="newPassword">
            <el-input
              v-model="passwordForm.newPassword"
              type="password"
              show-password
              placeholder="8-32 位，须同时包含字母和数字"
            />
          </el-form-item>
          <el-form-item label="确认新密码" prop="confirmPassword">
            <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="passwordLoading" @click="handlePasswordSubmit">
              修改密码
            </el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.fixed-value {
  color: #909399;
}
</style>
