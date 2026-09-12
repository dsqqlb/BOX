#!/usr/bin/env node
/**
 * DND 角色卡存档（字段级增量）端到端冒烟测试：
 *   1. 用随机端口拉起 server/index.js（生产模式，需先 npm run build）；
 *   2. 建两个临时账号（一个有 dnd-character，一个没有）；
 *   3. HTTP：局部写入只影响指定字段、null 删除、非法值拒绝、
 *            旧客户端「整包提交」仍然兼容、GET 带 updatedAt、权限/同源校验；
 *   4. 清理测试账号并关闭服务。
 *
 * 用法：node scripts/smoke-dnd-sync.mjs
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19877;
const BASE = `http://localhost:${PORT}`;
const OWNER = { username: 'dnd_smoke_owner', password: 'smoke-password-dnd-1234' };
const OUTSIDER = { username: 'dnd_smoke_outsider', password: 'smoke-password-dnd-5678' };

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  ${condition ? '✔' : '✘'} ${name}${condition ? '' : ` — ${detail}`}`);
  if (!condition) failures += 1;
}

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 + 16 * 1024 * 1024 }).toString('base64url');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

async function setupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(projectRoot, 'server', 'db.js')).href);
  for (const [account, permission] of [[OWNER, 'dnd-character'], [OUTSIDER, 'tarot-reading']]) {
    const passwordHash = scryptHash(account.password);
    await prisma.user.upsert({
      where: { username: account.username },
      update: { passwordHash, sessionRevision: { increment: 1 }, permissions: { deleteMany: {}, create: [{ permission }] } },
      create: { username: account.username, passwordHash, sessionRevision: 0, permissions: { create: [{ permission }] } },
    });
  }
  await prisma.dndSaveEntry.deleteMany({ where: { owner: { username: OWNER.username } } });
  await prisma.$disconnect();
}

async function cleanupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(projectRoot, 'server', 'db.js')).href);
  await prisma.user.deleteMany({ where: { username: { in: [OWNER.username, OUTSIDER.username] } } });
  await prisma.$disconnect();
}

function startServer() {
  return spawn(process.execPath, ['server/index.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForServer(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.status < 500) return;
    } catch { /* 还没起来 */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('服务启动超时');
}

async function login(account) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ username: account.username, password: account.password }).toString(),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败（${account.username}）: HTTP ${response.status}`);
  return setCookie.split(';')[0];
}

async function getSave(cookie) {
  const response = await fetch(`${BASE}/api/dnd/save`, { headers: { Cookie: cookie } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function postSave(cookie, data, { origin = BASE } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = origin;
  const response = await fetch(`${BASE}/api/dnd/save`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

const child = startServer();
let exitCode = 0;
try {
  await setupUsers();
  await waitForServer(child);
  const cookie = await login(OWNER);
  const outsiderCookie = await login(OUTSIDER);

  console.log('\n[HTTP] 初始状态');
  let save = await getSave(cookie);
  check('初始存档为空（data 为 null）', save.status === 200 && save.body.data === null, JSON.stringify(save.body));

  console.log('\n[HTTP] 字段级增量写入');
  let result = await postSave(cookie, { hp: '30' });
  check('写入单个字段返回 200 且 saved=1', result.status === 200 && result.body.saved === 1, JSON.stringify(result.body));
  save = await getSave(cookie);
  check('读回该字段', !!save.body.data && save.body.data.hp === '30', JSON.stringify(save.body.data));
  check('GET 返回 updatedAt', typeof save.body.updatedAt === 'string' && save.body.updatedAt.length > 0);

  await postSave(cookie, { xp: '9000' });
  save = await getSave(cookie);
  check('★核心：只写变化字段，已有字段 hp 不受影响', save.body.data.hp === '30' && save.body.data.xp === '9000', JSON.stringify(save.body.data));

  await postSave(cookie, { slots: '[1,2,3]' });
  save = await getSave(cookie);
  check('第三个字段追加成功', save.body.data.slots === '[1,2,3]' && Object.keys(save.body.data).length === 3, JSON.stringify(save.body.data));

  console.log('\n[HTTP] 兼容旧的「整包提交」客户端');
  result = await postSave(cookie, { hp: '30', xp: '9000', slots: '[1,2,3]' });
  save = await getSave(cookie);
  check('整包提交仍然工作', result.status === 200 && result.body.saved === 3 && Object.keys(save.body.data).length === 3);

  console.log('\n[HTTP] null = 删除该字段');
  result = await postSave(cookie, { hp: null });
  save = await getSave(cookie);
  check('删除后该字段消失、其它字段保留', !('hp' in save.body.data) && save.body.data.xp === '9000' && save.body.data.slots === '[1,2,3]', JSON.stringify(save.body.data));

  console.log('\n[HTTP] 参数校验');
  check('数字值被拒 400', (await postSave(cookie, { hp: 123 })).status === 400);
  check('对象值被拒 400', (await postSave(cookie, { hp: { a: 1 } })).status === 400);
  check('空 data 被拒 400', (await postSave(cookie, {})).status === 400);
  check('空键名被拒 400', (await postSave(cookie, { '': 'x' })).status === 400);
  check('超长键名被拒 400', (await postSave(cookie, { ['k'.repeat(200)]: 'x' })).status === 400);

  console.log('\n[HTTP] 权限与同源');
  check('缺少 Origin 被拒 403', (await postSave(cookie, { hp: '1' }, { origin: null })).status === 403);
  check('跨源被拒 403', (await postSave(cookie, { hp: '1' }, { origin: 'http://evil.example' })).status === 403);
  check('无 dnd-character 权限被拒 403', (await postSave(outsiderCookie, { hp: '1' })).status === 403);
  const anonymous = await fetch(`${BASE}/api/dnd/save`, { redirect: 'manual' });
  check('未登录不能读取（401/303）', anonymous.status === 401 || anonymous.status === 303, `HTTP ${anonymous.status}`);

  console.log('\n[HTTP] 大字段（5MB 上限内）');
  const bigValue = JSON.stringify({ log: 'x'.repeat(300 * 1024) });
  result = await postSave(cookie, { sessions: bigValue });
  save = await getSave(cookie);
  check('300KB 字段写入并读回一致', result.status === 200 && save.body.data.sessions === bigValue);

  result = await postSave(cookie, { huge: 'y'.repeat(6 * 1024 * 1024) });
  check('超过 5MB 被拒（400）', result.status === 400, `HTTP ${result.status}`);
} catch (error) {
  console.error('\n测试异常：', error.message);
  exitCode = 1;
} finally {
  try { await cleanupUsers(); } catch (error) { console.error('清理账号失败：', error.message); }
  child.kill();
}

console.log(failures ? `\n✘ ${failures} 项失败` : '\n✔ 全部通过');
process.exit(failures || exitCode ? 1 : 0);
