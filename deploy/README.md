# deploy 部署配置

本目录集中放置「跑起来需要的东西」，不参与业务开发。

```
deploy/
├── docker-compose.yml        本地开发依赖编排（MySQL 8 + Redis 7）
├── .env.example              环境变量示例（复制为 .env 使用）
├── mysql/init/01-schema.sql  建库脚本，容器首次启动自动执行
└── nginx/default.conf        Nginx 反代配置（首次上线时启用）
```

## 日常使用

```bash
cd deploy
cp .env.example .env          # 首次执行
docker compose up -d          # 只启 MySQL
docker compose --profile full up -d   # 额外启 Redis
docker compose ps             # 查看状态
docker compose logs -f mysql  # 查看 MySQL 日志
```

连接信息（默认值）：

| 项 | 值 |
| --- | --- |
| 主机 | `127.0.0.1` |
| 端口 | `3306` |
| 数据库 | `se2026` |
| 用户名 | `root` |
| 密码 | 见 `.env` 中的 `MYSQL_ROOT_PASSWORD`（默认 `root123456`） |

## 建库脚本

`mysql/init/01-schema.sql` 由 MySQL 官方镜像在**数据卷为空时**自动执行，共 18 张表。

若你要修改表结构：

- 开发早期：直接改 `01-schema.sql`，然后 `docker compose down -v && docker compose up -d` 重建（**会清空数据**）；
- 有数据之后：新增 `mysql/init/02-xxx.sql` 增量脚本，但注意 init 目录只在首次初始化时整体执行，已有数据卷不会重跑——此时应手动执行增量 SQL。

## 注意事项

- `.env` 不入库，只提交 `.env.example`；新增配置项请同步更新示例文件。
- `MYSQL_PORT` 若与本机已装的 MySQL 冲突（默认 3306），改成 `3307` 等空闲端口。
- 本机未安装 MySQL 客户端不影响使用，可用容器的 `mysql` 命令验证：
  ```bash
  docker exec -it se2026-mysql mysql -uroot -p se2026 -e "SHOW TABLES;"
  ```
- Nginx 配置中 `upstream` 指向的 `backend:8080` 需与后端实际服务名、端口一致，首次上线时确认。

## 生产 / 演示环境（docker-compose.prod.yml）

组服务器为 `82.156.156.94`（Ubuntu 26.04，2C4G），代码放在 `/opt/se2026`。

| 文件 | 作用 |
| --- | --- |
| `docker-compose.prod.yml` | MySQL + 后端 + 前端(Nginx) 三服务完整编排 |
| `nginx/prod.conf` | 容器内 Nginx：托管前端产物、`/api/` 反代 `backend:8080` |
| `../frontend/Dockerfile` | 前端多阶段构建（Vite 编译 → Nginx 托管） |
| `.env.prod.example` | 生产环境变量样例 |

拓扑：宿主机 `80` → `web`(Nginx) → `backend:8080` → `mysql:3306`。
**只有 web 映射端口**，MySQL 与后端只在容器网络内可达（避免公网 3306 被扫库）。

```bash
# 服务器上首次部署
cd /opt/se2026/deploy
cp .env.prod.example .env.prod && vi .env.prod   # 填随机强密码与 JWT_SECRET
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build

# 日常发版（代码更新后）
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build backend web

# 排查
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
```

访问入口：

- 前端首页 `http://82.156.156.94/`
- 健康检查 `http://82.156.156.94/api/v1/health`（含数据库连通性）
- 接口文档 `http://82.156.156.94/api/v1/docs`

注意：

- `.env.prod` 与 `.env` 一样不入库（`.gitignore` 已覆盖 `.env.*`）。
- 演示期 `APP_ENABLE_DEV_TOKEN=true` 便于用 `dev-token` 自测鉴权；正式对外请改 `false`。
- 腾讯云**安全组**需放行 80（当前已放行）；改 `WEB_PORT` 后要同步改安全组。

## 运维脚本（`scripts/`）

服务器上的日常操作都封装在脚本里，避免每次手敲长命令。三个脚本都可重复执行（幂等）。

| 脚本 | 用途 | 用法 |
| --- | --- | --- |
| `deploy.sh` | 构建镜像 → 滚动更新 → 健康检查（默认等 180s） | `./scripts/deploy.sh`　依赖变更时加 `--no-cache` |
| `backup-mysql.sh` | `mysqldump` 一致性备份 + gzip + 校验 + 清理 7 天前 | `./scripts/backup-mysql.sh`（已配 cron 每日 03:30） |
| `restore-mysql.sh` | 恢复备份；不加 `--yes` 时只做演练校验 | `./scripts/restore-mysql.sh <文件> [--yes]` |

说明：

- 脚本以 `APP_DIR=/opt/se2026` 为默认根目录，可通过环境变量覆盖；
- `deploy.sh` **不会**覆盖 `.env.prod`、不会动 MySQL 数据卷，只是重建 backend/web 容器；
- `restore-mysql.sh` 真正恢复前会自动先备份当前数据，误操作仍有退路；
- 详细运维流程（含 GitHub Actions 自动部署的 5 个 Secrets 配法）见 [../docs/07-上线运维手册.md](../docs/07-上线运维手册.md)。
