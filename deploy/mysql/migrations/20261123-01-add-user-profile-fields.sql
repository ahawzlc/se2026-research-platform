# ==============================================================================
# 存量库增量迁移（线③ 卡 E-3 前置，2026-11-23；2026-11-24 按评审意见修订）：
#   user 表新增 3 列：public_uid（对外 UID）/ bio（简介）/ profile_visibility（主页可见范围）
# ------------------------------------------------------------------------------
# 用法（部署机上，生产库为 se2026；容器方式：
#   docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" se2026 < 本文件）
#
# 重复执行的正确姿势（评审意见 B2①）：
#   本文件里的 ADD COLUMN / ADD UNIQUE KEY **不是**幂等的——
#   不带 `-f` 重跑会在第一条 ADD COLUMN 就报 1060 并中止，
#   后面几条语句根本不会执行。
#   带 `-f`（--force）重跑才是「报 4 个预期错误、无副作用」：
#   3 条 ADD COLUMN 报 1060（列已存在）、1 条 ADD UNIQUE KEY 报 1061（索引已存在），
#   其余语句继续执行完毕。
#
# 列顺序（评审意见 B2②）：
#   ADD COLUMN 必须带 `AFTER <列名>`，否则新列排在表尾，
#   与全新安装（01-schema.sql）的列顺序不一致。
#   schema-verify 的目标是「升级终态与全新安装同构」，故这里对齐 init SQL 的顺序：
#     email → public_uid → bio → profile_visibility → created_at
#
# public_uid 回填（评审意见 C2①）：
#   **本脚本不回填存量用户的 public_uid。**
#   早期版本用 CONCAT('U', LPAD(id,10,'0')) 回填，那等于让全部存量用户的
#   UID 就等于自己的自增 id（id=12345 → U0000012345），照样可以枚举，
#   与「引入 UID 就是为了不被枚举」的理由自相矛盾。
#   改为：存量用户在**首次访问 GET /api/v1/users/me 时由应用层随机分配**
#   （见 backend/src/users/users.service.ts 的 ensurePublicUid），
#   分配时撞唯一索引就重试。
#   这样也顺带解决了「迁移执行完、部署还没上线期间注册的用户没有 UID」的问题。
#   注意：**不要**在 SQL 里用 RAND() 回填——随机值可能撞号，
#   而 ADD UNIQUE KEY 会因重复值失败，导致整个迁移回滚。
#
# 与 01-schema.sql 的 user 表定义逐字一致，改口径先改 docs/02 与 init SQL，再同步本文件；
# 本次不新增外键，全库外键总数仍为 38（口径见 docs/02 外键约束一节）。
# ==============================================================================

# ------------------------------------------------------------------------------
# 第一节：加列（带 AFTER，保证列顺序与全新安装一致）
# ------------------------------------------------------------------------------
ALTER TABLE `user`
  ADD COLUMN `public_uid` VARCHAR(20) NULL COMMENT '对外展示的 UID，创建后不可变，唯一；NULL 表示尚未分配（存量用户首次访问 /users/me 时由应用层随机分配）' AFTER `email`;

ALTER TABLE `user`
  ADD COLUMN `bio` VARCHAR(500) NOT NULL DEFAULT '' COMMENT '个人简介' AFTER `public_uid`;

ALTER TABLE `user`
  ADD COLUMN `profile_visibility` VARCHAR(20) NOT NULL DEFAULT 'public' COMMENT '主页可见范围：public 所有人可见 / friends 仅好友可见 / private 仅自己可见' AFTER `bio`;

# ------------------------------------------------------------------------------
# 第二节：建唯一索引
#   存量行的 public_uid 全是 NULL，MySQL 唯一索引允许多行 NULL，
#   所以这里可以安全建索引，不需要先回填。
#   应用层回填时若撞号会重试，不会撞这个唯一索引。
# ------------------------------------------------------------------------------
ALTER TABLE `user`
  ADD UNIQUE KEY `uk_user_public_uid` (`public_uid`);

# ------------------------------------------------------------------------------
# 第三节：校验（逐条执行，期望值见注释）
# ------------------------------------------------------------------------------
# SELECT COUNT(*) FROM information_schema.columns
#   WHERE table_schema = DATABASE() AND table_name = 'user'
#     AND column_name IN ('public_uid','bio','profile_visibility');          -- 期望 3
# SELECT COUNT(*) FROM `user` WHERE `public_uid` IS NULL;                    -- 期望 = 存量用户数（待应用层懒分配）
# SELECT COUNT(*) FROM information_schema.statistics
#   WHERE table_schema = DATABASE() AND table_name = 'user'
#     AND index_name = 'uk_user_public_uid';                                 -- 期望 1
# SELECT COUNT(*) FROM information_schema.referential_constraints
#   WHERE constraint_schema = DATABASE();                                    -- 期望 38（本次未加外键）
