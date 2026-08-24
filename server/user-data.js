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

async function getDndSave(username) {
  const save = await prisma.dndSave.findFirst({ where: { owner: { username } } });
  if (!save) return null;
  try {
    const data = JSON.parse(save.dataJson);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch (error) {
    console.error(`读取 DND SQLite 存档失败（${username}）:`, error.message);
    throw new Error('DND 存档数据损坏。');
  }
}

async function saveDndSave(username, data) {
  const existing = await prisma.dndSave.findFirst({ where: { owner: { username } }, select: { ownerId: true } });
  if (existing) {
    await prisma.dndSave.update({ where: { ownerId: existing.ownerId }, data: { dataJson: JSON.stringify(data) } });
    return;
  }
  await prisma.dndSave.create({ data: { owner: { connect: { username } }, dataJson: JSON.stringify(data) } });
}

module.exports = { listSavings, createSavings, updateSavings, deleteSavings, getDndSave, saveDndSave };
