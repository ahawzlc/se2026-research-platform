<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <p class="nf-code">404</p>
    <p class="nf-text">页面不存在或已被移除</p>
    <el-button type="primary" @click="router.replace('/dashboard')">返回工作台</el-button>
  </div>
</template>

<style scoped>
.not-found {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.nf-code {
  margin: 0;
  font-size: 48px;
  font-weight: 500;
  color: #c0c4cc;
}

.nf-text {
  margin: 0;
  font-size: 14px;
  color: #909399;
}
</style>
