#!/usr/bin/env node
/**
 * 一次性迁移：把旧的「每账户一行整包 JSON」拆成「一行一个 key」。
 *
 * 背景：角色卡存档原来存在 DndSave.dataJson（整包快照）。整包覆盖会用旧数据
 * 抹掉新改动，所以改成 DndSaveEntry（ownerId + key 为主键）后只写变化的字段。
 *
 * 语义：
 *   - 幂等：重复执行只是把同样的值再写一遍，不会丢数据；
 *   - 旧的 DndSave 行**保留不删**，作为迁移前快照（回滚时可用）；
 *   - 只搬运值是字符串的键，其它类型跳过并告警。
 *
 * 用法：node scripts/migrate-dnd-save-to-entries.mjs
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { prisma } = await import(pathToFileURL(path.join(projectRoot, 'server', 'db.js')).href);

const rows = await prisma.dndSave.findMany({
  select: { ownerId: true, dataJson: true, owner: { select: { username: true } } },
});

console.log(`发现 ${rows.length} 个旧存档（DndSave）。`);

let totalKeys = 0;
let skipped = 0;

for (const row of rows) {
  let data = null;
  try {
    data = JSON.parse(row.dataJson);
  } catch (error) {
    console.warn(`  ✘ ${row.owner.username}：存档 JSON 无法解析，已跳过（${error.message}）`);
    continue;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.warn(`  ✘ ${row.owner.username}：存档顶层不是对象，已跳过`);
    continue;
  }

  const entries = Object.entries(data).filter(([, value]) => typeof value === 'string');
  skipped += Object.keys(data).length - entries.length;

  for (const [key, value] of entries) {
    await prisma.dndSaveEntry.upsert({
      where: { ownerId_key: { ownerId: row.ownerId, key } },
      create: { ownerId: row.ownerId, key, value },
      update: { value },
    });
  }
  totalKeys += entries.length;
  console.log(`  ✔ ${row.owner.username}：迁移 ${entries.length} 个字段`);
}

const after = await prisma.dndSaveEntry.count();
console.log(`完成：写入 ${totalKeys} 个字段，跳过 ${skipped} 个非字符串值；当前 DndSaveEntry 共 ${after} 行。`);
console.log('旧的 DndSave 行仍保留（未删除），可随时用 SQL 核对。');

await prisma.$disconnect();
