# backend 后端工程（占位）

**当前状态：技术选型待定，尚未初始化工程。**

## 为什么这里是空的

实现方案中后端给出两套等价方案，需项目组按熟悉程度二选一，且**一旦确定不得中途更换**：

| 方案 | 技术栈 | 说明 |
| --- | --- | --- |
| 方案一（主推） | Spring Boot 3 + Java 17 + Spring Security + JWT + MyBatis-Plus + Knife4j | 生态成熟、资料丰富 |
| 方案二（备选） | Node.js + NestJS + Passport-JWT + Prisma + Swagger | 全栈同语言、上手快 |

本机现状（供选型参考）：

- JDK 已装 **21**（Spring Boot 3 要求 17+，21 可用）；
- **Maven 未安装**，选方案一需补装（或用 Gradle Wrapper / IDE 内置）；
- Node.js 已装 **v22**，选方案二可直接开工。

## 选型确定后要做的事

1. 生成工程骨架：
   - 方案一：Spring Initializr，依赖勾选 `Spring Web`、`Spring Security`、`MySQL Driver`、`MyBatis-Plus`、`Validation`、`Lombok`、`Knife4j`；
   - 方案二：`nest new backend`，接入 `@nestjs/jwt`、`@nestjs/passport`、`prisma`、`@nestjs/swagger`。
2. 按 `controller / service / mapper / entity / config` 分层建目录；
3. 实现公共代码，**这几项必须第一周完成**：
   - 统一返回体 `Result<T>`：`{ code, message, data }`，口径见 [../docs/01-接口规范.md](../docs/01-接口规范.md)；
   - 全局异常处理器，把异常映射到统一返回体；
   - 跨域配置、JWT 过滤器 / 中间件；
   - **统一埋点方法**：任何业务写入都要同步追加一条 `activity_log`，见 [../docs/02-数据字典.md](../docs/02-数据字典.md)；
4. 连接 `deploy/` 拉起 MySQL，运行 `SELECT 1` 验证连通；
5. 打开接口文档页面（Knife4j / Swagger），提供接口清单；
6. **服务端口固定监听 8080**——前端 `vite.config.ts` 的 `/api` 代理已按此约定配置，改动需同步通知 C 组。

## 相关约定

- 环境变量键名参考同目录 [`.env.example`](.env.example)，实际配置写入本地 `.env`（不入库）；
- 所有涉及课题组数据的查询必须附加团队标识条件，防止越权；
- 提交信息与分支规范见仓库根目录 [CONTRIBUTING.md](../CONTRIBUTING.md)。
