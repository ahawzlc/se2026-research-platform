# ==============================================================================
# 校园科研项目协作与成果管理平台 —— 数据库初始化脚本
# ------------------------------------------------------------------------------
# 说明：
#   1. 本脚本由 MySQL 官方镜像在容器首次启动时自动执行
#      （挂载于 /docker-entrypoint-initdb.d/）；
#   2. 仅在数据卷为空时执行，重建库请先 `docker compose down -v`；
#   3. 未使用外键约束：逻辑删除与级联删除策略在应用层控制，避免容器化迁移
#      与逻辑删除互相打架；表间关系以 docs/02-数据字典.md 为准；
#   4. 口径以 docs/02-数据字典.md 为唯一来源，改表请先改文档。
# ==============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `se2026`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `se2026`;

-- ==============================================================================
-- 一、账号类
-- ==============================================================================

DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `username`      VARCHAR(50)     NOT NULL                COMMENT '登录名，唯一',
  `password_hash` VARCHAR(100)    NOT NULL                COMMENT '密码哈希（BCrypt），禁止明文',
  `nickname`      VARCHAR(50)     NOT NULL DEFAULT ''     COMMENT '昵称',
  `avatar`        VARCHAR(255)    NOT NULL DEFAULT ''     COMMENT '头像地址',
  `email`         VARCHAR(100)    NOT NULL DEFAULT ''     COMMENT '邮箱',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`       TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_username` (`username`),
  KEY `idx_user_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户';

DROP TABLE IF EXISTS `team`;
CREATE TABLE `team` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name`        VARCHAR(100)    NOT NULL                COMMENT '课题组名称',
  `description` VARCHAR(500)    NOT NULL DEFAULT ''     COMMENT '课题组简介',
  `invite_code` VARCHAR(16)     NOT NULL                COMMENT '邀请码，入组凭据，唯一',
  `owner_id`    BIGINT UNSIGNED NOT NULL                COMMENT '创建者（课题负责人）user.id',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_invite_code` (`invite_code`),
  KEY `idx_team_owner` (`owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='课题组';

DROP TABLE IF EXISTS `team_member`;
CREATE TABLE `team_member` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `team_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'team.id',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `role`       VARCHAR(20)     NOT NULL DEFAULT 'member' COMMENT '角色：owner / admin / member',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_team_member` (`team_id`, `user_id`),
  KEY `idx_team_member_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='课题组成员';

-- ==============================================================================
-- 二、支撑类（补充表：literature / achievement 的 file_id 需要有落点）
-- ==============================================================================

DROP TABLE IF EXISTS `file`;
CREATE TABLE `file` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `uploader_id`   BIGINT UNSIGNED NOT NULL                COMMENT '上传人 user.id',
  `original_name` VARCHAR(255)    NOT NULL                COMMENT '原始文件名',
  `stored_path`   VARCHAR(500)    NOT NULL                COMMENT '存储路径（本地相对路径或对象存储 key）',
  `url`           VARCHAR(500)    NULL                    COMMENT '可访问地址',
  `size`          BIGINT UNSIGNED NOT NULL DEFAULT 0      COMMENT '字节数',
  `mime_type`     VARCHAR(100)    NULL                    COMMENT 'MIME 类型',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  `deleted`       TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_file_uploader` (`uploader_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='上传文件（补充表）';

-- ==============================================================================
-- 三、业务类
-- ==============================================================================

DROP TABLE IF EXISTS `project`;
CREATE TABLE `project` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `team_id`     BIGINT UNSIGNED NOT NULL                COMMENT '所属课题组 team.id',
  `name`        VARCHAR(100)    NOT NULL                COMMENT '项目名称',
  `description` VARCHAR(500)    NOT NULL DEFAULT ''     COMMENT '项目简介',
  `status`      VARCHAR(20)     NOT NULL DEFAULT 'planning' COMMENT '状态：planning / active / finished / archived',
  `start_date`  DATE            NULL                    COMMENT '开始日期',
  `end_date`    DATE            NULL                    COMMENT '结束日期',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_project_team` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目';

DROP TABLE IF EXISTS `project_member`;
CREATE TABLE `project_member` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `project_id` BIGINT UNSIGNED NOT NULL                COMMENT 'project.id',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_project_member` (`project_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='项目成员';

DROP TABLE IF EXISTS `milestone`;
CREATE TABLE `milestone` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `project_id` BIGINT UNSIGNED NOT NULL                COMMENT 'project.id',
  `name`       VARCHAR(100)    NOT NULL                COMMENT '里程碑名称',
  `due_date`   DATE            NULL                    COMMENT '截止日期',
  `status`     VARCHAR(20)     NOT NULL DEFAULT 'pending' COMMENT '状态：pending / done',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_milestone_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='里程碑';

DROP TABLE IF EXISTS `task`;
CREATE TABLE `task` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `project_id`  BIGINT UNSIGNED NOT NULL                COMMENT 'project.id',
  `title`       VARCHAR(200)    NOT NULL                COMMENT '任务标题',
  `description` TEXT            NULL                    COMMENT '任务描述',
  `assignee_id` BIGINT UNSIGNED NULL                    COMMENT '负责人 user.id，可为空（待认领）',
  `status`      VARCHAR(20)     NOT NULL DEFAULT 'todo' COMMENT '状态：todo / doing / done（看板三列）',
  `priority`    VARCHAR(10)     NOT NULL DEFAULT 'medium' COMMENT '优先级：low / medium / high',
  `due_date`    DATE            NULL                    COMMENT '截止日期',
  `sort_order`  INT             NOT NULL DEFAULT 0      COMMENT '看板列内排序值，拖拽换列时重排',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_task_project_status` (`project_id`, `status`, `sort_order`),
  KEY `idx_task_assignee` (`assignee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务';

DROP TABLE IF EXISTS `literature`;
CREATE TABLE `literature` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `team_id`     BIGINT UNSIGNED NOT NULL                COMMENT '所属课题组 team.id',
  `project_id`  BIGINT UNSIGNED NULL                    COMMENT '可挂在具体项目下 project.id',
  `title`       VARCHAR(300)    NOT NULL                COMMENT '文献标题',
  `source_url`  VARCHAR(500)    NULL                    COMMENT '外链地址（与附件二选一）',
  `file_id`     BIGINT UNSIGNED NULL                    COMMENT '附件 file.id',
  `read_status` VARCHAR(20)     NOT NULL DEFAULT 'unread' COMMENT '阅读状态：unread / reading / read',
  `uploader_id` BIGINT UNSIGNED NOT NULL                COMMENT '上传人 user.id',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_literature_team` (`team_id`),
  KEY `idx_literature_uploader` (`uploader_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文献';

DROP TABLE IF EXISTS `literature_tag`;
CREATE TABLE `literature_tag` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `literature_id` BIGINT UNSIGNED NOT NULL                COMMENT 'literature.id',
  `tag`           VARCHAR(50)     NOT NULL                COMMENT '标签文本',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`       TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_literature_tag` (`literature_id`, `tag`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文献标签';

DROP TABLE IF EXISTS `meeting`;
CREATE TABLE `meeting` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `project_id` BIGINT UNSIGNED NOT NULL                COMMENT 'project.id',
  `title`      VARCHAR(200)    NOT NULL                COMMENT '会议主题',
  `held_at`    DATETIME        NULL                    COMMENT '召开时间',
  `location`   VARCHAR(200)    NULL                    COMMENT '地点或线上会议链接',
  `content`    LONGTEXT        NULL                    COMMENT '会议记录正文',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_meeting_project` (`project_id`, `held_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会议记录';

DROP TABLE IF EXISTS `meeting_attendee`;
CREATE TABLE `meeting_attendee` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `meeting_id` BIGINT UNSIGNED NOT NULL                COMMENT 'meeting.id',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meeting_attendee` (`meeting_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='参会人';

DROP TABLE IF EXISTS `achievement`;
CREATE TABLE `achievement` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `project_id`  BIGINT UNSIGNED NOT NULL                COMMENT 'project.id',
  `type`        VARCHAR(30)     NOT NULL                COMMENT '类型：paper / patent / software / award / other',
  `title`       VARCHAR(300)    NOT NULL                COMMENT '成果名称',
  `description` TEXT            NULL                    COMMENT '成果说明',
  `file_id`     BIGINT UNSIGNED NULL                    COMMENT '附件 file.id',
  `created_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`     TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_achievement_project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成果';

DROP TABLE IF EXISTS `achievement_member`;
CREATE TABLE `achievement_member` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `achievement_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'achievement.id',
  `user_id`           BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `contribution_note` VARCHAR(255)    NULL                    COMMENT '本人贡献说明（自述，不参与评分）',
  `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`           TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_achievement_member` (`achievement_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成果成员关联';

-- ==============================================================================
-- 四、沟通类（统一会话模型：评论 / 讨论区 / 私信共用）
-- ==============================================================================

DROP TABLE IF EXISTS `conversation`;
CREATE TABLE `conversation` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `type`       VARCHAR(20)     NOT NULL                COMMENT '类型：comment（上下文评论）/ group（项目讨论区）/ private（私信）',
  `ref_type`   VARCHAR(30)     NULL                    COMMENT '业务对象类型（task / achievement / meeting / project），私信为空',
  `ref_id`     BIGINT UNSIGNED NULL                    COMMENT '业务对象主键，私信为空',
  `title`      VARCHAR(200)    NULL                    COMMENT '会话标题（群组用）',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_conversation_ref` (`ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话';

DROP TABLE IF EXISTS `conversation_member`;
CREATE TABLE `conversation_member` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `conversation_id` BIGINT UNSIGNED NOT NULL                COMMENT 'conversation.id',
  `user_id`         BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `last_read_at`    DATETIME        NULL                    COMMENT '最后已读时间，未读数计算的唯一依据',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`         TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_conversation_member` (`conversation_id`, `user_id`),
  KEY `idx_cm_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话成员与已读位点';

DROP TABLE IF EXISTS `message`;
CREATE TABLE `message` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `conversation_id` BIGINT UNSIGNED NOT NULL                COMMENT 'conversation.id',
  `sender_id`       BIGINT UNSIGNED NOT NULL                COMMENT '发送人 user.id',
  `content`         TEXT            NULL                    COMMENT '消息正文',
  `msg_type`        VARCHAR(20)     NOT NULL DEFAULT 'text' COMMENT '消息类型：text / file / system',
  `ref_type`        VARCHAR(30)     NULL                    COMMENT '消息级引用的对象类型',
  `ref_id`          BIGINT UNSIGNED NULL                    COMMENT '消息级引用的对象主键',
  `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`         TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  KEY `idx_message_conversation` (`conversation_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='消息';

-- ==============================================================================
-- 五、统计类（贡献度分析的唯一数据来源，只增不改）
-- ==============================================================================

DROP TABLE IF EXISTS `activity_log`;
CREATE TABLE `activity_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT '行为人 user.id',
  `team_id`    BIGINT UNSIGNED NOT NULL                COMMENT '归属课题组 team.id（统计以团队为单位）',
  `type`       VARCHAR(40)     NOT NULL                COMMENT '行为类型：task_create / task_done / comment_create / literature_upload / literature_read / meeting_create / meeting_attend / achievement_submit / milestone_done',
  `ref_type`   VARCHAR(30)     NULL                    COMMENT '关联对象类型',
  `ref_id`     BIGINT UNSIGNED NULL                    COMMENT '关联对象主键，用于同一对象重复行为去重',
  `weight`     DECIMAL(5,2)    NOT NULL DEFAULT 1.00   COMMENT '该行为的基础权重，口径见 docs/03',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发生时间',
  PRIMARY KEY (`id`),
  KEY `idx_log_team_user_time` (`team_id`, `user_id`, `created_at`),
  KEY `idx_log_team_type` (`team_id`, `type`),
  KEY `idx_log_user_time` (`user_id`, `created_at`),
  KEY `idx_log_ref` (`type`, `ref_type`, `ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='行为埋点流水（只增不改）';

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- 完成。共 18 张表：
--   账号 3 + 支撑 1 + 业务 10 + 沟通 3 + 统计 1
-- ==============================================================================
