#!/usr/bin/env bash
# ==============================================================================
# MySQL 逻辑备份（在服务器上由 cron 每日调用）
# ------------------------------------------------------------------------------
# 特性：
#   - --single-transaction：InnoDB 一致性快照，不锁表，业务可继续读写
#   - gzip 压缩 + 完整性校验 + 最小体积校验（防止 mysqldump 静默失败留下空文件）
#   - 自动清理超过 KEEP_DAYS 天的旧备份
#
# 用法：
#   /opt/se2026/deploy/scripts/backup-mysql.sh
#   BACKUP_DIR=/data/backup KEEP_DAYS=14 ./backup-mysql.sh
#
# 建议 crontab（每日 03:30）：
#   30 3 * * * /opt/se2026/deploy/scripts/backup-mysql.sh >> /opt/se2026/backups/backup.log 2>&1
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/se2026}"
ENV_FILE="$APP_DIR/deploy/.env.prod"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups/mysql}"
KEEP_DAYS="${KEEP_DAYS:-7}"
CONTAINER="${CONTAINER:-se2026-mysql}"
MIN_BYTES="${MIN_BYTES:-1024}"

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die() { log "错误：$*"; exit 1; }

[[ -f "$ENV_FILE" ]] || die "缺少 $ENV_FILE"
get_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }

ROOT_PW="$(get_env MYSQL_ROOT_PASSWORD)"
DB_NAME="$(get_env MYSQL_DATABASE)"
DB_NAME="${DB_NAME:-se2026}"
[[ -n "$ROOT_PW" ]] || die "未能从 $ENV_FILE 读取 MYSQL_ROOT_PASSWORD"

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || die "容器 $CONTAINER 未运行，跳过本次备份"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date '+%Y%m%d-%H%M%S')"
OUT="$BACKUP_DIR/${DB_NAME}-${STAMP}.sql.gz"

log "开始备份数据库 $DB_NAME → $OUT"
# 注意：管道两端失败都要能被 set -o pipefail 捕获
docker exec -e MYSQL_PWD="$ROOT_PW" "$CONTAINER" \
  mysqldump \
  --single-transaction --quick --routines --triggers --events \
  --default-character-set=utf8mb4 \
  --databases "$DB_NAME" | gzip -6 > "$OUT"

SIZE="$(stat -c%s "$OUT")"
if (( SIZE < MIN_BYTES )); then
  rm -f "$OUT"
  die "备份文件异常（仅 ${SIZE} 字节），已删除"
fi

gzip -t "$OUT" 2>/dev/null || { rm -f "$OUT"; die "gzip 完整性校验失败，已删除"; }

DELETED="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -type f -mtime +"$KEEP_DAYS" -print -delete | wc -l)"
TOTAL="$(find "$BACKUP_DIR" -maxdepth 1 -name '*.sql.gz' -type f | wc -l)"

log "备份完成：$OUT（$(numfmt --to=iec "$SIZE")）"
log "清理过期备份 ${DELETED} 个（保留 ${KEEP_DAYS} 天），当前共 ${TOTAL} 份"
