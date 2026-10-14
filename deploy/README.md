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
