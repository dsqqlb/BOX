#!/usr/bin/env node
/**
 * NoteQuest 存档 / 墓地接口冒烟测试（端到端）：
 *   1. 用固定端口拉起 server/index.js；
 *   2. 在 SQLite 里临时创建三个账号：两个有 notequest 权限、一个没有；
 *   3. 验证：登录与权限网关 → 空列表 → 创建存档（服务端从快照派生摘要列）→ 读取详情
 *      → PATCH 推进进度 → 状态变 dead 时自动写墓地且只写一次 → 非法/超大快照被拒
 *      → 账号之间互相看不到 → 删除；
 *   4. 清理测试账号（级联删除存档与墓地）并关闭服务。
 *
 * 用法：node ops/scripts/smoke-notequest.mjs
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const PORT = 19878;
const BASE = `http://localhost:${PORT}`;
const USERS = [
  { username: 'notequest_smoke_a', password: 'smoke-password-a-1234', permissions: ['notequest'] },
  { username: 'notequest_smoke_b', password: 'smoke-password-b-1234', permissions: ['savings-tracker'] },
  { username: 'notequest_smoke_c', password: 'smoke-password-c-1234', permissions: ['notequest'] },
];

let failures = 0;
const reportLines = [];

function check(name, condition, detail = '') {
  const line = `  ${condition ? '[OK]' : '[FAIL]'} ${name}${condition ? '' : ` — ${detail}`}`;
  console.log(line);
  reportLines.push(line);
  if (!condition) failures += 1;
}

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 + 16 * 1024 * 1024 }).toString('base64url');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

async function setupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(codeRoot, 'server', 'db.js')).href);
  for (const { username, password, permissions } of USERS) {
    const passwordHash = scryptHash(password);
    await prisma.user.upsert({
      where: { username },
      update: { passwordHash, sessionRevision: { increment: 1 }, permissions: { deleteMany: {}, create: permissions.map((permission) => ({ permission })) } },
      create: { username, passwordHash, sessionRevision: 0, permissions: { create: permissions.map((permission) => ({ permission })) } },
    });
  }
  await prisma.$disconnect();
}

async function cleanupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(codeRoot, 'server', 'db.js')).href);
  await prisma.user.deleteMany({ where: { username: { in: USERS.map((user) => user.username) } } });
  await prisma.$disconnect();
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

async function login(username, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ username, password }).toString(),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败（${username}）: HTTP ${response.status}`);
  return setCookie.split(';')[0];
}

async function api(pathname, { method = 'GET', cookie = null, body = null, origin = true } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = BASE;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

/** 一份最小但结构完整的快照（服务端只做形状检查，具体字段由前端引擎负责）。 */
function makeState(overrides = {}) {
  return {
    version: 1,
    id: 'local-run-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    title: '测试局',
    dungeon: {
      typeId: 'palace',
      name: '秘密恐惧之宫殿',
      intro: '测试用',
      depth: 1,
      entered: false,
      nodes: [{ id: 'node-1', kind: 'entrance', depth: 1, doors: [], monsters: [], trapsActive: false, cleared: true, visited: true, x: 0, y: 0 }],
      currentId: 'node-1',
      entries: 0,
    },
    hero: {
      name: '测试勇者', raceId: 'human', raceName: '人类', classId: 'guard', className: '守卫',
      hp: 24, maxHp: 24, baseHp: 24, abilityNotes: ['无能力。'],
      weapon: { name: '短剑', damage: '1d6' }, spareWeapons: [], armors: [], spells: [],
      torches: 10, coins: 0, treasure: 0, keys: 0, items: [], lostArm: false, hasLight: false, stunned: 0,
      devoured: false, trapShield: 0,
    },
    combat: null,
    town: { inTown: true, needsMonsterReroll: false },
    log: [],
    stats: { kills: 0, treasures: 0, coinsFound: 0, deepestDepth: 1, turns: 0, trapsTriggered: 0, chestsOpened: 0 },
    outcome: null,
    ...overrides,
  };
}

async function runHttpTests(cookies) {
  console.log('\n▶ 登录与权限网关');
  const anonymous = await api('/api/notequest/runs', { origin: false });
  check('未登录访问 /api/notequest/runs 返回 401', anonymous.status === 401, `实际 ${anonymous.status}`);
  const forbidden = await api('/api/notequest/runs', { cookie: cookies.b });
  check('无 notequest 权限的账户返回 403', forbidden.status === 403, `实际 ${forbidden.status}`);
  const forbiddenGraves = await api('/api/notequest/graves', { cookie: cookies.b });
  check('墓地列表同样受权限保护', forbiddenGraves.status === 403, `实际 ${forbiddenGraves.status}`);

  console.log('\n▶ 创建存档：服务端从快照派生摘要列');
  const empty = await api('/api/notequest/runs', { cookie: cookies.a });
  check('新账号的存档列表为空', empty.status === 200 && Array.isArray(empty.body?.runs) && empty.body.runs.length === 0, JSON.stringify(empty.body));

  const created = await api('/api/notequest/runs', { method: 'POST', cookie: cookies.a, body: { title: '测试局', state: makeState() } });
  const run = created.body?.run;
  check('创建返回 201', created.status === 201, `实际 ${created.status} ${JSON.stringify(created.body)}`);
  check('摘要列来自快照（角色/地牢/层数/HP）', run?.heroName === '测试勇者' && run?.dungeonName === '秘密恐惧之宫殿' && run?.depth === 1 && run?.maxHp === 24, JSON.stringify(run));
  check('状态是 active 且没有结束时间', run?.status === 'active' && run?.endedAt === null, JSON.stringify({ status: run?.status, endedAt: run?.endedAt }));
  const runId = run?.id;

  console.log('\n▶ 读取详情与推进进度');
  const detail = await api(`/api/notequest/runs/${runId}`, { cookie: cookies.a });
  check('详情返回完整快照', detail.status === 200 && detail.body?.run?.state?.hero?.name === '测试勇者', JSON.stringify(detail.body?.run?.state?.hero));
  check('快照里的地图节点也回来了', Array.isArray(detail.body?.run?.state?.dungeon?.nodes) && detail.body.run.state.dungeon.nodes.length === 1);

  const advanced = makeState({ stats: { kills: 3, treasures: 2, coinsFound: 12, deepestDepth: 2, turns: 9, trapsTriggered: 1, chestsOpened: 1 } });
  advanced.hero.coins = 12;
  advanced.hero.torches = 6;
  advanced.hero.hp = 18;
  advanced.dungeon.depth = 2;
  const patched = await api(`/api/notequest/runs/${runId}`, { method: 'PATCH', cookie: cookies.a, body: { state: advanced, title: '测试局（推进）' } });
  check('PATCH 返回 200', patched.status === 200, `实际 ${patched.status} ${JSON.stringify(patched.body)}`);
  check('摘要列跟着更新', patched.body?.run?.turns === 9 && patched.body?.run?.kills === 3 && patched.body?.run?.coins === 12 && patched.body?.run?.depth === 2, JSON.stringify(patched.body?.run));
  check('标题可以单独改', patched.body?.run?.title === '测试局（推进）', patched.body?.run?.title);

  console.log('\n▶ 死亡 → 自动写墓地（且只写一次）');
  const dead = makeState({ status: 'dead', outcome: { kind: 'death', text: '被测试怪物打死', at: Date.now() }, stats: { kills: 3, treasures: 2, coinsFound: 12, deepestDepth: 3, turns: 15, trapsTriggered: 2, chestsOpened: 1 } });
  dead.hero.hp = 0;
  dead.dungeon.depth = 3;
  const killed = await api(`/api/notequest/runs/${runId}`, { method: 'PATCH', cookie: cookies.a, body: { state: dead } });
  check('状态变成 dead 且记录了结束时间', killed.body?.run?.status === 'dead' && Boolean(killed.body?.run?.endedAt), JSON.stringify({ status: killed.body?.run?.status, endedAt: killed.body?.run?.endedAt }));

  const graves = await api('/api/notequest/graves', { cookie: cookies.a });
  check('墓地出现 1 条记录', graves.status === 200 && graves.body?.graves?.length === 1, JSON.stringify(graves.body));
  const grave = graves.body?.graves?.[0];
  check('墓地内容取自快照', grave?.characterName === '测试勇者' && grave?.cause === '被测试怪物打死' && grave?.depth === 3, JSON.stringify(grave));

  await api(`/api/notequest/runs/${runId}`, { method: 'PATCH', cookie: cookies.a, body: { state: dead } });
  const gravesAgain = await api('/api/notequest/graves', { cookie: cookies.a });
  check('同一条存档不会重复写墓地', gravesAgain.body?.graves?.length === 1, JSON.stringify(gravesAgain.body?.graves?.length));

  console.log('\n▶ 非法输入与账号隔离');
  const badState = await api('/api/notequest/runs', { method: 'POST', cookie: cookies.a, body: { state: { version: 1 } } });
  check('缺少 hero/dungeon 的快照被拒绝（400）', badState.status === 400, `实际 ${badState.status}`);
  const huge = makeState();
  huge.log = [{ id: 'x', at: Date.now(), kind: 'info', text: 'x'.repeat(420 * 1024) }];
  const tooBig = await api('/api/notequest/runs', { method: 'POST', cookie: cookies.a, body: { state: huge } });
  check('超过体积上限的快照被拒绝（413）', tooBig.status === 413, `实际 ${tooBig.status}`);
  const crossAccount = await api('/api/notequest/runs', { cookie: cookies.c });
  check('另一个有权限的账号看不到别人的存档', crossAccount.status === 200 && crossAccount.body.runs.length === 0, JSON.stringify(crossAccount.body));
  const crossGraves = await api('/api/notequest/graves', { cookie: cookies.c });
  check('墓地也按账号隔离', crossGraves.body?.graves?.length === 0, JSON.stringify(crossGraves.body?.graves?.length));
  const crossDelete = await api(`/api/notequest/runs/${runId}`, { method: 'DELETE', cookie: cookies.c });
  check('别人删不掉你的存档（404）', crossDelete.status === 404, `实际 ${crossDelete.status}`);

  console.log('\n▶ 删除存档');
  const removed = await api(`/api/notequest/runs/${runId}`, { method: 'DELETE', cookie: cookies.a });
  check('删除返回 200', removed.status === 200, `实际 ${removed.status}`);
  const gone = await api(`/api/notequest/runs/${runId}`, { cookie: cookies.a });
  check('删除后读取返回 404', gone.status === 404, `实际 ${gone.status}`);
  const gravesAfterDelete = await api('/api/notequest/graves', { cookie: cookies.a });
  check('墓地记录保留（角色已经死了）', gravesAfterDelete.body?.graves?.length === 1, JSON.stringify(gravesAfterDelete.body?.graves?.length));
}

async function main() {
  console.log('NoteQuest 冒烟测试开始');
  await setupUsers();
  console.log('已准备测试账号（两个有权限、一个没有）');

  const child = spawn(process.execPath, [path.join(codeRoot, 'server', 'index.js')], {
    cwd: codeRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  let serverReady = false;
  try {
    await waitForServer(child);
    serverReady = true;
    console.log('服务已就绪');
    const cookies = {
      a: await login(USERS[0].username, USERS[0].password),
      b: await login(USERS[1].username, USERS[1].password),
      c: await login(USERS[2].username, USERS[2].password),
    };
    await runHttpTests(cookies);
  } finally {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await cleanupUsers();
      console.log('已清理测试账号');
    } catch (error) {
      console.error('清理测试账号失败:', error);
    }
    if ((failures > 0 || !serverReady) && serverLog) console.log('\n--- 服务输出 ---\n' + serverLog);
  }

  if (failures > 0) {
    console.error(`\n失败 ${failures} 项`);
    reportLines.push(`[FAIL] ${failures} 项`);
    if (process.env.SMOKE_REPORT) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.SMOKE_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
    }
    process.exit(1);
  }
  console.log('\n全部通过');
  reportLines.push('[OK] 全部通过');
  if (process.env.SMOKE_REPORT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.SMOKE_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
  }
}

main().catch((error) => {
  console.error('\n冒烟测试异常:', error);
  process.exit(1);
});