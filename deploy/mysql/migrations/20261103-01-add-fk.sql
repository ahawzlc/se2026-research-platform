# ==============================================================================
# 存量库外键对齐迁移：给 2026-11-03 之前由 01-schema.sql（无外键版）建出的库
# 补上与 backend/prisma/schema.prisma 完全一致的外键约束。
# ------------------------------------------------------------------------------
# 用法（在部署机上，库名按需替换，生产为 se2026）：
#   1. 先跑本文件第一节的孤儿行检查，任何一条查出非 0 行都必须先人工处理，
#      否则下面 ADD CONSTRAINT 会失败（这正是外键要拦的问题）；
#   2. 确认无孤儿后，从「第二节 DDL」起整段执行；
#   3. 执行第三节校验，28 个约束全部在场即对齐完成。
# 说明：
#   - 本脚本只加约束与配套索引，不改任何列定义、不动任何数据行；
#   - 多态引用列（conversation.ref_id / activity_log.ref_id / message.ref_id）
#     不建外键，指向哪张表由应用层 ref_type 决定；
#   - 一次性脚本，MySQL 8.0 的 ADD CONSTRAINT 不支持 IF NOT EXISTS，重复执行
#     会因约束已存在报错——这本身可作为「是否已迁移」的判断依据。
# ==============================================================================

# 第一节：孤儿行检查（只读，逐条执行，全部应为 0）
# SELECT COUNT(*) FROM team         WHERE owner_id  NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM team_member  WHERE team_id   NOT IN (SELECT id FROM team)
#                                   OR user_id     NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM file         WHERE uploader_id NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM project      WHERE team_id   NOT IN (SELECT id FROM team);
# SELECT COUNT(*) FROM project_member WHERE project_id NOT IN (SELECT id FROM project)
#                                   OR user_id     NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM milestone    WHERE project_id NOT IN (SELECT id FROM project);
# SELECT COUNT(*) FROM task         WHERE project_id NOT IN (SELECT id FROM project);
# SELECT COUNT(*) FROM task         WHERE assignee_id IS NOT NULL
#                                     AND assignee_id NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM literature   WHERE team_id   NOT IN (SELECT id FROM team)
#                                   OR uploader_id NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM literature   WHERE project_id IS NOT NULL
#                                     AND project_id NOT IN (SELECT id FROM project);
# SELECT COUNT(*) FROM literature   WHERE file_id IS NOT NULL
#                                     AND file_id   NOT IN (SELECT id FROM file);
# SELECT COUNT(*) FROM literature_tag WHERE literature_id NOT IN (SELECT id FROM literature);
# SELECT COUNT(*) FROM meeting      WHERE project_id NOT IN (SELECT id FROM project);
# SELECT COUNT(*) FROM meeting_attendee WHERE meeting_id NOT IN (SELECT id FROM meeting)
#                                   OR user_id     NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM achievement  WHERE project_id NOT IN (SELECT id FROM project);
# SELECT COUNT(*) FROM achievement  WHERE file_id IS NOT NULL
#                                     AND file_id   NOT IN (SELECT id FROM file);
# SELECT COUNT(*) FROM achievement_member WHERE achievement_id NOT IN (SELECT id FROM achievement)
#                                   OR user_id     NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM conversation_member WHERE conversation_id NOT IN (SELECT id FROM conversation)
#                                   OR user_id     NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM message      WHERE conversation_id NOT IN (SELECT id FROM conversation)
#                                   OR sender_id    NOT IN (SELECT id FROM user);
# SELECT COUNT(*) FROM activity_log WHERE team_id NOT IN (SELECT id FROM team)
#                                   OR user_id NOT IN (SELECT id FROM user);

# 第二节：DDL（先加配套索引，再加约束；名字与 prisma db push 产物一致）
ALTER TABLE `team`
  ADD CONSTRAINT `team_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `team_member`
  ADD CONSTRAINT `team_member_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `team_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `file`
  ADD CONSTRAINT `file_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `project`
  ADD CONSTRAINT `project_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `project_member`
  ADD KEY `project_member_user_id_fkey` (`user_id`),
  ADD CONSTRAINT `project_member_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `project_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `milestone`
  ADD CONSTRAINT `milestone_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `task`
  ADD CONSTRAINT `task_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `task_assignee_id_fkey` FOREIGN KEY (`assignee_id`) REFERENCES `user` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `literature`
  ADD KEY `literature_project_id_fkey` (`project_id`),
  ADD KEY `literature_file_id_fkey` (`file_id`),
  ADD CONSTRAINT `literature_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `literature_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `literature_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `literature_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `file` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `literature_tag`
  ADD CONSTRAINT `literature_tag_literature_id_fkey` FOREIGN KEY (`literature_id`) REFERENCES `literature` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `meeting`
  ADD CONSTRAINT `meeting_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `meeting_attendee`
  ADD KEY `meeting_attendee_user_id_fkey` (`user_id`),
  ADD CONSTRAINT `meeting_attendee_meeting_id_fkey` FOREIGN KEY (`meeting_id`) REFERENCES `meeting` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `meeting_attendee_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `achievement`
  ADD KEY `achievement_file_id_fkey` (`file_id`),
  ADD CONSTRAINT `achievement_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `achievement_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `file` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `achievement_member`
  ADD KEY `achievement_member_user_id_fkey` (`user_id`),
  ADD CONSTRAINT `achievement_member_achievement_id_fkey` FOREIGN KEY (`achievement_id`) REFERENCES `achievement` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `achievement_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `conversation_member`
  ADD CONSTRAINT `conversation_member_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `conversation_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `message`
  ADD KEY `message_sender_id_fkey` (`sender_id`),
  ADD CONSTRAINT `message_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `conversation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `message_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `activity_log`
  ADD CONSTRAINT `activity_log_team_id_fkey` FOREIGN KEY (`team_id`) REFERENCES `team` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `activity_log_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

# 第三节：迁移后校验（应返回 28）
# SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
#  WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'FOREIGN KEY';
