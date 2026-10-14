# frontend 前端工程

Vue 3 + Vite + TypeScript 单页应用。当前处于脚手架阶段：骨架、路由、状态、请求封装已就绪，业务页面为占位视图。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173
```

开发服务器已将 `/api` 代理到 `http://localhost:8080`（见 `vite.config.ts`）。**8080 是前后端约定的后端端口**，变更需同步通知全组。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run build:only` | 仅构建，跳过类型检查（应急用） |
| `npm run typecheck` | 只跑类型检查 |
| `npm run preview` | 预览构建产物 |
| `npm run lint` / `npm run lint:fix` | ESLint 检查与自动修复 |
| `npm run format` | Prettier 格式化 |

## 目录结构

```
src/
├── api/            接口层
│   ├── request.ts     Axios 实例：令牌注入、统一返回体拆包、401 处理
│   ├── types.ts       接口相关的类型定义
│   ├── auth.ts        认证接口
│   ├── file.ts        统一文件上传
│   └── index.ts       统一出口（import { authApi } from '@/api'）
├── router/         路由与登录守卫、页面标题设置
├── store/          Pinia 状态（当前用户、令牌）
├── layouts/        布局壳（侧边栏 + 顶栏）
├── views/          页面视图
├── components/     可复用组件（按模块再分目录）
└── utils/          工具函数
```

## 关键约定

**统一返回体**：后端返回 `{ code, message, data }`，`code === 0` 为成功。`request.ts` 的响应拦截器已经把外层拆掉，因此业务代码拿到的直接是 `data`：

```ts
import { http } from '@/api'

const task = await http.get<TaskItem>('/api/v1/tasks/1')
```

**鉴权**：令牌存在 `localStorage`（键名 `se2026_token`），请求拦截器自动加 `Authorization: Bearer <token>`；返回 `code: 401` 时拦截器统一清令牌并跳登录页，业务代码不需要处理。

**新增页面**：在 `src/views/` 建视图，在 `src/router/index.ts` 注册路由并填 `meta.title`（顶栏标题会跟着变）与 `meta.owner`（负责人，占位页会显示）。

**接口分层**：每个模块在自己的 `src/api/xxx.ts` 里写请求函数，不要直接在各处调用 `axios`。

## 环境变量

复制 `.env.example` 为 `.env.local`。只有 `VITE_` 前缀的变量会暴露到浏览器端，**不要在此写任何密钥**。

## 待补充

- 富文本编辑器（WangEditor）尚未引入，会议记录模块开工时再装；
- 组件库图标未引入，需要时安装 `@element-plus/icons-vue`；
- 业务页面待后端接口就绪后由各负责人替换占位视图。
