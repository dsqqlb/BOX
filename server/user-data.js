'use strict';

const { prisma } = require('./db');

function toSavingsRecord(record) {
  return {
    id: record.id,
    date: record.date,
    time: record.time,
    activity: record.activity,
    item: record.item,
    amount: record.amount,
    createdAt: record.createdAt.toISOString(),
  };
}

async function listSavings(username) {
  const records = await prisma.savingsRecord.findMany({
    where: { owner: { username } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return records.map(toSavingsRecord);
}

async function createSavings(username, record) {
  const created = await prisma.savingsRecord.create({
    data: {
      id: record.id,
      owner: { connect: { username } },
      date: record.date,
      time: record.time,
      activity: record.activity,
      item: record.item,
      amount: record.amount,
      createdAt: new Date(record.createdAt),
    },
  });
  return toSavingsRecord(created);
}

async function updateSavings(username, id, patch) {
  const result = await prisma.savingsRecord.updateMany({
    where: { id, owner: { username } },
    data: patch,
  });
  if (result.count === 0) return null;
  const saved = await prisma.savingsRecord.findUnique({ where: { id } });
  return saved ? toSavingsRecord(saved) : null;
}

async function deleteSavings(username, id) {
  const result = await prisma.savingsRecord.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

/* ── DND 角色卡存档 ──
   现行：一行一个 key（DndSaveEntry）。只写变化的字段，不同设备改不同字段互不覆盖，
   上传体积也只跟这次改动量相关（旧的整包快照表 DndSave 仅作迁移前备份，不再读写）。 */
async function getDndSave(username) {
  const rows = await prisma.dndSaveEntry.findMany({
    where: { owner: { username } },
    select: { key: true, value: true, updatedAt: true },
  });
  if (!rows.length) return { data: null, updatedAt: null };
  const data = {};
  let newest = 0;
  for (const row of rows) {
    data[row.key] = row.value;
    const t = row.updatedAt.getTime();
    if (t > newest) newest = t;
  }
  return { data, updatedAt: new Date(newest).toISOString() };
}

/**
 * 字段级增量写入。patch = { key: '原样字符串' | null }，null 表示删除该键。
 * 只动 patch 里出现的 key，其余键保持不变。
 */
async function patchDndSave(username, patch) {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (!user) throw new Error('账户不存在。');
  const ownerId = user.id;

  const operations = [];
  const deleteKeys = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      deleteKeys.push(key);
      continue;
    }
    operations.push(prisma.dndSaveEntry.upsert({
      where: { ownerId_key: { ownerId, key } },
      create: { ownerId, key, value },
      update: { value },
    }));
  }
  if (deleteKeys.length) {
    operations.push(prisma.dndSaveEntry.deleteMany({ where: { ownerId, key: { in: deleteKeys } } }));
  }
  if (operations.length) await prisma.$transaction(operations);

  const newest = await prisma.dndSaveEntry.findFirst({
    where: { ownerId },
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true },
  });
  return { updatedAt: newest ? newest.updatedAt.toISOString() : null };
}

module.exports = { listSavings, createSavings, updateSavings, deleteSavings, getDndSave, patchDndSave };
