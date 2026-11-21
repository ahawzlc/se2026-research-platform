# ==============================================================================
# 校园科研项目协作与成果管理平台 —— 数据库初始化脚本
# ------------------------------------------------------------------------------
# 说明：
#   1. 本脚本由 MySQL 官方镜像在容器首次启动时自动执行
#      （挂载于 /docker-entrypoint-initdb.d/）；
#   2. 仅在数据卷为空时执行，重建库请先 `docker compose down -v`；
#   3. 外键约束与 backend/prisma/schema.prisma 严格对齐（约束名
#      `<表>_<列>_fkey`、ON DELETE RESTRICT / 可空列 SET NULL / ON UPDATE CASCADE）。
#      逻辑删除仍在应用层控制，外键只兜底「物理孤儿行」；
#      多态引用列（conversation.ref_id / activity_log.ref_id / message.ref_id）
#      无法建外键，指向哪张表由应用层 ref_type 决定；
#   4. 已有数据库升级不用重跑本脚本，用 migrations/ 下的增量脚本；
#   5. 口径以 docs/02-数据字典.md 为唯一来源，改表请先改文档。
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
  KEY `idx_team_owner` (`owner_id`),
  CONSTRAINT `team_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_team_member_user` (`user_id`),
  CONSTRAINT `team_member_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `team_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_file_uploader` (`uploader_id`),
  CONSTRAINT `file_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_project_team` (`team_id`),
  CONSTRAINT `project_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  UNIQUE KEY `uk_project_member` (`project_id`, `user_id`),
  KEY `project_member_user_id_fkey` (`user_id`),
  CONSTRAINT `project_member_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `project_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_milestone_project` (`project_id`),
  CONSTRAINT `milestone_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_task_assignee` (`assignee_id`),
  CONSTRAINT `task_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `task_assignee_id_fkey` FOREIGN KEY (`assignee_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
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
  KEY `idx_literature_uploader` (`uploader_id`),
  KEY `literature_project_id_fkey` (`project_id`),
  KEY `literature_file_id_fkey` (`file_id`),
  CONSTRAINT `literature_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `literature_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `literature_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `literature_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `file` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文献';

DROP TABLE IF EXISTS `literature_tag`;
CREATE TABLE `literature_tag` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `literature_id` BIGINT UNSIGNED NOT NULL                COMMENT 'literature.id',
  `tag`           VARCHAR(50)     NOT NULL                COMMENT '标签文本',
  `created_at`    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`       TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_literature_tag` (`literature_id`, `tag`),
  CONSTRAINT `literature_tag_literature_id_fkey` FOREIGN KEY (`literature_id`) REFERENCES `literature` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_meeting_project` (`project_id`, `held_at`),
  CONSTRAINT `meeting_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会议记录';

DROP TABLE IF EXISTS `meeting_attendee`;
CREATE TABLE `meeting_attendee` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `meeting_id` BIGINT UNSIGNED NOT NULL                COMMENT 'meeting.id',
  `user_id`    BIGINT UNSIGNED NOT NULL                COMMENT 'user.id',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meeting_attendee` (`meeting_id`, `user_id`),
  KEY `meeting_attendee_user_id_fkey` (`user_id`),
  CONSTRAINT `meeting_attendee_meeting_id_fkey` FOREIGN KEY (`meeting_id`) REFERENCES `meeting` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `meeting_attendee_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_achievement_project` (`project_id`),
  KEY `achievement_file_id_fkey` (`file_id`),
  CONSTRAINT `achievement_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `achievement_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `file` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
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
  UNIQUE KEY `uk_achievement_member` (`achievement_id`, `user_id`),
  KEY `achievement_member_user_id_fkey` (`user_id`),
  CONSTRAINT `achievement_member_achievement_id_fkey` FOREIGN KEY (`achievement_id`) REFERENCES `achievement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `achievement_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成果成员关联';

-- ==============================================================================
-- 四、沟通类（统一会话模型：评论 / 讨论区 / 私信共用）
-- ==============================================================================

DROP TABLE IF EXISTS `conversation`;
CREATE TABLE `conversation` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `type`       VARCHAR(20)     NOT NULL                COMMENT '类型：comment（上下文评论）/ group（项目讨论区）/ private（私信）/ meeting（会议讨论区，ref 指向 meeting）',
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
  KEY `idx_cm_user` (`user_id`),
  CONSTRAINT `conversation_member_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `conversation_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_message_conversation` (`conversation_id`, `id`),
  KEY `message_sender_id_fkey` (`sender_id`),
  CONSTRAINT `message_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `message_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
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
  KEY `idx_log_ref` (`type`, `ref_type`, `ref_id`),
  CONSTRAINT `activity_log_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `activity_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='行为埋点流水（只增不改）';

-- ==============================================================================
-- 六、社区与通知类（2026-11-20，卡 G-0；存量库用 migrations/20261120-01 增量升级）
-- ==============================================================================

DROP TABLE IF EXISTS `community_tag`;
CREATE TABLE `community_tag` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `name`       VARCHAR(50)     NOT NULL                COMMENT '标签名，如「互联网+」「软件工程」',
  `category`   VARCHAR(20)     NOT NULL                COMMENT '大类：competition 竞赛 / course 课程',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted`    TINYINT UNSIGNED NOT NULL DEFAULT 0     COMMENT '逻辑删除：0 正常，1 已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_community_tag` (`name`, `category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组队广场标签字典';

DROP TABLE IF EXISTS `community_post`;
CREATE TABLE `community_post` (
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

DROP TABLE IF EXISTS `community_post_tag`;
CREATE TABLE `community_post_tag` (
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

DROP TABLE IF EXISTS `team_application`;
CREATE TABLE `team_application` (
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

DROP TABLE IF EXISTS `friendship`;
CREATE TABLE `friendship` (
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

DROP TABLE IF EXISTS `notification`;
CREATE TABLE `notification` (
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

-- ---- 标签字典预置（docs/12 决策点 1 草案版；与 migrations/20261120-01 内清单同步维护）----
INSERT INTO `community_tag` (`name`, `category`) VALUES
  ('互联网+',  'competition'),
  ('挑战杯',   'competition'),
  ('数学建模', 'competition'),
  ('大创项目', 'competition'),
  ('蓝桥杯',   'competition'),
  ('软件工程', 'course'),
  ('毕业设计', 'course'),
  ('课程设计', 'course');

SET FOREIGN_KEY_CHECKS = 1;

-- ==============================================================================
-- 完成。共 24 张表：
--   账号 3 + 支撑 1 + 业务 10 + 沟通 3 + 统计 1 + 社区与通知 6
-- ==============================================================================
