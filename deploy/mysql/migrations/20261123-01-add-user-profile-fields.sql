# ==============================================================================
# 存量库增量迁移（线③ 卡 E-3 前置，2026-11-23）：
#   user 表新增 3 列：public_uid（对外 UID）/ bio（简介）/ profile_visibility（主页可见范围）
# ------------------------------------------------------------------------------
# 用法（部署机上，生产库为 se2026；容器方式：
#   docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" se2026 < 本文件）
# 说明：
#   - ALTER TABLE ADD COLUMN 可重复执行（列已存在时报错 1060，忽略即可，不影响其余语句）；
#   - 幂等要点：public_uid 先建列再建唯一索引，回填存量用户后再建索引，
#     避免「回填前存在多行 NULL/重复值」导致建索引失败；
#   - 与 01-schema.sql 的 user 表定义逐字一致，改口径先改 docs/02 与 init SQL，再同步本文件；
#   - 本次不新增外键，全库外键总数仍为 38（口径见 docs/02 外键约束一节）。
# ==============================================================================

# ------------------------------------------------------------------------------
# 第一节：加列
# ------------------------------------------------------------------------------
ALTER TABLE `user`
  ADD COLUMN `public_uid` VARCHAR(20) NULL COMMENT '对外展示的 UID，创建后不可变，唯一；NULL 表示尚未分配（存量用户由迁移脚本回填）';

ALTER TABLE `user`
  ADD COLUMN `bio` VARCHAR(500) NOT NULL DEFAULT '' COMMENT '个人简介';

ALTER TABLE `user`
  ADD COLUMN `profile_visibility` VARCHAR(20) NOT NULL DEFAULT 'public' COMMENT '主页可见范围：public 所有人可见 / friends 仅好友可见 / private 仅自己可见';

# ------------------------------------------------------------------------------
# 第二节：回填存量用户的 public_uid
#   规则：U + 10 位数字，取 user.id 零填充；id 唯一故必然唯一。
#   说明：uid 在应用层由服务生成（U + 随机数字段），迁移回填仅为让存量用户
#         立即拥有一个可被搜索的 UID，不影响后续逻辑（唯一索引兜底重复）。
# ------------------------------------------------------------------------------
UPDATE `user`
SET `public_uid` = CONCAT('U', LPAD(`id`, 10, '0'))
WHERE `public_uid` IS NULL;

# ------------------------------------------------------------------------------
# 第三节：建唯一索引（回填之后建，保证唯一）
# ------------------------------------------------------------------------------
ALTER TABLE `user`
  ADD UNIQUE KEY `uk_user_public_uid` (`public_uid`);

# ------------------------------------------------------------------------------
# 第四节：校验（逐条执行，期望值见注释）
# ------------------------------------------------------------------------------
# SELECT COUNT(*) FROM information_schema.columns
#   WHERE table_schema = DATABASE() AND table_name = 'user'
#     AND column_name IN ('public_uid','bio','profile_visibility');          -- 期望 3
# SELECT COUNT(*) FROM `user` WHERE `public_uid` IS NULL;                    -- 期望 0（存量已回填）
# SELECT COUNT(*) FROM information_schema.statistics
#   WHERE table_schema = DATABASE() AND table_name = 'user'
#     AND index_name = 'uk_user_public_uid';                                 -- 期望 1
# SELECT COUNT(*) FROM information_schema.referential_constraints
#   WHERE constraint_schema = DATABASE();                                    -- 期望 38（本次未加外键）
