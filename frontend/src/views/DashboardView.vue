<script setup lang="ts">
interface ModuleCard {
  title: string
  owner: string
  scope: string
  status: '待开工' | '进行中' | '已完成'
}

const modules: ModuleCard[] = [
  { title: '账号与课题组', owner: 'A', scope: '注册登录、JWT 鉴权、邀请码入组、角色权限', status: '待开工' },
  { title: '项目与任务', owner: 'B', scope: '项目增删改查、里程碑、任务看板拖拽、任务评论', status: '待开工' },
  { title: '文献与会议', owner: 'C', scope: '文献上传与标签、会议记录、从会议提取待办', status: '待开工' },
  { title: '成果管理', owner: 'C', scope: '成果分类登记、附件上传、成员关联', status: '待开工' },
  { title: '协作沟通', owner: 'B / C', scope: '上下文评论、项目讨论区、未读数轮询', status: '待开工' },
  { title: '参与度分析', owner: 'D', scope: '行为埋点统计、多维加权、雷达图与排行', status: '待开工' }
]

const prerequisites = [
  '后端技术栈二选一（Spring Boot 3 或 NestJS）—— 这是唯一的阻塞项',
  'activity_log 表与统一埋点方法必须在第 1 周随基础模块一起实现',
  '统一返回体 { code, message, data } 前后端需完全对齐'
]
</script>

<template>
  <div class="dashboard">
    <el-alert
      type="warning"
      :closable="false"
      show-icon
      title="当前处于第 1 周：脚手架阶段"
      description="前端骨架、接口封装、建库脚本与协作规范已就绪；后端待选型，业务模块待实现。"
    />

    <h2 class="section-title">模块进度</h2>
    <el-row :gutter="16">
      <el-col v-for="item in modules" :key="item.title" :xs="24" :sm="12" :lg="8">
        <el-card shadow="never" class="module-card">
          <div class="module-head">
            <span class="module-title">{{ item.title }}</span>
            <el-tag size="small" type="info">{{ item.status }}</el-tag>
          </div>
          <p class="module-owner">负责人：{{ item.owner }}</p>
          <p class="module-scope">{{ item.scope }}</p>
        </el-card>
      </el-col>
    </el-row>

    <h2 class="section-title">开工前置条件</h2>
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
