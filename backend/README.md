# backend —— 校园科研项目协作与成果管理平台（后端）

**技术选型：Node.js 22 + NestJS 11 + TypeScript + Prisma 6 + MySQL 8**

> 选型理由与对比见 [docs/05-后端选型对比.md](../docs/05-后端选型对比.md)。
> 接口口径见 [docs/01-接口规范.md](../docs/01-接口规范.md)，数据口径见 [docs/02-数据字典.md](../docs/02-数据字典.md)。

---

## 一、这个底座已经包含什么

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| 统一返回体 `{code,message,data}` | `src/common/result.ts` + `interceptors/` | 控制器直接返回数据即可，自动包装 |
| 全局异常处理 | `src/common/filters/all-exceptions.filter.ts` | HTTP 语义化返回 + 业务错误码 |
| 参数校验 | `src/main.ts` 的 `ValidationPipe` | 多余字段直接拒绝，防越权写入 |
| JWT 鉴权链路 | `src/auth/` + `src/common/guards/` | 令牌签发/校验 + 全局守卫 + `@Public()` |
| 角色守卫骨架 | `src/common/guards/roles.guard.ts` | 课题组维度角色，service 层仍需复核 |
| **行为埋点机制** | `src/activity/` | `@ActivityLog()` 注解 + 拦截器 + 事务内写入方法 |
| Prisma 数据模型 | `prisma/schema.prisma` | 18 张表 + 逻辑关系（数据库无外键） |
| 在线接口文档 | `/api/v1/docs` | Swagger UI（`@nestjs/swagger`） |
| 健康检查 | `GET /api/v1/health` | 含数据库连通性探测 |
| 容器化 | `backend/Dockerfile` + `deploy/docker-compose.yml` | 多阶段构建，`app` profile 启动 |

## 二、前置环境

| 项 | 要求 |
| --- | --- |
| Node.js | 22.x |
| npm | 10.x |
| Docker Desktop | 用于跑 MySQL 8，需手动启动 |
| MySQL 客户端 | 可选：直接用容器的 `mysql` 命令即可，无需本机安装 |

## 三、首次启动

```bash
cd backend

# 1. 安装依赖（约 2–3 分钟）
npm install

# 2. 生成本地配置（默认值可直接用）
cp .env.example .env

# 3. 生成 Prisma 客户端（改了 prisma/schema.prisma 后必须重跑）
npx prisma generate

# 4. 启动开发服务（热重载）
npm run start:dev
```

服务地址：`http://localhost:8080/api/v1`　接口文档：`http://localhost:8080/api/v1/docs`

> **数据库没起也能跑**：PrismaService 连接失败只会打一条 WARN，服务照常启动，
> 便于先验证接口与文档；涉及数据的接口才会报错。

## 四、启动数据库（跑通完整链路时需要）

```bash
# 先手动启动 Docker Desktop，等状态栏变绿
cd ../deploy
cp .env.example .env        # 首次
docker compose up -d        # 只起 MySQL（日常开发推荐，后端本机跑热重载快）

# 想连后端一起放进容器（可选）
docker compose --profile app up -d --build
```

首次启动会自动执行 `deploy/mysql/init/01-schema.sql` 建 18 张表。
重建库：`docker compose down -v && docker compose up -d`。

## 五、✅ 验证清单（逐条照做即可确认底座可用）

以下 `curl` 在 Git Bash / PowerShell 均可运行；也可直接打开接口文档页点。

**① 健康检查**（不需要数据库）

```bash
curl http://localhost:8080/api/v1/health
```
期望（数据库没起时 `database` 为 `disconnected`，属正常）：
```json
{"code":0,"message":"ok","data":{"service":"se2026-backend","status":"up","time":"...","database":"disconnected"}}
```

**② 未带令牌访问受保护接口 → 应当被拒**

```bash
curl -i http://localhost:8080/api/v1/auth/me
```
期望：HTTP **401**，body `{"code":401,"message":"Unauthorized","data":null}`

**③ 用开发接口换一个令牌**（仅本地开发可用，生产环境自动关闭）

```bash
curl -X POST http://localhost:8080/api/v1/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","username":"demo"}'
```
期望：`{"code":0,"message":"ok","data":{"token":"eyJ...","tokenType":"Bearer","expiresIn":604800}}`

**④ 带令牌访问 → 应当通过**

```bash
curl -H "Authorization: Bearer <上一步的 token>" http://localhost:8080/api/v1/auth/me
```
期望：`{"code":0,"message":"ok","data":{"userId":"1","username":"demo","roles":[]}}`

**⑤ 多余字段被参数校验拦下**

```bash
curl -X POST http://localhost:8080/api/v1/auth/dev-token \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","unexpected":"x"}'
```
期望：HTTP **400**，`{"code":400,"message":"property unexpected should not exist","data":null}`

**⑥ 接口文档页**：浏览器打开 `http://localhost:8080/api/v1/docs`，应能看到「系统」「鉴权」两组接口。

**⑦ 自动化测试**

```bash
npm run build      # 编译通过
npm run lint       # 无报错
npm test           # 单元测试（6 项）
npm run test:e2e   # 端到端冒烟（5 项，覆盖上面 ①–⑤）
```

**⑧ 数据库连通性**（需先启动 Docker + MySQL）

重新请求 ① ，`database` 应变为 `connected`；若仍为 `disconnected`，
检查 `docker compose ps` 与 `.env` 里的 `DATABASE_URL`（容器内跑后端时主机名要写 `mysql` 而不是 `localhost`）。

## 六、目录结构

```
src/
├── main.ts                     入口：全局前缀、校验管道、返回体、异常过滤、Swagger
├── app.module.ts               根模块：配置、Prisma、埋点、鉴权、健康检查
├── common/                     公共层（各模块共用）
│   ├── result.ts               统一返回体、错误码、BizException
│   ├── decorators/             @Public() / @CurrentUser() / @Roles()
│   ├── guards/                 JwtAuthGuard（全局）、RolesGuard
│   ├── filters/                AllExceptionsFilter
│   └── interceptors/           TransformInterceptor（统一包装）
├── prisma/                     PrismaService（全局模块）
├── activity/                   埋点：常量与权重、注解、拦截器、服务
├── auth/                       鉴权：令牌签发校验、开发令牌、/me
└── health/                     健康检查
prisma/schema.prisma            18 张表的数据模型（口径见 docs/02）
```

## 七、开发约定（重要）

1. **统一返回体**：控制器里 `return 业务数据` 即可，不要自己拼 `{code,message,data}`；
   出错请 `throw BizException.notFound('任务不存在')`，不要 `throw new Error()`。
2. **错误码取值只有** `0 / 400 / 401 / 403 / 404 / 409 / 500`（见 `src/common/result.ts`），
   与 `docs/01` 严格一致，前端拦截器按 `code === 401` 跳登录。
3. **逻辑删除**：所有表都有 `deleted` 字段，Prisma **不会自动过滤**，
   查询必须显式写 `where: { deleted: 0 }`。
4. **不要用 `prisma migrate dev` / `prisma db push`**：表结构以
   `deploy/mysql/init/01-schema.sql` 为准，Prisma 只做映射。
   也不要 `prisma db pull` 覆盖 `schema.prisma`（会把逻辑关系抹掉）。
5. **埋点**：业务写操作都要留痕，两种写法见下节。
6. **字段命名**：TypeScript 用 camelCase，数据库用 snake_case，
   映射写在 `schema.prisma` 的 `@map` / `@@map`，业务代码不要直接写 SQL 列名。
7. **id 一律是字符串**：`BIGINT UNSIGNED` 主键在 JSON 里序列化为字符串
   （`main.ts` 里已给 `BigInt.prototype.toJSON` 打了补丁，否则 `JSON.stringify` 会直接抛错）。
   前端 `id` 类型是 `string`，**不要当数字做加减或 `===` 比较**（路由参数本来就是字符串，直接用即可）。
8. **时间字段要格式化后再返回**：数据库存的是 UTC，接口按规范要北京时间字符串。
   请用 `src/common/datetime.ts`：
   ```ts
   import { formatDateTime, formatDate } from '../common/datetime';
   formatDateTime(task.createdAt)  // '2026-10-15 17:53:10'
   formatDate(task.dueDate)        // '2026-10-15'（DATE 类型字段用这个）
   ```
   不格式化的话会吐出 `2026-10-15T09:53:10.429Z`，与 `docs/01` 的约定不符。
9. **不要 `npm update` / 装 `@latest`**：见第十节的版本钉选，升级会直接让测试和启动失败。

## 八、埋点怎么用（贡献度模块的数据来源）

```ts
// 写法一：注解自动埋点（简单场景，方法成功后独立写入）
@ActivityLog({
  type: ActivityType.TASK_DONE,
  refType: 'task',
  refIdFrom: 'param',
  refIdKey: 'id',
})
@Post(':id/done')
finish(@Param('id') id: string) { ... }

// 写法二：与业务写入严格同事务（docs/03 推荐）
await this.prisma.$transaction(async (tx) => {
  const task = await tx.task.update({ where: { id }, data: { status: 'done' } });
  await this.activity.recordInTransaction(tx, {
    userId, teamId, type: ActivityType.TASK_DONE, refType: 'task', refId: task.id,
  });
});
```

权重统一写在 `src/activity/activity.constants.ts`，**改权重必须先改 `docs/03`**（答辩要求口径可追溯）。

## 九、本底座**不包含**的内容（留给组员的业务模块）

按实现方案的分工，以下属于业务功能，需要各组员在 `src/modules/` 下自行实现：

| 模块 | 负责人 | 建议入口 |
| --- | --- | --- |
| 注册/登录/密码校验/邀请码入组/角色管理 | A | `src/auth/` 补 `register`、`login`、`team` 相关接口 |
| 项目、里程碑、任务看板（含拖拽排序） | B | 新建 `src/modules/project/`、`src/modules/task/` |
| 文献、标签、会议记录、成果、讨论区 | C | 新建 `src/modules/literature/`、`meeting/`、`achievement/`、`conversation/` |
| 贡献度聚合（去重、单日上限、归一化、趋势） | D | 新建 `src/modules/activity/analysis` 或在 `src/activity/` 扩展 |
| 文件上传 | 谁先用到谁做 | 新建 `src/modules/file/`，`@types/multer` 已装 |

新增模块后记得在 `src/app.module.ts` 的 `imports` 里注册。

## 十、已知坑（都已规避，改依赖时注意）

1. **不要升到 Nest 12**：Nest 12 模板是 ESM（`"type": "module"`），相对导入必须写 `.js` 后缀，
   且与 Prisma/Jest 组合会踩坑；本项目用 **Nest 11（CommonJS）**，与绝大多数教程一致。
2. **`@nestjs/config` 与 `@nestjs/schedule` 必须留在 4.x / 6.x**：
   它们的 12.x 是 ESM-only（`type: module`），在 CJS + Jest 下会报
   `Must use import to load ES Module`。
3. **`prisma` 的 npm `latest` 标签目前指向 `8.0.0-rc`**，千万别裸装 `npm i prisma`；
   本项目固定 **6.19.3**（与 `@prisma/client` 同版本）。
4. **Prisma 7 起 `datasource.url` 被移除**，必须用 `prisma.config.ts` + driver adapter，
   与现有教程写法不兼容，故暂不升级。
5. **`@nestjs/swagger` 必须用 11.x**：12.x 的 peer 要求 `@nestjs/common@^12`。
6. 本机若出现 `Warning: Ignoring extra certs ...` 属环境提示，不影响运行。
