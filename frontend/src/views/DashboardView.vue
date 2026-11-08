<script setup lang="ts">
interface TaskItem {
  name: string
  done: boolean
}

interface ModuleCard {
  title: string
  owner: string
  scope: string
  status: '待开工' | '进行中' | '已完成'
  tasks: TaskItem[]
}

/** 状态 → 标签色，让开工情况一眼可分 */
const statusTagType: Record<ModuleCard['status'], 'success' | 'warning' | 'info'> = {
  已完成: 'success',
  进行中: 'warning',
  待开工: 'info'
}

// 开工情况为人工维护的静态快照：依据 docs/09 任务分派表与 develop 合并记录，改状态请同步更新
const modules: ModuleCard[] = [
  {
    title: '账号与课题组',
    owner: 'A',
    scope: '注册登录、JWT 鉴权、邀请码入组、角色权限、个人资料与改密',
    status: '已完成',
    tasks: [
      { name: 'A-1 注册/登录', done: true },
      { name: 'A-2 课题组与角色', done: true },
      { name: 'A-补1 个人资料', done: true },
      { name: 'A-补2 修改密码', done: true }
    ]
  },
  {
    title: '项目与任务',
    owner: 'B',
    scope: '项目增删改查、里程碑、任务看板拖拽、任务评论、甘特图',
    status: '已完成',
    tasks: [
      { name: 'B-1 项目与里程碑', done: true },
      { name: 'B-2 任务看板', done: true },
      { name: 'B-3 任务评论', done: true },
      { name: 'B-补2 甘特图', done: true },
      { name: 'B-补1 项目概览·待建卡', done: false }
    ]
  },
  {
    title: '文献与会议',
    owner: 'C',
    scope: '文献上传与标签、会议记录、从会议提取待办',
    status: '已完成',
    tasks: [
      { name: 'C-4 上传底座', done: true },
      { name: 'C-1 文献管理', done: true },
      { name: 'C-2 会议记录', done: true }
    ]
  },
  {
    title: '成果管理',
    owner: 'C',
    scope: '成果分类登记、附件上传、成员关联',
    status: '待开工',
    tasks: [
      { name: '附件底座 C-4', done: true },
      { name: 'C-3 成果登记', done: false }
    ]
  },
  {
    title: '协作沟通',
    owner: 'B / C',
    scope: '上下文评论、项目讨论区、未读数轮询',
    status: '待开工',
    tasks: [
      { name: '任务评论·随 B-3', done: true },
      { name: 'C-5 会话消息·弹性', done: false }
    ]
  },
  {
    title: '参与度分析',
    owner: 'D',
    scope: '行为埋点统计、多维加权、雷达图与排行',
    status: '进行中',
    tasks: [
      { name: 'D-1 统计接口', done: true },
      { name: 'D-2 画像可视化', done: false },
      { name: '权重校准', done: false }
    ]
  }
]

const prerequisites = [
  'C 线剩余写入点（C-3 成果、C-5 消息）上线前，对照 docs/03 第九节自查埋点 ref 口径（task / 文献 / 成果 / 会议各有固定 refType；B-3 曾因评论埋点 ref 维度不符被判 invalid_ref，PR #14 已修并加回归）',
  '消息轮询间隔存量冲突：SRS 写 30s、docs/01 写 3–5s，C-5 开工前须全组定（工程建议 30s）',
  'B-补1 项目概览、C-补1 逾期提醒两张补卡尚未建卡，先补卡再排期',
  '演示期 dev-token 仍开启（APP_ENABLE_DEV_TOKEN），正式验收前须关闭'
]
</script>

<template>
  <div class="dashboard">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="进度快照 2026-11-08：A / B 主线与 C-1/C-2/C-4、D-1 已上线"
      description="账号、项目任务全链路（含看板、甘特图、评论）、文献与会议记录、文件上传与参与度统计接口已部署；下一步主攻 C-3 成果登记、C-5 会话消息与 D-2 参与度画像。"
    />

    <h2 class="section-title">模块进度</h2>
    <el-row :gutter="16">
      <el-col v-for="item in modules" :key="item.title" :xs="24" :sm="12" :lg="8">
        <el-card shadow="never" class="module-card">
          <div class="module-head">
            <span class="module-title">{{ item.title }}</span>
            <el-tag size="small" :type="statusTagType[item.status]">{{ item.status }}</el-tag>
          </div>
          <p class="module-owner">负责人：{{ item.owner }}</p>
          <p class="module-scope">{{ item.scope }}</p>
          <div class="module-tasks">
            <span
              v-for="task in item.tasks"
              :key="task.name"
              class="task-chip"
              :class="{ 'is-done': task.done }"
            >
              {{ task.name }}
            </span>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <h2 class="section-title">开工前置与待决事项</h2>
    <el-card shadow="never">
      <ul class="prereq-list">
        <li v-for="item in prerequisites" :key="item">{{ item }}</li>
      </ul>
    </el-card>

    <h2 class="section-title">约定文档</h2>
    <el-card shadow="never">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="接口规范">
          仓库 docs/01-接口规范.md —— 前缀 /api/v1、统一返回体、Bearer、分页
        </el-descriptions-item>
        <el-descriptions-item label="数据字典">
          仓库 docs/02-数据字典.md —— 共 18 张表，含 activity_log 与 file
        </el-descriptions-item>
        <el-descriptions-item label="参与度口径">
          仓库 docs/03-贡献度口径说明.md —— 仅作过程参考，不构成科研评价
        </el-descriptions-item>
        <el-descriptions-item label="协作规范">
          仓库 CONTRIBUTING.md —— 分支模型、提交格式、PR 流程
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <h2 class="section-title">一条建议</h2>
    <el-card shadow="never">
      <p class="tip-text">
        用这个平台管理本项目自己的任务与进度（自举）。既能给参与度分析提供真实埋点数据，
        答辩时也能现场演示「用作品管理作品」。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
}

.section-title {
  margin: 24px 0 12px;
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}

.section-title:first-of-type {
  margin-top: 20px;
}

.module-card {
  margin-bottom: 16px;
  border-radius: 8px;
}

.module-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.module-title {
  font-size: 14px;
  color: #303133;
}

.module-owner {
  margin: 10px 0 6px;
  font-size: 13px;
  color: #606266;
}

.module-scope {
  margin: 0;
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
}

.module-tasks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.task-chip {
  padding: 2px 8px;
  font-size: 12px;
  line-height: 18px;
  color: #909399;
  background: #f4f4f5;
  border-radius: 9px;
}

.task-chip.is-done {
  color: #529b2e;
  background: #f0f9eb;
}

.task-chip.is-done::before {
  content: '✓ ';
  font-weight: 600;
}

.prereq-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  color: #606266;
  line-height: 2;
}

.tip-text {
  margin: 0;
  font-size: 13px;
  color: #606266;
  line-height: 1.8;
}
</style>
