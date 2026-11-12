import type { Prisma } from '@prisma/client';
import type { evaluateActivities } from './participation';

type Detail = ReturnType<typeof evaluateActivities>[number];
type SourceKind =
  'task' | 'milestone' | 'literature' | 'meeting' | 'achievement';

export interface Source {
  kind: SourceKind;
  id: string;
  title: string;
  projectId: string | null;
}

/** 按当前页批量解析同组对象，投影只包含名称和标识。 */
export async function activitySources(
  tx: Prisma.TransactionClient,
  teamId: bigint,
  page: Detail[],
) {
  const ids = (refType: string) =>
    page.flatMap((event) =>
      event.refType === refType && event.refId ? [BigInt(event.refId)] : [],
    );
  const commentIds = ids('message');
  const messages = commentIds.length
    ? await tx.message.findMany({
        where: {
          id: { in: commentIds },
          deleted: 0,
          conversation: { type: 'comment', refType: 'task', deleted: 0 },
        },
        select: {
          id: true,
          senderId: true,
          conversation: { select: { refId: true } },
        },
      })
    : [];
  const taskIds = [
    ...ids('task'),
    ...messages.flatMap(({ conversation }) =>
      conversation.refId === null ? [] : [conversation.refId],
    ),
  ];
  const project = { teamId, deleted: 0 };
  const milestoneIds = ids('milestone');
  const literatureIds = ids('literature');
  const meetingIds = ids('meeting');
  const achievementIds = ids('achievement');
  const select = { id: true, title: true, projectId: true } as const;
  const [tasks, milestones, literatures, meetings, achievements] =
    await Promise.all([
      taskIds.length
        ? tx.task.findMany({
            where: { id: { in: taskIds }, deleted: 0, project },
            select,
          })
        : [],
      milestoneIds.length
        ? tx.milestone.findMany({
            where: { id: { in: milestoneIds }, deleted: 0, project },
            select: { id: true, name: true, projectId: true },
          })
        : [],
      literatureIds.length
        ? tx.literature.findMany({
            where: { id: { in: literatureIds }, deleted: 0, teamId },
            select,
          })
        : [],
      meetingIds.length
        ? tx.meeting.findMany({
            where: { id: { in: meetingIds }, deleted: 0, project },
            select,
          })
        : [],
      achievementIds.length
        ? tx.achievement.findMany({
            where: { id: { in: achievementIds }, deleted: 0, project },
            select,
          })
        : [],
    ]);
  const sources = new Map<string, Source>();
  function add(
    kind: SourceKind,
    rows: { id: bigint; title: string; projectId: bigint | null }[],
  ) {
    for (const row of rows) {
      sources.set(`${kind}/${row.id}`, {
        kind,
        id: String(row.id),
        title: row.title,
        projectId: row.projectId === null ? null : String(row.projectId),
      });
    }
  }
  add('task', tasks);
  add(
    'milestone',
    milestones.map(({ name, ...row }) => ({ ...row, title: name })),
  );
  add('literature', literatures);
  add('meeting', meetings);
  add('achievement', achievements);
  for (const message of messages) {
    const task = sources.get(`task/${message.conversation.refId}`);
    if (task) sources.set(`message/${message.id}/${message.senderId}`, task);
  }
  return page.map((event) => {
    const key = `${event.refType}/${event.refId}`;
    return {
      ...event,
      source:
        sources.get(
          event.refType === 'message' ? `${key}/${event.userId}` : key,
        ) ?? null,
    };
  });
}
