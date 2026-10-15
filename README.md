# 校园科研项目协作与成果管理平台

面向本科生科研团队的协作与成果管理平台。项目以「协作工具底座 + 成员参与度可视化」为主轴：底座提供课题组、项目、任务、文献、会议、成果等常规协作能力，亮点是在业务数据之上沉淀行为埋点，形成**成员参与度画像**。

> 参与度画像仅作为团队协作过程的**可视化参考**，不构成任何科研贡献评价。详见 [docs/03-贡献度口径说明.md](docs/03-贡献度口径说明.md)。

## 一、技术栈

| 层次 | 选型 |
| --- | --- |
| 前端框架 | Vue 3 + Vite + TypeScript |
| UI 组件库 | Element Plus |
| 状态与路由 | Pinia + Vue Router 4 |
| 网络请求 | Axios |
| 数据可视化 | ECharts 5 |
| 交互增强 | vuedraggable（Sortable.js） |
| 后端框架 | **Node.js 22 + NestJS 11 + TypeScript**（已定案，2026-10-15） |
| 数据访问 | Prisma 6（MySQL 8.0） |
| 身份认证 | Passport-JWT |
| 数据库 | MySQL 8.0 |
| 缓存（可选） | Redis 7 |
| 文件存储 | 本地磁盘（后续可换 MinIO / 对象存储） |
| 接口文档 | Swagger（`/api/v1/docs`） |
| 部署运行 | Docker + Docker Compose + Nginx |
| 版本控制 | Git + GitHub |

> 后端选型理由见 [docs/05-后端选型对比.md](docs/05-后端选型对比.md)；
> 版本钉选（**不要 `npm update` 全量升级**）见 [backend/README.md](backend/README.md) 第十节。

## 二、目录结构

```
.
├── frontend/          前端工程（Vue 3 + Vite + TS）
├── backend/           后端工程（NestJS 11 + Prisma，公共层与鉴权底座已就绪）
├── deploy/            部署配置：docker-compose、MySQL 建库脚本、Nginx
├── docs/              接口规范、数据字典、贡献度口径、GitHub 协作、选型与终检
├── CONTRIBUTING.md    分支模型、提交规范、PR 流程
├── .gitignore         全局忽略规则
├── .editorconfig      编辑器统一配置
└── *.docx             项目计划书与实现方案（答辩用正式文档）
```

## 三、快速开始

**前置环境**：Node.js 22.x、npm 10.x、Docker Desktop（跑 MySQL 用，需手动启动）。

按顺序执行即可跑通完整链路：

### 1. 启动数据库（MySQL 8）

```bash
cd deploy
cp .env.example .env          # 首次执行，按需修改端口与密码
docker compose up -d          # 默认只拉起 MySQL；首次启动自动执行建库脚本（18 张表）
```

如需同时拉起 Redis：`docker compose --profile full up -d`。

### 2. 启动后端（监听 8080）

```bash
cd backend
npm install                   # 首次安装依赖（约 2–3 分钟）
cp .env.example .env          # 首次执行，默认值可直接用
npx prisma generate           # 生成 Prisma 客户端
npm run start:dev             # 热重载开发服务
```

服务地址：`http://localhost:8080/api/v1`　接口文档：`http://localhost:8080/api/v1/docs`

> Windows 下 `DATABASE_URL` 主机名**必须用 `127.0.0.1`**（`localhost` 会被 Prisma 解析为 IPv6 连不上），`.env.example` 已按此配置。
> 数据库没起也能启动（只打一条 WARN），便于先验证接口与文档；完整验证清单见 [backend/README.md](backend/README.md) 第五节。

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev                   # 默认 http://localhost:5173
```

前端开发服务器已将 `/api` 代理到 `http://localhost:8080`（见 `frontend/vite.config.ts`），**该端口为前后端约定值**，后端启动时请监听 8080。

### 4. 验证跑通

```bash
curl http://localhost:8080/api/v1/health
# 期望 data.database 为 "connected"（数据库已起时）
```

## 四、约定文档

| 文档 | 内容 |
| --- | --- |
| [docs/01-接口规范.md](docs/01-接口规范.md) | 接口前缀、统一返回体、鉴权、分页、错误码 |
| [docs/02-数据字典.md](docs/02-数据字典.md) | 全部数据表、字段、类型与索引 |
| [docs/03-贡献度口径说明.md](docs/03-贡献度口径说明.md) | 参与度指标的定义、权重、排除项与反刷分设计 |
| [docs/04-GitHub协作指南.md](docs/04-GitHub协作指南.md) | 加入仓库、GitHub CLI、SSH、PR 流程、维护者操作 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 分支模型、提交信息格式、代码评审流程 |

完整索引见 [docs/README.md](docs/README.md)。

## 五、开发推进顺序

| 周次 | 主要工作 |
| --- | --- |
| 第 1 周 | 脚手架、统一返回体、全局异常、建表、行为埋点 |
| 第 2 周 | 注册登录与鉴权、课题组与角色、跑通「登录到建任务」最小闭环 |
| 第 3–4 周 | 项目管理、任务看板、任务评论、文献管理 |
| 第 5 周 | 中期验收（核心功能可演示） |
| 第 6–7 周 | 贡献度分析攻坚、画像可视化、弹性功能 |
| 第 8 周 | 系统联调、部署上线、文档与答辩、最终验收 |

## 六、团队分工

四人纵向切片，各人对自己的模块负责前后端与联调：

| 成员 | 负责模块 |
| --- | --- |
| A | 账号与课题组、架构、ER、Git 与部署、通用支撑 |
| B | 项目与任务、甘特图、任务评论 |
| C | 文献、会议、成果、协作沟通、前端框架与 UI 规范 |
| D | 贡献度分析、画像可视化、测试与答辩材料 |
