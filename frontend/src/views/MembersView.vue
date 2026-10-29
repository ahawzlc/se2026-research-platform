<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { teamsApi } from '@/api'
import type { AssignableRole, CreatedTeam, MyTeamItem, TeamMemberItem } from '@/api/teams'

/** 我的课题组列表与当前选中组 */
const teams = ref<MyTeamItem[]>([])
const currentTeamId = ref('')
const currentTeam = computed(() =>
  teams.value.find((team) => team.id === currentTeamId.value)
)
/** 是否组长：控制角色修改入口的显隐 */
const isOwner = computed(() => currentTeam.value?.role === 'owner')

/** 成员表格状态（组规模小，固定每页 50，翻页仍走分页接口） */
const members = ref<TeamMemberItem[]>([])
const total = ref(0)
const page = ref(1)
const size = ref(50)
const loading = ref(false)

async function loadTeams(): Promise<void> {
  teams.value = await teamsApi.fetchMyTeams()
  if (!teams.value.some((team) => team.id === currentTeamId.value)) {
    currentTeamId.value = teams.value[0]?.id ?? ''
    page.value = 1
  }
  if (currentTeamId.value) {
    await loadMembers()
  } else {
    members.value = []
    total.value = 0
  }
}

async function loadMembers(): Promise<void> {
  if (!currentTeamId.value) return
  loading.value = true
  try {
    const result = await teamsApi.fetchTeamMembers(currentTeamId.value, {
      page: page.value,
      size: size.value
    })
    members.value = result.list
    total.value = result.total
  } finally {
    loading.value = false
  }
}

function handleTeamChange(): void {
  page.value = 1
  void loadMembers()
}

function handlePageChange(next: number): void {
  page.value = next
  void loadMembers()
}

/** 角色中文名（表格展示用；owner 不可修改） */
const ROLE_LABELS: Record<string, string> = {
  owner: '组长',
  admin: '管理员',
  member: '成员'
}

async function handleRoleChange(row: TeamMemberItem, role: AssignableRole): Promise<void> {
  if (!currentTeamId.value) return
  try {
    await teamsApi.updateMemberRole(currentTeamId.value, row.userId, role)
    row.role = role
    ElMessage.success(`已将「${row.nickname || row.username}」设为${ROLE_LABELS[role]}`)
  } catch {
    // 失败提示由拦截器统一处理；回拉列表还原下拉状态
    await loadMembers()
  }
}

// ---------------------------------------------------------------- 建组

const createVisible = ref(false)
const createLoading = ref(false)
const createFormRef = ref<FormInstance>()
const createForm = reactive({ name: '', description: '' })
const createRules: FormRules = {
  name: [
    { required: true, message: '请输入课题组名称', trigger: 'blur' },
    { max: 100, message: '名称最长 100 个字符', trigger: 'blur' }
  ]
}

/** 建组成功后展示邀请码的结果弹窗（邀请码不回查，此处是唯一展示处） */
const createdTeam = ref<CreatedTeam | null>(null)

async function handleCreate(): Promise<void> {
  if (!createFormRef.value) return
  const valid = await createFormRef.value.validate().catch(() => false)
  if (!valid) return
  createLoading.value = true
  try {
    createdTeam.value = await teamsApi.createTeam({
      name: createForm.name,
      description: createForm.description || undefined
    })
    createVisible.value = false
    createForm.name = ''
    createForm.description = ''
    await loadTeams()
    currentTeamId.value = createdTeam.value.id
    await loadMembers()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    createLoading.value = false
  }
}

async function copyInviteCode(): Promise<void> {
  if (!createdTeam.value) return
  await navigator.clipboard.writeText(createdTeam.value.inviteCode)
  ElMessage.success('邀请码已复制')
}

// ---------------------------------------------------------------- 入组

const joinVisible = ref(false)
const joinLoading = ref(false)
const joinFormRef = ref<FormInstance>()
const joinForm = reactive({ inviteCode: '' })
const joinRules: FormRules = {
  inviteCode: [
    { required: true, message: '请输入邀请码', trigger: 'blur' },
    {
      pattern: /^[A-HJKMNP-Z2-9]{8}$/,
      message: '邀请码为 8 位，不含易混淆的 I/L/O/0/1',
      trigger: 'blur'
    }
  ]
}

async function handleJoin(): Promise<void> {
  if (!joinFormRef.value) return
  const valid = await joinFormRef.value.validate().catch(() => false)
  if (!valid) return
  joinLoading.value = true
  try {
    const team = await teamsApi.joinTeam(joinForm.inviteCode.trim().toUpperCase())
    joinVisible.value = false
    joinForm.inviteCode = ''
    ElMessage.success(`已加入「${team.name}」`)
    await loadTeams()
    currentTeamId.value = team.id
    await loadMembers()
  } catch {
    // 提示由拦截器统一处理
  } finally {
    joinLoading.value = false
  }
}

onMounted(() => {
  void loadTeams()
})
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="toolbar">
        <el-select
          v-model="currentTeamId"
          placeholder="选择课题组"
          class="team-select"
          :disabled="teams.length === 0"
          @change="handleTeamChange"
        >
          <el-option
            v-for="team in teams"
            :key="team.id"
            :label="`${team.name}（${ROLE_LABELS[team.role] ?? team.role}）`"
            :value="team.id"
          />
        </el-select>
        <span v-if="currentTeam" class="team-meta">入组时间：{{ currentTeam.joinedAt }}</span>
        <div class="toolbar-actions">
          <el-button @click="joinVisible = true">凭邀请码入组</el-button>
          <el-button type="primary" @click="createVisible = true">创建课题组</el-button>
        </div>
      </div>
    </template>

    <el-empty v-if="teams.length === 0" description="还没有课题组">
      <p class="empty-hint">创建一个课题组，或向组长索要邀请码加入已有课题组</p>
    </el-empty>

    <template v-else>
      <el-table v-loading="loading" :data="members">
        <el-table-column label="成员">
          <template #default="{ row }">
            <span class="member-name">{{ row.nickname || row.username }}</span>
            <span class="member-username">@{{ row.username }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="email" label="邮箱" min-width="180" />
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.role === 'owner'" type="warning" size="small">组长</el-tag>
            <el-select
              v-else-if="isOwner"
              :model-value="row.role"
              size="small"
              @change="(role: AssignableRole) => handleRoleChange(row, role)"
            >
              <el-option label="管理员" value="admin" />
              <el-option label="成员" value="member" />
            </el-select>
            <el-tag v-else size="small">{{ ROLE_LABELS[row.role] ?? row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="joinedAt" label="加入时间" width="180" />
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
    </template>

    <!-- 建组 -->
    <el-dialog v-model="createVisible" title="创建课题组" width="460px">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-width="90px">
        <el-form-item label="名称" prop="name">
          <el-input v-model="createForm.name" maxlength="100" placeholder="如：智能感知课题组" />
        </el-form-item>
        <el-form-item label="简介" prop="description">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            placeholder="选填"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="createLoading" @click="handleCreate">创建</el-button>
      </template>
    </el-dialog>

    <!-- 建组成功：邀请码唯一展示处 -->
    <el-dialog :model-value="createdTeam !== null" title="课题组已创建" width="460px" @close="createdTeam = null">
      <template v-if="createdTeam">
        <p class="invite-tip">邀请码如下，<b>仅此一次展示</b>，请复制保存后发给组员：</p>
        <div class="invite-code" @click="copyInviteCode">{{ createdTeam.inviteCode }}</div>
        <p class="invite-hint">点击邀请码即可复制</p>
      </template>
      <template #footer>
        <el-button type="primary" @click="createdTeam = null">我已保存</el-button>
      </template>
    </el-dialog>

    <!-- 入组 -->
    <el-dialog v-model="joinVisible" title="凭邀请码入组" width="460px">
      <el-form ref="joinFormRef" :model="joinForm" :rules="joinRules" label-width="90px" @submit.prevent>
        <el-form-item label="邀请码" prop="inviteCode">
          <el-input
            v-model="joinForm.inviteCode"
            maxlength="8"
            placeholder="8 位，如 A3BK7QXR"
            style="text-transform: uppercase"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="joinVisible = false">取消</el-button>
        <el-button type="primary" :loading="joinLoading" @click="handleJoin">加入</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.team-select {
  width: 280px;
}

.team-meta {
  font-size: 13px;
  color: #909399;
}

.toolbar-actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}

.empty-hint {
  margin: 4px 0 0;
  font-size: 13px;
  color: #909399;
}

.member-name {
  font-weight: 500;
  color: #303133;
}

.member-username {
  margin-left: 6px;
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
