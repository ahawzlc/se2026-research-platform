# 协作规范

本文件是团队协作的唯一约定来源。所有成员在提交代码前请先读一遍；规范一旦确认不得私自修改，如需调整请在群里提出并同步更新本文件。

## 一、分支模型

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 稳定主线 | **受保护**，禁止直接 push，只接受来自 `develop` 的 PR；每个验收节点打 tag |
| `develop` | 集成分支 | 日常集成的目标分支，功能完成后合入此处 |
| `feature/<模块>-<简述>` | 功能开发 | 从 `develop` 切出，完成后 PR 回 `develop` |
| `hotfix/<简述>` | 紧急修复 | 从 `main` 切出，修复后同时合回 `main` 与 `develop` |

命名示例：`feature/auth-login`、`feature/task-kanban`、`hotfix/login-token-expire`。

开发流程：

```bash
git switch develop
git pull --rebase origin develop
git switch -c feature/task-kanban
# ... 开发 ...
git add .
git commit -m "feat(task): 支持看板拖拽换列"
git push -u origin feature/task-kanban
```

然后在 GitHub 上发起 PR 到 `develop`，**至少 1 人 review 通过**方可合并。合并前请先 `git pull --rebase origin develop` 消除分叉，保持历史线性。

## 二、提交信息规范（Conventional Commits）

格式：`<type>(<scope>): <描述>`

| type | 含义 |
| --- | --- |
| `feat` | 新增功能 |
| `fix` | 修复缺陷 |
| `docs` | 仅文档变更 |
| `style` | 不影响逻辑的格式调整 |
| `refactor` | 重构（既非新增也非修复） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建、依赖、配置等杂项 |
| `build` | 构建系统或外部依赖变更 |
| `ci` | 持续集成配置 |

约定：

- 描述使用中文，动词开头，**不加句号**，单行不超过 60 字；
- 一个提交只做一件事，不要把重构与功能混在一起；
- scope 建议取值：`auth`、`team`、`project`、`task`、`literature`、`meeting`、`achievement`、`chat`、`stats`、`ui`、`deploy`、`docs`。

示例：

```
feat(auth): 新增注册与 JWT 登录
fix(task): 修复拖拽换列后排序值未持久化
docs(api): 补充未读消息轮询接口说明
chore(deploy): 增加 MySQL 容器编排配置
```

## 三、代码评审（PR）

- 标题同样遵循 Conventional Commits 的格式；
- 描述中说明**做了什么、为什么这么做、如何验证**，涉及界面改动请附截图；
- 单次 PR 变更建议控制在 500 行以内；超过说明拆分得不够细；
- 评审人重点看：业务逻辑正确性、命名、是否遗漏埋点调用、是否有越权查询（是否带了团队标识条件）；
- 不允许 `--no-verify` 跳过钩子，不允许强推已合入的公共分支。

## 四、环境变量与敏感信息

- **`.env` 一律不入库**，仓库中只保留 `.env.example` 作为键名的说明与默认示例；
- 新增配置项时，必须同步更新对应的 `.env.example`，并在 PR 描述里注明；
- 数据库密码、JWT 密钥、对象存储密钥等严禁写入代码或提交历史；一旦误提交，需立即更换凭据并清理历史。

## 五、版本与标签

| 标签 | 时点 |
| --- | --- |
| `v0.1` | 第 1 周：脚手架与最小闭环就绪 |
| `v0.5` | 第 5 周：中期验收版本 |
| `v0.8` | 第 7 周：功能基本冻结 |
| `v1.0` | 第 8 周：最终验收版本 |

打标签前必须先合入 `main` 并通过回归自测。

## 六、其他约定

- 换行统一 LF，编码统一 UTF-8，缩进见 `.editorconfig`；
- 前端提交前执行 `npm run format`，保持格式统一；
- 提交前先 `git status` 确认没有把 `node_modules/`、`dist/`、`.env` 等误加入暂存区；
- 遇到冲突优先本地 `rebase` 解决，不要用 `git merge` 制造无意义的合并提交。
