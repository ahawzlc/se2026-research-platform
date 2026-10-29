#!/usr/bin/env bash
# ==============================================================================
# MySQL 恢复脚本（在服务器上手工执行，不在 cron 中）
# ------------------------------------------------------------------------------
# 恢复会覆盖现有表数据，因此：
#   1. 必须显式加 --yes 才会执行；
#   2. 执行前会先给"当前状态"做一次备份，误操作也留了后悔药。
#
# 用法：
#   /opt/se2026/deploy/scripts/restore-mysql.sh /opt/se2026/backups/mysql/se2026-20261030-033000.sql.gz
#        ↑ 只做演练：解压并校验，不写入数据库
#   /opt/se2026/deploy/scripts/restore-mysql.sh <上面那个文件> --yes
#        ↑ 真正恢复
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/se2026}"
ENV_FILE="$APP_DIR/deploy/.env.prod"
CONTAINER="${CONTAINER:-se2026-mysql}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "错误：$*"; exit 1; }

FILE="${1:-}"
CONFIRM="${2:-}"

[[ -n "$FILE" ]] || die "用法：$0 <备份文件.sql.gz> [--yes]"
[[ -f "$FILE" ]] || die "备份文件不存在：$FILE"
[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE"

gzip -t "$FILE" 2>/dev/null || die "备份文件损坏：$FILE"

TABLES="$(gunzip -c "$FILE" | grep -c '^CREATE TABLE' || true)"
log "备份文件包含 ${TABLES} 条建表语句"

if [[ "$CONFIRM" != "--yes" ]]; then
  log "当前为演练模式：文件完整、可解压。"
  log "确认要覆盖数据库时，追加 --yes 重新执行本脚本。"
  exit 0
fi

ROOT_PW="$(grep -E '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
[[ -n "$ROOT_PW" ]] || die "未能从 $ENV_FILE 读取 MYSQL_ROOT_PASSWORD"

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "容器 $CONTAINER 未运行"

log "恢复前先备份当前数据（防止误操作）"
"$APP_DIR/deploy/scripts/backup-mysql.sh" || die "恢复前备份失败，已中止"

log "开始恢复：$FILE"
gunzip -c "$FILE" | docker exec -i -e MYSQL_PWD="$ROOT_PW" "$CONTAINER" mysql -uroot \
  || die "恢复失败，请检查上方 mysql 报错"

COUNT="$(docker exec -e MYSQL_PWD="$ROOT_PW" "$CONTAINER" mysql -uroot -N -B \
  -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();" 2>/dev/null || echo '?')"
log "恢复完成，当前库表数：$COUNT"
