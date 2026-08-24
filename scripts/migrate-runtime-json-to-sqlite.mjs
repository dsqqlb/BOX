#!/usr/bin/env node
/**
 * 增量迁移旧的 DND/省钱运行时 JSON。不会删除或清空任何 SQLite 数据。
 * 源文件先备份；导入规则：DND 以 JSON 为源 upsert，省钱记录按旧 ID upsert。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../server/db');
const root = path.resolve(import.meta.dirname, '..');
const savingsFile = path.join(root, 'data', 'savings.json');
const dndSavesDir = path.join(root, 'data', 'dnd', 'saves');
const backupDir = path.join(root, 'data', 'backups', `runtime-json-to-sqlite-${new Date().toISOString().replace(/[:.]/g, '-')}`);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`无法读取 ${file}：${error.message}`); }
}
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function backupSources() {
  const found = fs.existsSync(savingsFile) || fs.existsSync(dndSavesDir);
  if (!found) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(savingsFile)) fs.copyFileSync(savingsFile, path.join(backupDir, 'savings.json'));
  if (fs.existsSync(dndSavesDir)) fs.cpSync(dndSavesDir, path.join(backupDir, 'dnd-saves'), { recursive: true });
  return backupDir;
}

async function main() {
  const users = new Set((await prisma.user.findMany({ select: { username: true } })).map((user) => user.username));
  if (!users.size) throw new Error('SQLite 中没有账户；请先完成首次账户导入。');
  const report = { backup: backupSources(), dndImported: 0, savingsImported: 0, skipped: [] };

  if (fs.existsSync(dndSavesDir)) {
    for (const filename of fs.readdirSync(dndSavesDir).filter((name) => name.endsWith('.json'))) {
      const username = path.basename(filename, '.json');
      const source = path.join(dndSavesDir, filename);
      if (!users.has(username)) { report.skipped.push({ source: filename, reason: '不存在匹配账户' }); continue; }
      const raw = readJson(source);
      if (!isObject(raw) || !isObject(raw.data) || Object.values(raw.data).some((value) => typeof value !== 'string')) {
        report.skipped.push({ source: filename, reason: 'DND 快照格式无效' }); continue;
      }
      const existing = await prisma.dndSave.findFirst({ where: { owner: { username } }, select: { ownerId: true } });
      const dataJson = JSON.stringify(raw.data);
      if (existing) await prisma.dndSave.update({ where: { ownerId: existing.ownerId }, data: { dataJson } });
      else await prisma.dndSave.create({ data: { owner: { connect: { username } }, dataJson } });
      report.dndImported += 1;
    }
  }

  if (fs.existsSync(savingsFile)) {
    const rawRecords = readJson(savingsFile);
    if (!Array.isArray(rawRecords)) throw new Error('savings.json 顶层必须是数组。');
    for (const record of rawRecords) {
      const valid = isObject(record) && typeof record.id === 'string' && record.id && typeof record.owner === 'string' && users.has(record.owner) && ['date', 'time', 'activity', 'item'].every((key) => typeof record[key] === 'string') && Number.isFinite(Number(record.amount));
      const createdAt = valid ? new Date(record.createdAt) : null;
      if (!valid || Number.isNaN(createdAt.valueOf())) { report.skipped.push({ source: `savings:${record?.id || 'unknown'}`, reason: '记录无 owner、owner 不存在或字段无效' }); continue; }
      await prisma.savingsRecord.upsert({
        where: { id: record.id },
        create: { id: record.id, owner: { connect: { username: record.owner } }, date: record.date, time: record.time, activity: record.activity, item: record.item, amount: Number(record.amount), createdAt },
        update: { owner: { connect: { username: record.owner } }, date: record.date, time: record.time, activity: record.activity, item: record.item, amount: Number(record.amount), createdAt },
      });
      report.savingsImported += 1;
    }
  }
  console.log(JSON.stringify({ success: true, ...report }, null, 2));
}

main().catch((error) => { console.error(`❌ 运行时 JSON 导入失败：${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
