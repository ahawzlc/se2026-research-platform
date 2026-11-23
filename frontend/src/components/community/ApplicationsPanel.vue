<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { communityApi } from '@/api'
import type { ApplicationItem, ApplicationStatus, CommunityPostItem } from '@/api/community'

/**
 * 申请管理面板（卡 E-2，线②）：发帖人在帖子详情的「申请管理」页签里处理申请。
 * 通过 / 拒绝都不可逆，操作前二次确认；首次通过时后端会自动建组并返回一次性的邀请码。
 */
const props = defineProps<{ post: CommunityPostItem }>()
/** 帖子的进度 / 状态 / 待处理数可能变化，请父级重新拉取详情 */
const emit = defineEmits<{ changed: [] }>()

/** 申请状态中文名与标签配色（枚举与后端 APPLICATION_STATUSES 对齐，不得自造） */
const STATUS_META: Record<
  ApplicationStatus,
  { label: string; tag: 'warning' | 'success' | 'info' }
> = {
  pending: { label: '待处理', tag: 'warning' },
  approved: { label: '已通过', tag: 'success' },
  rejected: { label: '已拒绝', tag: 'info' }
}
const TABS: ApplicationStatus[] = ['pending', 'approved', 'rejected']

const status = ref<ApplicationStatus>('pending')
const list = ref<ApplicationItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(10)
const loading = ref(false)
/** 正在处理中的申请 id：防止同一行被重复点击 */
const busyId = ref('')

async function load(): Promise<void> {
  loading.value = true
  try {
    const result = await communityApi.fetchPostApplications(props.post.id, {
      status: status.value,
      page: page.value,
      size: size.value
    })
    list.value = result.list
    total.value = result.total
  } catch {
    // 提示由拦截器统一处理
  } finally {
    loading.value = false
  }
}

// 切换状态页签回到第一页；从通知跳到另一篇帖子的详情时（同一组件实例）重新加载
watch([status, () => props.post.id], () => {
  page.value = 1
  void load()
})

function handlePageChange(next: number): void {
  page.value = next
  void load()
}

// ---------------------------------------------------------------- 通过 / 拒绝

/** 首次通过时后端自动建组：邀请码只随这次响应给出，弹窗一次性展示 */
const createdTeamVisible = ref(false)
const inviteCode = ref('')
const teamName = ref('')

async function handleApprove(row: ApplicationItem): Promise<void> {
  const applicant = row.applicant.nickname
  const confirmed = await ElMessageBox.confirm(
    props.post.team
      ? `通过后「${applicant}」将加入课题组「${props.post.team.name}」。确定通过？`
      : `这是第一个被通过的申请：系统会自动创建课题组「${props.post.title}」（你为组长），并让「${applicant}」加入。确定通过？`,
    '通过申请',
    { type: 'warning', confirmButtonText: '通过', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  busyId.value = row.id
  try {
    const result = await communityApi.approveApplication(row.id)
    if (result.inviteCode) {
      inviteCode.value = result.inviteCode
      teamName.value = result.post.team?.name ?? props.post.title
      createdTeamVisible.value = true
    }
    ElMessage.success(`已通过「${applicant}」的申请`)
    emit('changed')
    await load()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    busyId.value = ''
  }
}

async function handleReject(row: ApplicationItem): Promise<void> {
  const applicant = row.applicant.nickname
  const confirmed = await ElMessageBox.confirm(
    `拒绝后「${applicant}」不能再次申请本帖，且无法撤销。确定拒绝？`,
    '拒绝申请',
    { type: 'warning', confirmButtonText: '拒绝', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  busyId.value = row.id
  try {
    await communityApi.rejectApplication(row.id)
    ElMessage.success(`已拒绝「${applicant}」的申请`)
    emit('changed')
    await load()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    busyId.value = ''
  }
}

async function copyInviteCode(): Promise<void> {
  await navigator.clipboard.writeText(inviteCode.value)
  ElMessage.success('邀请码已复制')
}

onMounted(() => {
  void load()
})
</script>

<template>
  <el-card shadow="never" class="applications-card">
    <template #header>
      <div class="panel-head">
        <el-radio-group v-model="status" size="small">
          <el-radio-button v-for="key in TABS" :key="key" :value="key">
            {{ STATUS_META[key].label }}
            <span v-if="key === 'pending' && post.pendingCount > 0" class="tab-count">
              {{ post.pendingCount }}
            </span>
          </el-radio-button>
        </el-radio-group>
        <span class="capacity">名额 {{ post.recruitedCount }} / {{ post.recruitTotal }}</span>
      </div>
    </template>

    <el-empty
      v-if="list.length === 0 && !loading"
      :description="`暂无${STATUS_META[status].label}的申请`"
      :image-size="60"
    />
    <el-table v-else v-loading="loading" :data="list">
      <el-table-column label="申请人" min-width="170">
        <template #default="{ row }">
          <div class="applicant">
            <el-avatar :size="30" :src="row.applicant.avatar">
              {{ row.applicant.nickname.charAt(0) }}
            </el-avatar>
            <span class="applicant-name">{{ row.applicant.nickname }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="申请说明" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.note">{{ row.note }}</span>
          <span v-else class="muted">（未填写）</span>
        </template>
      </el-table-column>
      <el-table-column label="申请时间" prop="createdAt" width="170" />
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'pending'">
            <el-button
              link
              type="primary"
              :loading="busyId === row.id"
              :disabled="post.status === 'full'"
              :title="post.status === 'full' ? '帖子已满员，可改为拒绝' : ''"
              @click="handleApprove(row)"
            >
              通过
            </el-button>
            <el-button link type="danger" :disabled="busyId !== ''" @click="handleReject(row)">
              拒绝
            </el-button>
          </template>
          <span v-else-if="row.handledAt" class="muted">
            {{ row.handledAt }} {{ STATUS_META[row.status as ApplicationStatus].label }}
          </span>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager">
      <el-pagination
        layout="total, prev, pager, next"
        :total="total"
        :page-size="size"
        :current-page="page"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 首次通过：课题组已自动创建，邀请码仅此一次展示（与「课题组成员」页建组后的展示同口径） -->
    <el-dialog
      :model-value="createdTeamVisible"
      title="课题组已自动创建"
      width="460px"
      @close="createdTeamVisible = false"
    >
      <p class="invite-tip">
        课题组「
        <b>{{ teamName }}</b>
        」已创建，你是组长。邀请码如下，
        <b>仅此一次展示</b>
        ， 需要线下拉人时请复制保存：
      </p>
      <div class="invite-code" @click="copyInviteCode">{{ inviteCode }}</div>
      <p class="invite-hint">点击邀请码即可复制</p>
      <template #footer>
        <el-button type="primary" @click="createdTeamVisible = false">我已保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tab-count {
  margin-left: 4px;
}

.capacity {
  font-size: 13px;
  color: #909399;
}

.applicant {
  display: flex;
  align-items: center;
  gap: 8px;
}

.applicant-name {
  font-weight: 500;
  color: #303133;
}

.muted {
  font-size: 12px;
  color: #909399;
}

.pager {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
}

.invite-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.8;
}

.invite-code {
  padding: 14px;
  text-align: center;
  font-size: 24px;
  letter-spacing: 6px;
  font-weight: 600;
  color: #303133;
  background: #f5f7fa;
  border-radius: 6px;
  cursor: pointer;
  user-select: all;
}

.invite-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
  text-align: center;
}
</style>
