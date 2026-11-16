<script setup lang="ts">
import type { ParticipationDimension } from '@/api/stats'

defineProps<{ dimensions: ParticipationDimension[]; version: string; threshold: number }>()
const open = defineModel<boolean>({ required: true })
</script>

<template>
  <el-drawer v-model="open" title="参与度如何计算" size="min(520px, 100vw)">
    <div class="method">
      <el-tag type="info" effect="plain">{{ version }}</el-tag>
      <ol>
        <li>
          <strong>筛选有效行为</strong>
          <span>
            按行为人与关联对象去重，撤销和超限记录不计入。评论每日最多 10 条，文献登记和阅读各最多 5
            条。
          </span>
        </li>
        <li>
          <strong>比较六个维度</strong>
          <span>
            将成员的维度计入值除以本组该维度最大值，转换为 0–100。组内没有该类行为时，该维度显示为
            0。
          </span>
        </li>
        <li>
          <strong>合成参与指数</strong>
          <span>按下表权重汇总六维结果。团队或组内最大值变化时，指数也会变化。</span>
        </li>
      </ol>
      <el-table :data="dimensions" size="small">
        <el-table-column prop="label" label="维度" />
        <el-table-column prop="weight" label="维度权重" width="105" />
      </el-table>
      <p>有效行为少于 {{ threshold }} 条时会显示样本提示。画像仅供协作过程参考。</p>
    </div>
  </el-drawer>
</template>

<style scoped>
.method {
  display: grid;
  gap: 16px;
}
.method > .el-tag {
  justify-self: start;
}
ol {
  display: grid;
  gap: 14px;
  margin: 0;
  padding-left: 20px;
}
li span {
  display: block;
  margin-top: 4px;
}
li span,
p {
  color: var(--el-text-color-secondary);
  line-height: 1.65;
}
p {
  margin: 0;
}
</style>
