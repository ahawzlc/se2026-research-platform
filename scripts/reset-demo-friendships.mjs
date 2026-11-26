/**
 * 重置演示账号的好友关系（仅用于本地截图/手工验收）。
 * 用法：node scripts/reset-demo-friendships.mjs
 */
import { PrismaClient } from '../backend/node_modules/@prisma/client/index.js'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL ?? 'mysql://se2026:se2026_pwd@127.0.0.1:3306/se2026' } },
})

async function main() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: 'demo_' } },
    select: { id: true, username: true },
  })
  console.log('演示用户：', users.map((u) => u.username).join(', '))
  const ids = users.map((u) => u.id)
  if (ids.length === 0) {
    console.log('没有演示用户，先跑 seed-demo.mjs')
    return
  }
  const rows = await prisma.friendship.findMany({
    where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] },
    select: { id: true, requesterId: true, addresseeId: true, status: true },
  })
  for (const r of rows) {
    await prisma.friendship.delete({ where: { id: r.id } })
  }
  console.log(`已删除 ${rows.length} 条演示好友关系`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
