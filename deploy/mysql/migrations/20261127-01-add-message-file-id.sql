# ==============================================================================
# 存量库增量迁移（线③ 收尾，2026-11-27）：message 表新增 file_id 列
# ------------------------------------------------------------------------------
# 用途：给「文件消息」（msg_type = file）一个附件落点。
#   背景：message.msg_type 的枚举里一直有 'file'，docs/02 也写了
#   「msg_type = file 时 content 存文件标识说明」，但全仓从来没有实现——
#   message 表没有 file_id 列，SendMessageDto 也没有附件入口。
#   本次补齐：message.file_id 外键指向 file.id，与 literature.file_id /
#   achievement.file_id 同一套写法（可空、ON DELETE SET NULL、逻辑删除）。
#
# 用法（部署机上，生产库为 se2026；容器方式：
#   docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" se2026 < 本文件）
#   本文件开头已带 SET NAMES utf8mb4，不必再给客户端加 --default-character-set
#   （镜像内 mysql 客户端默认 latin1，中文列注释会按 latin1 再编码一次变成乱码）。
#
# 重复执行的正确姿势（沿用 20261123-01 的约定）：
#   本文件的 ADD COLUMN / ADD KEY / ADD CONSTRAINT **不是**幂等的——
#   不带 `-f` 重跑会在第一条就报 1060 并中止；
#   带 `-f`（--force）重跑才是「报 3 个预期错误、无副作用」
#   （1060 列已存在、1061 索引已存在、1826 外键已存在）。
#
# 列顺序：
#   ADD COLUMN 必须带 `AFTER <列名>`，否则新列排在表尾，
#   与全新安装（01-schema.sql）的列顺序不一致。
#   schema-verify 的目标是「升级终态与全新安装同构」，故这里对齐 init SQL 的顺序：
#     content → msg_type → file_id → ref_type
#
# 与全新安装同构（评审意见 A3，2026-11-27）：
#   - file_id 上只建 idx_message_file 一个索引，外键直接复用它；
#     init SQL 不再另外声明 message_file_id_fkey 索引（两个索引完全重复）。
#     init SQL 里 idx_message_file 声明在 message_sender_id_fkey **之后**，
#     与存量库「原有索引在前、本次新增在后」的创建顺序一致，SHOW CREATE TABLE 才逐字相同。
#   - init SQL 里 content 列的注释也改了，这里用 MODIFY COLUMN 同步，
#     否则升级库的注释停在旧版本（与 20261123-01 补 avatar 注释同一处理）。
#
# 外键口径：
#   ON DELETE SET NULL——附件被逻辑删除/物理删除后，消息行保留，
#   file_id 置空（前端按 msgType=file 但 fileId 为空降级为纯文本展示）。
#   与 literature / achievement 的附件外键一致。
#   本次新增 1 个外键，全库外键总数 38 → 39（口径见 docs/02 外键约束一节）。
#
# 与 01-schema.sql 的 message 表定义逐字一致，改口径先改 docs/02 与 init SQL，
# 再同步本文件。
# ==============================================================================

SET NAMES utf8mb4;

# ------------------------------------------------------------------------------
# 第一节：加列（带 AFTER，保证列顺序与全新安装一致）
# ------------------------------------------------------------------------------
ALTER TABLE `message`
  ADD COLUMN `file_id` BIGINT UNSIGNED NULL COMMENT '附件 file.id（msg_type = file 时非空）' AFTER `msg_type`;

# ------------------------------------------------------------------------------
# 第二节：同步 content 列注释（与全新安装逐字一致；幂等）
# ------------------------------------------------------------------------------
ALTER TABLE `message`
  MODIFY COLUMN `content` TEXT NULL COMMENT '消息正文（msg_type = file 时存文件标识说明）';

# ------------------------------------------------------------------------------
# 第三节：加索引与外键
#   idx_message_file：按附件反查消息（文件被删时定位引用它的消息）。
#   唯一不设——一条消息最多一个附件，外键本身已保证 file_id 指向存在的文件。
# ------------------------------------------------------------------------------
ALTER TABLE `message`
  ADD KEY `idx_message_file` (`file_id`);

ALTER TABLE `message`
  ADD CONSTRAINT `message_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `file` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

# ------------------------------------------------------------------------------
# 第四节：校验（逐条执行，期望值见注释）
# ------------------------------------------------------------------------------
# SELECT COUNT(*) FROM information_schema.columns
#   WHERE table_schema = DATABASE() AND table_name = 'message'
#     AND column_name = 'file_id';                                              -- 期望 1
# SELECT COUNT(*) FROM information_schema.statistics
#   WHERE table_schema = DATABASE() AND table_name = 'message'
#     AND index_name = 'idx_message_file';                                       -- 期望 1
# SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics
#   WHERE table_schema = DATABASE() AND table_name = 'message';                  -- 期望 4（PRIMARY / idx_message_conversation / idx_message_file / message_sender_id_fkey）
# SELECT COUNT(*) FROM information_schema.referential_constraints
#   WHERE constraint_schema = DATABASE()
#     AND constraint_name = 'message_file_id_fkey';                               -- 期望 1
# SELECT COUNT(*) FROM information_schema.referential_constraints
#   WHERE constraint_schema = DATABASE();                                        -- 期望 39（本次 +1）
#
# 列顺序（与全新安装同构）：
# SELECT GROUP_CONCAT(column_name ORDER BY ordinal_position SEPARATOR ' ')
#   FROM information_schema.columns
#   WHERE table_schema = DATABASE() AND table_name = 'message'
#     AND column_name IN ('content','msg_type','file_id','ref_type');           -- 期望 "content msg_type file_id ref_type"
