# ==============================================================================
# 存量库增量迁移（卡 G-0，2026-11-20）：
#   新增社区与通知 6 张表 + conversation.type 值域注释扩展（新增 meeting）
# ------------------------------------------------------------------------------
# 用法（部署机上，生产库为 se2026；容器方式：
#   docker compose exec -T mysql mysql -uroot -p"$MYSQL_ROOT_PASSWORD" se2026 < 本文件）
# 说明：
#   - CREATE TABLE IF NOT EXISTS / INSERT IGNORE / ALTER MODIFY 均可重复执行；
#   - 新表结构、索引、外键与 01-schema.sql 第六节逐字一致，改口径先改 docs/02 与 init SQL，
#     再同步本文件；
#   - conversation.type 仅改列注释（值域新增 meeting，供 F-1 会议讨论区使用），不动数据行；
#     若线上该列定义与本脚本的 MODIFY 陈述不一致，先 SHOW COLUMNS 核对再套用；
#   - 新增外键 10 个，全库外键总数 28 → 38（口径见 docs/02 外键约束一节）。
# ==============================================================================

# 第一节：DDL（6 张表，与 01-schema.sql 第六节一致）
CREATE TABLE IF NOT EXISTS `community_tag` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name`       VARCHAR(50)     NOT NULL                COMMENT '标签名，如「互联网+」「软件工程」',
  `category`   VARCHAR(20)     NOT NULL                COMMENT '大类：competition 竞赛 / course 课程',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_community_tag` (`name`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组队广场标签字典';

CREATE TABLE IF NOT EXISTS `community_post` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`         BIGINT UNSIGNED NOT NULL                COMMENT '发帖人 user.id',
  `title`           VARCHAR(50)     NOT NULL                COMMENT '招募标题',
  `content`         TEXT            NULL                    COMMENT '项目情况说明',
  `recruit_total`   TINYINT UNSIGNED NOT NULL DEFAULT 1     COMMENT '招募人数上限（1-10）',
  `recruited_count` TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '已招人数（每审批通过一人 +1）',
  `status`          VARCHAR(20)     NOT NULL DEFAULT 'recruiting' COMMENT '状态：recruiting 招募中 / full 已满员 / closed 已停止',
  `team_id`         BIGINT UNSIGNED NULL                    COMMENT '审批通过后绑定的课题组 team.id，未绑定为空',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`         TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_community_post_user` (`user_id`),
  KEY `idx_community_post_status` (`status`, `id`),
  KEY `community_post_team_id_fkey` (`team_id`),
  CONSTRAINT `community_post_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `community_post_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组队招募帖（平台第一个跨组公开内容）';

CREATE TABLE IF NOT EXISTS `community_post_tag` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `post_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'community_post.id',
  `tag_id`     BIGINT UNSIGNED NOT NULL                COMMENT 'community_tag.id',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_community_post_tag` (`post_id`, `tag_id`),
  CONSTRAINT `community_post_tag_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `community_post_tag_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `community_tag` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='帖子-标签关联（照 literature_tag 模式，无 updated_at）';

CREATE TABLE IF NOT EXISTS `team_application` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `post_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'community_post.id',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT '申请人 user.id',
  `note`       VARCHAR(200)    NOT NULL DEFAULT ''     COMMENT '申请说明',
  `status`     VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending 待处理 / approved 已通过 / rejected 已拒绝（不可逆；被拒后不可再申请同帖）',
  `handled_by` BIGINT UNSIGNED NULL                    COMMENT '处理人 user.id（发帖人）',
  `handled_at` DATETIME        NULL                    COMMENT '处理时间',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_application` (`post_id`, `user_id`),
  KEY `idx_team_application_user` (`user_id`),
  KEY `team_application_handled_by_fkey` (`handled_by`),
  CONSTRAINT `team_application_post_id_fkey` FOREIGN KEY (`post_id`) REFERENCES `community_post` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `team_application_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `team_application_handled_by_fkey` FOREIGN KEY (`handled_by`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组队申请';

CREATE TABLE IF NOT EXISTS `friendship` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `requester_id` BIGINT UNSIGNED NOT NULL                COMMENT '发起方 user.id',
  `addressee_id` BIGINT UNSIGNED NOT NULL                COMMENT '接收方 user.id',
  `status`       VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending 待同意 / accepted 已互为好友 / rejected 已拒绝（可再次发起：复用本行改回 pending）',
  `handled_at`   DATETIME        NULL                    COMMENT '处理时间',
  `created_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`      TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_friendship` (`requester_id`, `addressee_id`),
  KEY `idx_friendship_addressee` (`addressee_id`),
  CONSTRAINT `friendship_requester_id_fkey` FOREIGN KEY (`requester_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `friendship_addressee_id_fkey` FOREIGN KEY (`addressee_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='好友关系（单向行表示一条关系）';

CREATE TABLE IF NOT EXISTS `notification` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT '接收人 user.id',
  `type`       VARCHAR(30)     NOT NULL                COMMENT '类型：team_apply / team_apply_approved / team_apply_rejected / friend_request / friend_accepted / meeting_upcoming（F-2 占位）',
  `title`      VARCHAR(200)    NOT NULL                COMMENT '通知标题',
  `ref_type`   VARCHAR(30)     NULL                    COMMENT '跳转来源对象类型（community_post / friendship / meeting / conversation），多态引用不建外键',
  `ref_id`     BIGINT UNSIGNED NULL                    COMMENT '跳转来源对象主键',
  `is_read`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '已读：0 未读，1 已读',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_notification_user_read` (`user_id`, `is_read`),
  KEY `idx_notification_dedupe` (`user_id`, `type`, `ref_id`),
  CONSTRAINT `notification_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内通知（G-1 push 接口唯一写入口）';

# 第二节：conversation.type 列注释扩展（值域新增 meeting，仅注释，不动数据）
ALTER TABLE `conversation`
  MODIFY COLUMN `type` VARCHAR(20) NOT NULL
  COMMENT '类型：comment（上下文评论）/ group（项目讨论区）/ private（私信）/ meeting（会议讨论区，ref 指向 meeting）';

# 第三节：标签字典种子（与 01-schema.sql 第六节预置清单同步维护）
INSERT IGNORE INTO `community_tag` (`name`, `category`) VALUES
  ('互联网+',  'competition'),
  ('挑战杯',   'competition'),
  ('数学建模', 'competition'),
  ('大创项目', 'competition'),
  ('蓝桥杯',   'competition'),
  ('软件工程', 'course'),
  ('毕业设计', 'course'),
  ('课程设计', 'course');

# 第四节：校验（逐条执行，期望值见注释）
# SELECT COUNT(*) FROM information_schema.tables
#   WHERE table_schema = DATABASE()
#     AND table_name IN ('community_tag','community_post','community_post_tag',
#                        'team_application','friendship','notification');          -- 期望 6
# SELECT COUNT(*) FROM information_schema.referential_constraints
#   WHERE constraint_schema = DATABASE();                                          -- 期望 38
# SELECT COUNT(*) FROM community_tag WHERE deleted = 0;                            -- 期望 8（种子）
