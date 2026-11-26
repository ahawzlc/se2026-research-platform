/**
 * F-2 虚拟机浏览器验收数据准备。先构建 backend，再在仓库根运行：
 * DATABASE_URL=mysql://root:f2_local_only@127.0.0.1:3307/se2026 node scripts/acceptance/f2-prepare-demo.cjs
 * 只允许本次独立测试容器地址。保留数据供截图，不自动删除。
 */
const path = require('node:path');
const { createRequire } = require('node:module');
const backend = path.resolve(__dirname, '../../backend');
const load = createRequire(path.join(backend, 'package.json'));
const { NestFactory } = load('@nestjs/core');
const { SchedulerRegistry } = load('@nestjs/schedule');
const bcrypt = load('bcryptjs');
const { AppModule } = load('./dist/app.module');
const { PrismaService } = load('./dist/prisma/prisma.service');
const { MeetingReminderService } = load('./dist/meetings/meeting-reminder.service');

async function main() {
  const url = new URL(process.env.DATABASE_URL || 'mysql://invalid');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '3307' || url.pathname !== '/se2026') {
    throw new Error('请设置 DATABASE_URL 指向本次独立测试容器 127.0.0.1:3307/se2026');
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
    const prisma = app.get(PrismaService);
    const suffix = Date.now().toString(36);
    const password = 'Passw0rd!2026';
    const passwordHash = await bcrypt.hash(password, 10);
    const owner = await prisma.user.create({ data: { username: `f2demo_${suffix}`, nickname: 'F-2 演示同学', passwordHash } });
    const member = await prisma.user.create({ data: { username: `f2member_${suffix}`, nickname: 'F-2 参会同学', passwordHash } });
    const team = await prisma.team.create({ data: { name: `F-2 验收组 ${suffix}`, ownerId: owner.id, inviteCode: `f2d${suffix}` } });
    await prisma.teamMember.createMany({ data: [
      { teamId: team.id, userId: owner.id, role: 'owner' },
      { teamId: team.id, userId: member.id, role: 'member' },
    ] });
    const other = await prisma.project.create({ data: { teamId: team.id, name: 'F-2 跨项目跳转验收' } });
    const project = await prisma.project.create({ data: { teamId: team.id, name: 'F-2 排序与日历验收' } });
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    async function create(title, heldAt, projectId = project.id) {
      const meeting = await prisma.meeting.create({ data: { projectId, title, heldAt, location: '科研楼 301 / 线上会议链接', content: 'F-2 review 浏览器验收数据' } });
      await prisma.meetingAttendee.createMany({ data: [
        { meetingId: meeting.id, userId: owner.id },
        { meetingId: meeting.id, userId: member.id },
      ] });
      return meeting;
    }
    const reminder = await create('55 分钟后：提醒直达详情验收', new Date(now.getTime() + 55 * 60_000));
    // F2_DEMO_LARGE=1 时额外造远期会议，验证工作台不会漏掉最近的会议。
    const extraMeetings = process.env.F2_DEMO_LARGE === '1' ? 106 : 11;
    for (let i = 1; i <= extraMeetings; i++) {
      await create(`未来会议 ${String(i).padStart(2, '0')}`, new Date(now.getTime() + (i + 1) * 3_600_000));
    }
    await create('进行中会议（默认120分钟）', new Date(now.getTime() - 30 * 60_000));
    await create('已结束会议', new Date(now.getTime() - 121 * 60_000));
    await create('未安排时间会议', null);
    const cross = await create('其他项目：提醒直达详情验收', new Date(now.getTime() + 60 * 60_000), other.id);
    const temporary = await create('5分钟后临时会议', new Date(now.getTime() + 5 * 60_000), other.id);
    const longTitle = await create('长'.repeat(190), new Date(now.getTime() + 10 * 60_000), other.id);
    await app.get(MeetingReminderService).runOnce(now);
    const count = await prisma.notification.count({ where: { userId: owner.id, type: 'meeting_upcoming', refId: { in: [reminder.id, cross.id, temporary.id, longTitle.id] }, deleted: 0 } });
    console.log(JSON.stringify({
      username: owner.username, memberUsername: member.username, password,
      project: project.name,
      reminderNotificationsForOwner: count,
      futureMeetingsInSortingProject: extraMeetings + 1,
      expectedNotEndedInSortingProject: extraMeetings + 2,
      nearestDashboardTitle: temporary.title,
      directUrl: `http://localhost:5173/meetings?meetingId=${reminder.id}`,
      otherProjectUrl: `http://localhost:5173/meetings?meetingId=${cross.id}`,
      note: '登录后依次验收铃铛、通知中心、工作台与直接链接；截图完成前保留测试容器。'
    }, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
