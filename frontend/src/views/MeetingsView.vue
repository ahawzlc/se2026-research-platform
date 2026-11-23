<script setup lang="ts">
/* global Blob, BlobPart, File, HTMLAudioElement, MediaRecorder, MediaStream, RTCPeerConnection, RTCIceCandidateInit, RTCSessionDescriptionInit, crypto */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { authApi, conversationsApi, fileApi, meetingsApi, projectsApi, teamsApi } from '@/api'
import type { ConversationItem, MessageItem } from '@/api/conversations'
import type { MeetingItem } from '@/api/meetings'
import type { ProjectItem } from '@/api/projects'
import type { TeamMemberItem } from '@/api/teams'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
const myUserId = computed(() => userStore.userInfo?.id ?? '')
const route = useRoute()

const projects = ref<ProjectItem[]>([])
const currentProjectId = ref('')
const meetings = ref<MeetingItem[]>([])
const loading = ref(false)
const tab = ref<'upcoming' | 'ended' | 'all'>('upcoming')
const calendarMonth = ref(new Date())
const calendarDate = ref('')
const selectedCalendarMeetings = computed(() =>
  meetings.value.filter((item) => item.heldAt.slice(0, 10) === calendarDate.value)
)
const filteredMeetings = computed(() => {
  const result = tab.value === 'all' ? [...meetings.value] : meetings.value.filter((item) => item.status === tab.value)
  return result.sort((a, b) => a.heldAt.localeCompare(b.heldAt))
})

const teamMembers = ref<TeamMemberItem[]>([])
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const dialogLoading = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref('')
const form = reactive({ title: '', heldAt: '', location: '', content: '', attendeeIds: [] as string[] })
const rules: FormRules = {
  title: [
    { required: true, message: '请输入会议主题', trigger: 'blur' },
    { max: 200, message: '主题最长 200 个字符', trigger: 'blur' }
  ]
}

async function loadProjects() {
  const result = await projectsApi.fetchProjects({ page: 1, size: 100 })
  projects.value = result.list
  if (!projects.value.some((item) => item.id === currentProjectId.value)) currentProjectId.value = projects.value[0]?.id ?? ''
  if (currentProjectId.value) await Promise.all([loadMeetings(), loadMembers()])
}
async function loadMeetings() {
  if (!currentProjectId.value) return
  loading.value = true
  try {
    const result = await meetingsApi.fetchMeetings({ projectId: currentProjectId.value, page: 1, size: 100 })
    meetings.value = result.list
    if (!calendarDate.value) calendarDate.value = new Date().toISOString().slice(0, 10)
  } finally {
    loading.value = false
  }
}
async function loadMembers() {
  const project = await projectsApi.fetchProject(currentProjectId.value)
  const result = await teamsApi.fetchTeamMembers(project.teamId, { page: 1, size: 100 })
  teamMembers.value = result.list
}
function handleProjectChange() { void Promise.all([loadMeetings(), loadMembers()]) }
function statusLabel(status: MeetingItem['status']) {
  return status === 'upcoming' ? '即将开始' : status === 'ended' ? '已结束' : '未安排时间'
}
function attendeeNames(meeting: MeetingItem): string {
  return meeting.attendees.map((item) => item.nickname || item.username).join('、') || '未指定'
}
function statusTag(status: MeetingItem['status']): 'success' | 'warning' | 'info' {
  return status === 'upcoming' ? 'warning' : status === 'ended' ? 'info' : 'success'
}
function openCreate() {
  dialogMode.value = 'create'; editingId.value = ''
  Object.assign(form, { title: '', heldAt: '', location: '', content: '', attendeeIds: [] })
  dialogVisible.value = true
}
function openEdit(row: MeetingItem) {
  dialogMode.value = 'edit'; editingId.value = row.id
  Object.assign(form, { title: row.title, heldAt: row.heldAt, location: row.location, content: row.content, attendeeIds: row.attendees.map((item) => item.userId) })
  dialogVisible.value = true
}
async function handleSubmit() {
  if (!formRef.value || !(await formRef.value.validate().catch(() => false))) return
  dialogLoading.value = true
  try {
    const payload = { title: form.title.trim(), heldAt: form.heldAt || undefined, location: form.location.trim() || undefined, content: form.content || undefined, attendeeIds: form.attendeeIds }
    if (dialogMode.value === 'create') await meetingsApi.createMeeting({ ...payload, projectId: currentProjectId.value })
    else await meetingsApi.updateMeeting(editingId.value, payload)
    ElMessage.success(dialogMode.value === 'create' ? '会议已创建，参会人会在会前一小时收到提醒' : '会议已更新')
    dialogVisible.value = false
    await loadMeetings()
  } finally { dialogLoading.value = false }
}
async function removeMeeting(row: MeetingItem) {
  const ok = await ElMessageBox.confirm(`确定删除会议“${row.title}”吗？`, '删除会议', { type: 'warning' }).catch(() => false)
  if (!ok) return
  await meetingsApi.deleteMeeting(row.id)
  ElMessage.success('会议已删除')
  await loadMeetings()
}

const detailVisible = ref(false)
const detail = ref<MeetingItem | null>(null)
const detailLoading = ref(false)
const conversation = ref<ConversationItem | null>(null)
const messages = ref<MessageItem[]>([])
const draft = ref('')
const sending = ref(false)
const recording = ref(false)
const recorder = ref<MediaRecorder | null>(null)
const recordChunks: BlobPart[] = []
const chatPollTimer = ref<ReturnType<typeof setInterval> | null>(null)
const scrollRef = ref<HTMLElement>()
const remoteAudio = ref<HTMLAudioElement>()
const callActive = ref(false)
const callConnecting = ref(false)
let localStream: MediaStream | null = null
let peer: RTCPeerConnection | null = null
const handledSignals = new Set<string>()
const callId = ref('')

function mediaUrl(value: string) { return value.startsWith('http') ? value : `${window.location.origin}${value}` }
async function openDetail(row: MeetingItem) {
  detailVisible.value = true; detailLoading.value = true
  if (chatPollTimer.value) clearInterval(chatPollTimer.value)
  try {
    detail.value = await meetingsApi.fetchMeeting(row.id)
    conversation.value = await conversationsApi.ensureMeetingConversation(row.id)
    messages.value = await conversationsApi.fetchMessages(conversation.value.id, 200)
    await conversationsApi.markRead(conversation.value.id)
    await nextTick(); scrollToBottom()
    chatPollTimer.value = setInterval(() => { void refreshChat() }, 3000)
  } finally { detailLoading.value = false }
}
async function refreshChat() {
  if (!conversation.value) return
  const next = await conversationsApi.fetchMessages(conversation.value.id, 200)
  messages.value = next
  await conversationsApi.markRead(conversation.value.id)
  await processSignals(next)
  await nextTick(); scrollToBottom()
}
function closeDetail() {
  if (chatPollTimer.value) clearInterval(chatPollTimer.value)
  chatPollTimer.value = null
  stopCall()
  conversation.value = null; detail.value = null; messages.value = []
}
async function sendText() {
  const content = draft.value.trim()
  if (!content || !conversation.value || detail.value?.status === 'ended' || sending.value) return
  sending.value = true
  try { messages.value.push(await conversationsApi.sendMessage(conversation.value.id, content)); draft.value = ''; await nextTick(); scrollToBottom() }
  finally { sending.value = false }
}
async function startRecording() {
  if (!conversation.value || detail.value?.status === 'ended') return
  if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) { ElMessage.warning('当前浏览器不支持录音'); return }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const media = new MediaRecorder(stream)
  recordChunks.length = 0
  media.ondataavailable = (event) => { if (event.data.size) recordChunks.push(event.data) }
  media.onstop = () => { stream.getTracks().forEach((track) => track.stop()); void uploadRecording() }
  recorder.value = media; recording.value = true; media.start()
}
function stopRecording() { recorder.value?.stop(); recorder.value = null; recording.value = false }
async function uploadRecording() {
  if (!conversation.value) return
  const blob = new Blob(recordChunks, { type: 'audio/webm' })
  const file = new File([blob], `meeting-${Date.now()}.webm`, { type: 'audio/webm' })
  const uploaded = await fileApi.uploadFile(file)
  messages.value.push(await conversationsApi.sendMessage(conversation.value.id, uploaded.url, { msgType: 'audio', refId: uploaded.id }))
  await nextTick(); scrollToBottom()
}
function scrollToBottom() { if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight }

function sendSignal(payload: Record<string, unknown>) {
  if (!conversation.value) return Promise.resolve()
  return conversationsApi.sendMessage(conversation.value.id, JSON.stringify({ callId: callId.value, ...payload }), { msgType: 'call_signal' })
}
function createPeer() {
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
  peer.onicecandidate = (event) => { if (event.candidate) void sendSignal({ kind: 'ice', candidate: event.candidate.toJSON() }) }
  peer.ontrack = (event) => { if (remoteAudio.value) { remoteAudio.value.srcObject = event.streams[0]; void remoteAudio.value.play().catch(() => {}) } }
  peer.onconnectionstatechange = () => { if (peer?.connectionState === 'connected') callConnecting.value = false }
  if (localStream) localStream.getTracks().forEach((track) => peer?.addTrack(track, localStream as MediaStream))
}
async function startCall() {
  if (!conversation.value || detail.value?.status === 'ended' || callActive.value) return
  if (!navigator.mediaDevices?.getUserMedia) { ElMessage.warning('当前浏览器不支持在线语音通话'); return }
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
  callId.value = crypto.randomUUID(); callConnecting.value = true; callActive.value = true
  createPeer()
  const offer = await peer!.createOffer(); await peer!.setLocalDescription(offer)
  await sendSignal({ kind: 'offer', description: offer })
}
async function processSignals(items: MessageItem[]) {
  if (!conversation.value || !myUserId.value) return
  for (const item of items.filter((msg) => msg.msgType === 'call_signal' && msg.senderId !== myUserId.value)) {
    if (handledSignals.has(item.id)) continue
    handledSignals.add(item.id)
    let signal: { callId?: string; kind?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }
    try { signal = JSON.parse(item.content) } catch { continue }
    if (!signal.callId) continue
    if (signal.kind === 'offer') {
      if (callActive.value) continue
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      callId.value = signal.callId; callActive.value = true; callConnecting.value = true; createPeer()
      await peer!.setRemoteDescription(signal.description!)
      const answer = await peer!.createAnswer(); await peer!.setLocalDescription(answer)
      await sendSignal({ kind: 'answer', description: answer })
    } else if (signal.callId === callId.value && signal.kind === 'answer' && peer) {
      await peer.setRemoteDescription(signal.description!)
    } else if (signal.callId === callId.value && signal.kind === 'ice' && peer && signal.candidate) {
      await peer.addIceCandidate(signal.candidate)
    }
  }
}
function stopCall() {
  peer?.close(); peer = null
  localStream?.getTracks().forEach((track) => track.stop()); localStream = null
  callActive.value = false; callConnecting.value = false; callId.value = ''
  if (remoteAudio.value) remoteAudio.value.srcObject = null
}

const calendarDays = computed(() => {
  const year = calendarMonth.value.getFullYear(); const month = calendarMonth.value.getMonth()
  const first = new Date(year, month, 1); const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date })
})
const monthLabel = computed(() => `${calendarMonth.value.getFullYear()} 年 ${calendarMonth.value.getMonth() + 1} 月`)
function dayKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function dayMeetings(date: Date) { const key = dayKey(date); return meetings.value.filter((item) => item.heldAt.startsWith(key)) }
function changeMonth(offset: number) { const next = new Date(calendarMonth.value); next.setMonth(next.getMonth() + offset); calendarMonth.value = next }

onMounted(async () => {
  if (userStore.token && !userStore.userInfo) {
    await authApi.fetchMe().then((info) => userStore.setUserInfo(info)).catch(() => {})
  }
  await loadProjects()
  const requestedId = typeof route.query.meetingId === 'string' ? route.query.meetingId : ''
  const requested = meetings.value.find((item) => item.id === requestedId) ?? (requestedId ? await meetingsApi.fetchMeeting(requestedId).catch(() => null) : null)
  if (requested) void openDetail(requested)
})
onBeforeUnmount(() => { if (chatPollTimer.value) clearInterval(chatPollTimer.value); stopCall() })
</script>

<template>
  <div class="meetings-page">
    <el-card shadow="never">
      <template #header>
        <div class="toolbar">
          <el-select v-model="currentProjectId" class="project-select" placeholder="选择项目" @change="handleProjectChange">
            <el-option v-for="project in projects" :key="project.id" :label="project.name" :value="project.id" />
          </el-select>
          <el-button type="primary" :disabled="!currentProjectId" @click="openCreate">创建会议</el-button>
        </div>
      </template>
      <el-tabs v-model="tab">
        <el-tab-pane label="即将开始" name="upcoming" />
        <el-tab-pane label="已结束" name="ended" />
        <el-tab-pane label="全部" name="all" />
      </el-tabs>
      <el-table v-loading="loading" :data="filteredMeetings" empty-text="暂无会议">
        <el-table-column label="主题" min-width="190"><template #default="{ row }"><span class="meeting-title">{{ row.title }}</span></template></el-table-column>
        <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="statusTag(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag></template></el-table-column>
        <el-table-column prop="heldAt" label="开始时间" width="170" />
        <el-table-column prop="location" label="地点/线上链接" min-width="150" />
        <el-table-column label="参会人" min-width="150"><template #default="{ row }">{{ attendeeNames(row) }}</template></el-table-column>
        <el-table-column label="操作" width="190" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">进入会议</el-button><el-button link @click="openEdit(row)">编辑</el-button><el-button link type="danger" @click="removeMeeting(row)">删除</el-button></template></el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" class="calendar-card">
      <template #header><div class="calendar-head"><el-button text @click="changeMonth(-1)">‹</el-button><strong>{{ monthLabel }}</strong><el-button text @click="changeMonth(1)">›</el-button></div></template>
      <div class="calendar-grid calendar-week"><span v-for="day in ['日','一','二','三','四','五','六']" :key="day">{{ day }}</span></div>
      <div class="calendar-grid"><button v-for="date in calendarDays" :key="dayKey(date)" class="calendar-day" :class="{ muted: date.getMonth() !== calendarMonth.getMonth(), selected: dayKey(date) === calendarDate }" @click="calendarDate = dayKey(date)"><span>{{ date.getDate() }}</span><i v-if="dayMeetings(date).length" /></button></div>
      <div v-if="calendarDate" class="calendar-events"><strong>{{ calendarDate }}</strong><el-button v-for="item in selectedCalendarMeetings" :key="item.id" link type="primary" @click="openDetail(item)">{{ item.heldAt.slice(11, 16) }} {{ item.title }}</el-button><span v-if="selectedCalendarMeetings.length === 0" class="muted">当天没有会议</span></div>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '创建会议' : '编辑会议'" width="560px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="主题" prop="title"><el-input v-model="form.title" maxlength="200" /></el-form-item>
        <el-form-item label="开始时间"><el-date-picker v-model="form.heldAt" type="datetime" format="YYYY-MM-DD HH:mm:ss" value-format="YYYY-MM-DD HH:mm:ss" class="full-width" /></el-form-item>
        <el-form-item label="地点/链接"><el-input v-model="form.location" maxlength="200" placeholder="教室或线上会议链接" /></el-form-item>
        <el-form-item label="参会人"><el-select v-model="form.attendeeIds" multiple filterable class="full-width"><el-option v-for="member in teamMembers" :key="member.userId" :label="member.nickname || member.username" :value="member.userId" /></el-select></el-form-item>
        <el-form-item label="会议记录"><el-input v-model="form.content" type="textarea" :rows="4" maxlength="20000" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="dialogLoading" @click="handleSubmit">保存</el-button></template>
    </el-dialog>

    <el-dialog v-model="detailVisible" title="会议详情 / 在线会议室" width="860px" @closed="closeDetail">
      <div v-loading="detailLoading" class="meeting-detail" v-if="detail">
        <el-descriptions :column="2" border><el-descriptions-item label="主题" :span="2">{{ detail.title }}</el-descriptions-item><el-descriptions-item label="时间">{{ detail.heldAt || '未安排' }}</el-descriptions-item><el-descriptions-item label="状态"><el-tag :type="statusTag(detail.status)">{{ statusLabel(detail.status) }}</el-tag></el-descriptions-item><el-descriptions-item label="地点/链接" :span="2">{{ detail.location || '线上会议室' }}</el-descriptions-item></el-descriptions>
        <div class="chat-panel">
          <div class="chat-head"><strong>会议讨论区</strong><span class="muted">{{ detail.status === 'ended' ? '会议已结束，讨论区只读' : '文字、语音消息与在线语音通话' }}</span><el-button v-if="!callActive" size="small" type="success" :disabled="detail.status === 'ended'" :loading="callConnecting" @click="startCall">发起语音通话</el-button><el-button v-else size="small" type="danger" @click="stopCall">挂断</el-button><audio ref="remoteAudio" autoplay /></div>
          <div ref="scrollRef" class="message-list"><div v-for="message in messages.filter((item) => item.msgType !== 'call_signal')" :key="message.id" class="message-row"><span class="message-name">{{ message.senderName }}</span><audio v-if="message.msgType === 'audio'" :src="mediaUrl(message.content)" controls /><span v-else>{{ message.content }}</span><small>{{ message.createdAt }}</small></div><el-empty v-if="messages.filter((item) => item.msgType !== 'call_signal').length === 0" description="还没有消息" :image-size="60" /></div>
          <div class="chat-input"><el-input v-model="draft" :disabled="detail.status === 'ended'" placeholder="输入消息，Enter 发送" @keydown.enter.exact.prevent="sendText" /><el-button :disabled="detail.status === 'ended' || !draft.trim()" :loading="sending" type="primary" @click="sendText">发送</el-button><el-button :disabled="detail.status === 'ended'" :type="recording ? 'danger' : 'default'" @click="recording ? stopRecording() : startRecording()">{{ recording ? '停止录音' : '发语音' }}</el-button></div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.meetings-page { display: grid; gap: 16px; }
.toolbar, .calendar-head, .chat-head, .chat-input { display: flex; align-items: center; gap: 10px; }
.toolbar .project-select { width: 260px; margin-right: auto; }
.calendar-card { max-width: 860px; }
.calendar-head { justify-content: center; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.calendar-week { color: #909399; text-align: center; font-size: 12px; margin-bottom: 4px; }
.calendar-day { border: 0; background: transparent; min-height: 42px; border-radius: 6px; cursor: pointer; position: relative; color: #303133; }
.calendar-day:hover, .calendar-day.selected { background: #ecf5ff; }
.calendar-day.muted { color: #c0c4cc; }
.calendar-day i { display: block; width: 5px; height: 5px; margin: 3px auto 0; border-radius: 50%; background: #409eff; }
.calendar-events { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #ebeef5; }
.muted { color: #909399; font-size: 12px; }
.meeting-title { font-weight: 600; }
.full-width { width: 100%; }
.meeting-detail { display: grid; gap: 14px; }
.chat-panel { border: 1px solid #ebeef5; border-radius: 6px; overflow: hidden; }
.chat-head { padding: 10px 12px; border-bottom: 1px solid #ebeef5; }
.chat-head .muted { margin-right: auto; }
.chat-head audio { width: 1px; height: 1px; }
.message-list { height: 280px; overflow-y: auto; padding: 12px; }
.message-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-bottom: 1px dashed #f0f0f0; }
.message-name { font-weight: 600; color: #606266; min-width: 80px; }
.message-row span:not(.message-name) { white-space: pre-wrap; word-break: break-word; flex: 1; }
.message-row small { color: #c0c4cc; white-space: nowrap; }
.message-row audio { max-width: 260px; }
.chat-input { padding: 10px; border-top: 1px solid #ebeef5; align-items: flex-end; }
.chat-input .el-input { flex: 1; }
</style>
