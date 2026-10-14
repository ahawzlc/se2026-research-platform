<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()

const title = computed(() => route.meta.title ?? '未命名模块')
const owner = computed(() => route.meta.owner ?? '待定')
</script>

<template>
  <el-card shadow="never">
    <el-empty :description="`「${title}」尚未实现`">
      <template #description>
        <p class="ph-title">「{{ title }}」尚未实现</p>
        <p class="ph-owner">负责人：{{ owner }}</p>
      </template>
      <p class="ph-hint">
        该页面为路由占位，用于确定导航结构与页面归属。后端接口就绪后由对应负责人替换为真实视图。
      </p>
      <p class="ph-hint">
        开发前请先阅读仓库 <code>docs/01-接口规范.md</code> 与
        <code>docs/02-数据字典.md</code>。
      </p>
    </el-empty>
  </el-card>
</template>

<style scoped>
.ph-title {
  margin: 0 0 6px;
  font-size: 15px;
  color: #303133;
}

.ph-owner {
  margin: 0;
  font-size: 13px;
  color: #909399;
}

.ph-hint {
  margin: 6px 0 0;
  font-size: 13px;
  color: #909399;
  line-height: 1.8;
}

code {
  padding: 1px 5px;
  background: #f5f7fa;
  border-radius: 4px;
  font-size: 12px;
  color: #606266;
}
</style>
