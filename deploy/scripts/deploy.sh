#!/usr/bin/env bash
# ==============================================================================
# 幂等部署脚本（在服务器 /opt/se2026 上执行）
# ------------------------------------------------------------------------------
# 做什么：构建 backend / web 镜像 → 启动或滚动更新容器 → 等待健康检查通过
# 不做的事：不碰 MySQL 数据卷、不覆盖 deploy/.env.prod、不动表结构
#
# 用法：
#   /opt/se2026/deploy/scripts/deploy.sh                 # 常规发版
#   /opt/se2026/deploy/scripts/deploy.sh --no-cache      # 依赖变更后强制重建
#   APP_DIR=/opt/se2026 WAIT_SECONDS=300 ./deploy.sh     # 自定义等待时长
#
# 退出码：0 成功；1 配置/构建/健康检查失败（失败时会打印最近日志）
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/se2026}"
DEPLOY_DIR="$APP_DIR/deploy"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
HEALTH_URL="http://127.0.0.1/api/v1/health"
WAIT_SECONDS="${WAIT_SECONDS:-180}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "错误：$*"; exit 1; }

[[ -d "$DEPLOY_DIR" ]] || die "目录不存在：$DEPLOY_DIR"
cd "$DEPLOY_DIR"
[[ -f "$ENV_FILE" ]] || die "缺少 $DEPLOY_DIR/$ENV_FILE（首次部署请 cp .env.prod.example .env.prod 并填写）"

command -v docker >/dev/null 2>&1 || die "未安装 docker"
docker compose version >/dev/null 2>&1 || die "未安装 docker compose 插件"

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

log "开始部署：$APP_DIR"
"${DC[@]}" config --quiet || die "compose 配置校验失败"

# 记录部署前的镜像 ID，便于回滚时对照
log "当前镜像："
"${DC[@]}" images 2>/dev/null | sed 's/^/    /' || true

log "构建镜像（backend / web）"
"${DC[@]}" build "$@" backend web

log "启动服务"
"${DC[@]}" up -d

log "等待健康检查（最多 ${WAIT_SECONDS}s）：$HEALTH_URL"
deadline=$((SECONDS + WAIT_SECONDS))
while (( SECONDS < deadline )); do
  if curl -sf -o /dev/null --max-time 3 "$HEALTH_URL"; then
    log "部署成功，服务已就绪"
    "${DC[@]}" ps
    exit 0
  fi
  sleep 5
done

log "健康检查超时，输出最近日志以便排查"
"${DC[@]}" ps || true
"${DC[@]}" logs --tail=50 backend web || true
exit 1
