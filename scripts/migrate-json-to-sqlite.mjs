#!/usr/bin/env node
/**
 * 一次性导入旧的账户/EDH 牌组 JSON 到 SQLite。
 * 使用前先执行：npm run db:migrate
 * 原始 JSON 会复制到 data/backups/json-to-sqlite-<timestamp>/，不会删除。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { prisma } = require('../server/db');
const root = path.resolve(import.meta.dirname, '..');
const usersPath = path.resolve(process.env.BOX_AUTH_USERS_FILE || path.join(root, 'data', 'auth-users.json'));
const decksDir = path.join(root, 'data', 'edh', 'decks');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, 'data', 'backups', `json-to-sqlite-${timestamp}`);
const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`无法读取 ${file}：${error.message}`); }
}

function assert(condition, message) { if (!condition) throw new Error(message); }

function validateUsers(raw) {
  assert(raw && Array.isArray(raw.users) && raw.users.length > 0, '账户文件必须包含至少一个 users 条目。');
  const seen = new Set();
  return raw.users.map((entry, index) => {
    const username = typeof entry?.username === 'string' ? entry.username.trim() : '';
    const passwordHash = typeof entry?.passwordHash === 'string' ? entry.passwordHash : '';
    const permissions = Array.isArray(entry?.permissions) ? [...new Set(entry.permissions.filter((value) => typeof value === 'string' && value))] : [];
    assert(usernamePattern.test(username) && !seen.has(username), `账户 #${index + 1} 的用户名无效或重复。`);
    assert(passwordHash.startsWith('scrypt$') && permissions.length > 0, `账户 ${username} 的密码哈希或权限无效。`);
    seen.add(username);
    return { username, passwordHash, permissions };
  });
}

function normalizeDeck(deck, owner, source) {
  assert(deck && typeof deck === 'object' && typeof deck.id === 'string' && deck.id, `${source} 含无效牌组 ID。`);
  assert(typeof deck.name === 'string' && deck.name.trim(), `${source} 的牌组 ${deck.id} 缺少名称。`);
  assert(!deck.owner || deck.owner === owner, `${source} 的牌组 ${deck.id} 所有者与文件名不一致。`);
  const cards = Array.isArray(deck.cards) ? deck.cards : [];
  const combined = new Map();
  for (const card of cards) {
    assert(card && typeof card.oracleId === 'string' && card.oracleId && Number.isFinite(Number(card.quantity)) && Number(card.quantity) > 0, `${source} 的牌组 ${deck.id} 含无效卡牌。`);
    combined.set(card.oracleId, Math.min(99, (combined.get(card.oracleId) || 0) + Math.floor(Number(card.quantity))));
  }
  const createdAt = new Date(deck.createdAt);
  const updatedAt = new Date(deck.updatedAt);
  assert(!Number.isNaN(createdAt.valueOf()) && !Number.isNaN(updatedAt.valueOf()), `${source} 的牌组 ${deck.id} 时间戳无效。`);
  return {
    id: deck.id,
    owner,
    name: deck.name.trim().slice(0, 100),
    commanderOracleId: typeof deck.commanderOracleId === 'string' ? deck.commanderOracleId : null,
    cards: [...combined].map(([oracleId, quantity]) => ({ oracleId, quantity })),
    layoutJson: deck.layout && typeof deck.layout === 'object' ? JSON.stringify(deck.layout) : null,
    createdAt,
    updatedAt,
  };
}

function backupSource() {
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(usersPath, path.join(backupDir, 'auth-users.json'));
  if (fs.existsSync(decksDir)) fs.cpSync(decksDir, path.join(backupDir, 'edh-decks'), { recursive: true });
  return backupDir;
}

async function main() {
  assert(fs.existsSync(usersPath), `找不到账户文件：${usersPath}`);
  const users = validateUsers(readJson(usersPath));
  const userNames = new Set(users.map((user) => user.username));
  const decks = [];
  if (fs.existsSync(decksDir)) {
    for (const filename of fs.readdirSync(decksDir).filter((name) => name.endsWith('.json'))) {
      const owner = path.basename(filename, '.json');
      assert(userNames.has(owner), `牌组文件 ${filename} 没有匹配的账户，导入已停止。`);
      const rawDecks = readJson(path.join(decksDir, filename));
      assert(Array.isArray(rawDecks), `牌组文件 ${filename} 顶层必须是数组。`);
      rawDecks.forEach((deck) => decks.push(normalizeDeck(deck, owner, filename)));
    }
  }
  const ids = new Set();
  decks.forEach((deck) => assert(!ids.has(deck.id) && (ids.add(deck.id) || true), `发现重复牌组 ID：${deck.id}`));
  const backup = backupSource();

  await prisma.$transaction(async (tx) => {
    await tx.deckCard.deleteMany();
    await tx.deck.deleteMany();
    await tx.userPermission.deleteMany();
    await tx.user.deleteMany();
    for (const user of users) {
      await tx.user.create({ data: { username: user.username, passwordHash: user.passwordHash, permissions: { create: user.permissions.map((permission) => ({ permission })) } } });
    }
    for (const deck of decks) {
      await tx.deck.create({ data: { id: deck.id, owner: { connect: { username: deck.owner } }, name: deck.name, commanderOracleId: deck.commanderOracleId, layoutJson: deck.layoutJson, createdAt: deck.createdAt, updatedAt: deck.updatedAt, cards: { create: deck.cards } } });
    }
  });

  const [storedUsers, storedDecks, storedCards] = await Promise.all([prisma.user.count(), prisma.deck.count(), prisma.deckCard.count()]);
  assert(storedUsers === users.length && storedDecks === decks.length && storedCards === decks.reduce((sum, deck) => sum + deck.cards.length, 0), '导入后的数据库计数与源数据不一致。');
  console.log(JSON.stringify({ success: true, backup, users: storedUsers, decks: storedDecks, deckCards: storedCards }, null, 2));
}

main().catch((error) => { console.error(`❌ JSON 导入失败：${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
