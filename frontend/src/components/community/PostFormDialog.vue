<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { communityApi } from '@/api'
import type { CommunityPostItem, CommunityTag, TagCategory } from '@/api/community'

/**
 * 发布 / 编辑招募帖弹窗（卡 E-1）。广场页与帖子详情页共用：
 * 不传 post 为发布，传入 post 为编辑。校验口径与后端 DTO 一致（docs/01「组队广场」）。
 */
const props = defineProps<{
  modelValue: boolean
  post?: CommunityPostItem | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [post: CommunityPostItem]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})
const isEdit = computed(() => !!props.post)

/** 标签类别中文名，用于下拉分组（与广场筛选条同一口径） */
const CATEGORY_LABELS: Record<TagCategory, string> = {
  competition: '竞赛',
  course: '课程'
}

const TITLE_MAX = 50
const CONTENT_MAX = 5000
const TAG_MIN = 1
const TAG_MAX = 3
const RECRUIT_MIN = 1
const RECRUIT_MAX = 10

const tags = ref<CommunityTag[]>([])
const groupedTags = computed(() =>
  (Object.keys(CATEGORY_LABELS) as TagCategory[]).map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    tags: tags.value.filter((tag) => tag.category === category)
  }))
)

const formRef = ref<FormInstance>()
const submitting = ref(false)
const form = reactive({
  title: '',
  content: '',
  tagIds: [] as string[],
  recruitTotal: 1
})

const rules: FormRules = {
  title: [
    { required: true, message: '请输入招募标题', trigger: 'blur' },
    { max: TITLE_MAX, message: `标题最长 ${TITLE_MAX} 个字符`, trigger: 'blur' }
  ],
  tagIds: [
    {
      type: 'array',
      required: true,
      min: TAG_MIN,
      max: TAG_MAX,
      message: `请选择 ${TAG_MIN}-${TAG_MAX} 个标签`,
      trigger: 'change'
    }
  ],
  recruitTotal: [{ required: true, message: '请填写招募人数', trigger: 'change' }]
}

/** 每次打开都从当前帖子（或空表单）重新填充，避免残留上一次的输入 */
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    form.title = props.post?.title ?? ''
    form.content = props.post?.content ?? ''
    form.tagIds = props.post?.tags.map((tag) => tag.id) ?? []
    form.recruitTotal = props.post?.recruitTotal ?? 1
    if (tags.value.length === 0) void loadTags()
  }
)

async function loadTags(): Promise<void> {
  try {
    tags.value = await communityApi.fetchCommunityTags()
  } catch {
    // 提示由拦截器统一处理
  }
}

async function handleSubmit(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = {
      title: form.title.trim(),
      content: form.content.trim(),
      tagIds: form.tagIds,
      recruitTotal: form.recruitTotal
    }
    const saved = props.post
      ? await communityApi.updateCommunityPost(props.post.id, payload)
      : await communityApi.createCommunityPost(payload)
    visible.value = false
    emit('saved', saved)
  } catch {
    // 提示由拦截器统一处理
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="isEdit ? '编辑招募帖' : '发布招募'"
    width="600px"
    :close-on-click-modal="false"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
      <el-form-item label="标题" prop="title">
        <el-input
          v-model="form.title"
          :maxlength="TITLE_MAX"
          show-word-limit
          placeholder="一句话说明招什么项目，如：互联网+项目招前端"
        />
      </el-form-item>
      <el-form-item label="项目说明" prop="content">
        <el-input
          v-model="form.content"
          type="textarea"
          :rows="6"
          :maxlength="CONTENT_MAX"
          show-word-limit
          placeholder="项目背景、目标、分工与时间安排；支持换行"
        />
      </el-form-item>
      <el-form-item label="标签" prop="tagIds">
        <el-select
          v-model="form.tagIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :multiple-limit="TAG_MAX"
          class="full-width"
          :placeholder="`从字典中选择 ${TAG_MIN}-${TAG_MAX} 个`"
        >
          <el-option-group v-for="group in groupedTags" :key="group.category" :label="group.label">
            <el-option v-for="tag in group.tags" :key="tag.id" :label="tag.name" :value="tag.id" />
          </el-option-group>
        </el-select>
      </el-form-item>
      <el-form-item label="招募人数" prop="recruitTotal">
        <el-input-number v-model="form.recruitTotal" :min="RECRUIT_MIN" :max="RECRUIT_MAX" />
        <span class="field-hint">审批通过一人记一个名额，招满后自动转为「已满员」</span>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="handleSubmit">
        {{ isEdit ? '保存' : '发布' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.full-width {
  width: 100%;
}

.field-hint {
  margin-left: 12px;
  font-size: 12px;
  color: #909399;
}
</style>
