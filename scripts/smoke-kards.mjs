#!/usr/bin/env node
/**
 * Kards 功能冒烟测试（端到端）：
 *   1. 用随机端口拉起 server/index.js（生产模式，需先 npm run build）；
 *   2. 在 SQLite 里临时创建两个带 kards 权限的测试账号；
 *   3. HTTP：登录、拉卡牌目录、创建/读取/更新牌组；
 *   4. WebSocket：建房 → 加入 → 抽牌 → 出牌 → 翻面/旋转/伤害/kredits/回合 → 解散；
 *      重点验证手牌/牌库隐私遮蔽（对手只能看到牌背与数量）；
 *   5. 清理测试账号并关闭服务。
 *
 * 用法：node scripts/smoke-kards.mjs
 * 失败时打印具体断言，退出码非 0。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 19876;
const BASE = `http://localhost:${PORT}`;
const WS_BASE = `ws://localhost:${PORT}`;
const USERS = [
  { username: 'kards_smoke_a', password: 'smoke-password-a-1234' },
  { username: 'kards_smoke_b', password: 'smoke-password-b-1234' },
];

let failures = 0;
function check(name, condition, detail = '') {
  const status = condition ? '✔' : '✘';
  console.log(`  ${status} ${name}${condition ? '' : ` — ${detail}`}`);
  if (!condition) failures += 1;
}

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 + 16 * 1024 * 1024 }).toString('base64url');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

async function setupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(projectRoot, 'server', 'db.js')).href);
  for (const { username, password } of USERS) {
    const passwordHash = scryptHash(password);
    await prisma.user.upsert({
      where: { username },
      update: {
        passwordHash,
        sessionRevision: { increment: 1 },
        permissions: { deleteMany: {}, create: [{ permission: 'kards' }] },
      },
      create: {
        username,
        passwordHash,
        sessionRevision: 0,
        permissions: { create: [{ permission: 'kards' }] },
      },
    });
  }
  await prisma.$disconnect();
}

async function cleanupUsers() {
  const { prisma } = await import(pathToFileURL(path.join(projectRoot, 'server', 'db.js')).href);
  await prisma.user.deleteMany({ where: { username: { in: USERS.map((user) => user.username) } } });
  await prisma.$disconnect();
}

async function waitForServer(child, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/api/health`);
      // /api/health 需要登录（未登录返回 401）：只要服务端有响应就说明已就绪。
      if (response.status < 500) return;
    } catch {
      // 还没起来，继续等
    }
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

function wsConnect(cookie) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws?kards=1`, {
      headers: { Cookie: cookie, Origin: BASE },
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws, typeFilter = null, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待消息超时: ${typeFilter || 'any'}`));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (typeFilter && message.type !== typeFilter) return;
      cleanup();
      resolve(message);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('连接已关闭'));
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
  });
}

function send(ws, message) {
  ws.send(JSON.stringify(message));
}

async function runHttpTests(cookies) {
  console.log('\n[HTTP] 卡牌目录与牌组 API');
  const catalogResponse = await fetch(`${BASE}/api/kards/cards`, { headers: { Cookie: cookies.a } });
  check('拉取卡牌目录 200', catalogResponse.status === 200, `HTTP ${catalogResponse.status}`);
  const catalog = await catalogResponse.json();
  check('目录包含 1613 张卡', catalog.total === 1613, `实际 ${catalog.total}`);
  check('目录字段完整', catalog.cards.length > 0 && catalog.factions.length >= 10 && typeof catalog.cards[0].path === 'string');

  const sampleIds = catalog.cards.slice(0, 42).map((card) => card.id);
  const createResponse = await fetch(`${BASE}/api/kards/decks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies.a, Origin: BASE },
    body: JSON.stringify({ name: '冒烟测试牌组', cards: sampleIds }),
  });
  check('创建牌组 201', createResponse.status === 201, `HTTP ${createResponse.status}`);
  const created = await createResponse.json();
  check('牌组卡数正确', created.cards.length === 42, `实际 ${created.cards.length}`);

  const listResponse = await fetch(`${BASE}/api/kards/decks`, { headers: { Cookie: cookies.a } });
  const list = await listResponse.json();
  check('列出牌组包含新牌组', Array.isArray(list) && list.some((deck) => deck.id === created.id));

  const updateResponse = await fetch(`${BASE}/api/kards/decks/${encodeURIComponent(created.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookies.a, Origin: BASE },
    body: JSON.stringify({ name: '改名后的牌组', cards: sampleIds.slice(0, 10) }),
  });
  check('更新牌组 200', updateResponse.status === 200, `HTTP ${updateResponse.status}`);
  const updated = await updateResponse.json();
  check('更新后名称与卡数正确', updated.name === '改名后的牌组' && updated.cards.length === 10);

  const deleteResponse = await fetch(`${BASE}/api/kards/decks/${encodeURIComponent(created.id)}`, {
    method: 'DELETE',
    headers: { Cookie: cookies.a, Origin: BASE },
  });
  check('删除牌组成功', deleteResponse.status === 200, `HTTP ${deleteResponse.status}`);

  const pageResponse = await fetch(`${BASE}/tools/kards`, { headers: { Cookie: cookies.a } });
  check('工具页面可访问 200', pageResponse.status === 200, `HTTP ${pageResponse.status}`);
  const pageHtml = await pageResponse.text();
  check('页面输出包含应用根节点', pageHtml.includes('__next') || pageHtml.includes('组卡器'));

  const imageUrl = `${BASE}/image/Kards/${encodeURIComponent('德国/1k/Pak 36 反坦克炮_pak_36.png')}`;
  const imageResponse = await fetch(imageUrl, { headers: { Cookie: cookies.a } });
  check('卡图可访问 200', imageResponse.status === 200, `HTTP ${imageResponse.status}`);
  check('卡图 MIME 为图片', String(imageResponse.headers.get('content-type') || '').startsWith('image/'));

  const noAuthPage = await fetch(`${BASE}/tools/kards`, { redirect: 'manual' });
  check('未登录访问工具页被重定向', noAuthPage.status === 303 || noAuthPage.status === 401, `HTTP ${noAuthPage.status}`);
}

async function runWsTests(cookies) {
  console.log('\n[WebSocket] 建房 → 加入 → 对局操作与隐私');
  const catalog = await (await fetch(`${BASE}/api/kards/cards`, { headers: { Cookie: cookies.a } })).json();
  const hostDeck = catalog.cards.slice(0, 10).map((card) => card.id);
  const wsA = await wsConnect(cookies.a);
  const wsB = await wsConnect(cookies.b);
  const aReady = nextMessage(wsA, 'ROOM_STATE');
  send(wsA, { type: 'CREATE_ROOM', payload: { deckCards: hostDeck } });
  const hostState = await aReady;
  const roomId = hostState.payload.roomId;
  check('房主收到 ROOM_STATE 与座位 0', hostState.payload.seat === 0 && /^\d{6}$/.test(roomId));
  check('房主牌库 10 张对自己可见', hostState.payload.cards.filter((card) => card.owner === 0 && card.zone === 'deck').length === 10);

  const roomList1 = await (await fetch(`${BASE}/api/kards/rooms`, { headers: { Cookie: cookies.a } })).json();
  check('公共房间列表包含新房', roomList1.some((room) => room.roomId === roomId && room.hostUsername === 'kards_smoke_a' && room.playerCount === 1));

  const selfJoinError = nextMessage(wsA, 'ERROR');
  send(wsA, { type: 'JOIN_ROOM', payload: { roomId } });
  const selfJoinMessage = await selfJoinError;
  check('房主不能加入自己的房间', typeof selfJoinMessage.payload.message === 'string' && selfJoinMessage.payload.message.includes('自己'));

  async function actAndAwaitBoth(message) {
    const aNext = nextMessage(wsA, 'ROOM_STATE');
    const bNext = nextMessage(wsB, 'ROOM_STATE');
    send(wsA, message);
    const [aState, bState] = await Promise.all([aNext, bNext]);
    return { a: aState.payload, b: bState.payload };
  }

  const bReady = nextMessage(wsB, 'ROOM_STATE');
  const aSeesJoin = nextMessage(wsA, 'ROOM_STATE');
  send(wsB, { type: 'JOIN_ROOM', payload: { roomId, deckCards: Array(7).fill('苏联/2k/placeholder.png') } });
  const joinerState = await bReady;
  const hostAfterJoin = await aSeesJoin;
  check('加入者收到 ROOM_STATE 与座位 1', joinerState.payload.seat === 1);
  const hiddenDeckCards = joinerState.payload.cards.filter((card) => card.owner === 0 && card.zone === 'deck');
  check('对手牌库被遮蔽（cardId 为 null 且 hidden=true）', hiddenDeckCards.length === 10 && hiddenDeckCards.every((card) => card.hidden && card.cardId === null));
  check('加入者无效卡被过滤', joinerState.payload.cards.filter((card) => card.owner === 1).length === 0, '无效卡不应进入房间');
  check('房主看到加入者已入座', hostAfterJoin.payload.players.find((p) => p.seat === 1)?.username === 'kards_smoke_b');
  const roomList2 = await (await fetch(`${BASE}/api/kards/rooms`, { headers: { Cookie: cookies.b } })).json();
  check('加入后房间列表显示双方', roomList2.find((room) => room.roomId === roomId)?.joinerUsername === 'kards_smoke_b');

  // 房主抽 3 张：自己可见，对手只能看到 3 张牌背
  const afterDraw = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'DRAW', count: 3 } });
  const aHand = afterDraw.a.cards.filter((card) => card.owner === 0 && card.zone === 'hand');
  check('房主手牌 3 张且正面可见', aHand.length === 3 && aHand.every((card) => !card.hidden && card.cardId));
  const opponentHand = afterDraw.b.cards.filter((card) => card.owner === 0 && card.zone === 'hand');
  check('对手视角：房主手牌只有牌背', opponentHand.length === 3 && opponentHand.every((card) => card.hidden && card.cardId === null && card.faceDown));

  // 出牌到前线：公开区域双方可见
  const moveResult = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'MOVE', cardId: aHand[0].id, zone: 'frontline' } });
  const frontlineFromB = moveResult.b.cards.filter((card) => card.owner === 0 && card.zone === 'frontline');
  check('前线公开：对手能看到牌面', frontlineFromB.length === 1 && frontlineFromB[0].cardId != null && !frontlineFromB[0].hidden);

  // 翻面、旋转、伤害、kredits、回合
  const flipResult = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'FLIP', cardId: aHand[0].id } });
  check('翻面生效', flipResult.a.cards.find((card) => card.id === aHand[0].id)?.faceDown === true);

  const damageResult = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'DAMAGE', cardId: frontlineFromB[0].id, delta: 2 } });
  check('伤害计数生效', damageResult.a.cards.find((card) => card.id === frontlineFromB[0].id)?.damage === 2);

  const kreditsResult = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'KREDITS', delta: 3 } });
  check('kredits 调整生效', kreditsResult.a.kredits[0].current === 4);

  const turnResult = await actAndAwaitBoth({ type: 'ACTION', payload: { roomId, action: 'PASS_TURN' } });
  check('移交回合生效', turnResult.a.turnSeat === 1);

  // 越权保护：B 不能操作 A 的牌
  const protectedCard = frontlineFromB[0];
  const forbiddenB = nextMessage(wsB, 'ERROR');
  send(wsB, { type: 'ACTION', payload: { roomId, action: 'FLIP', cardId: protectedCard.id } });
  const forbiddenMessage = await forbiddenB;
  check('对手无法操作我的牌（收到错误）', true);
  check('错误提示合理', typeof forbiddenMessage.payload.message === 'string' && forbiddenMessage.payload.message.includes('找不到'));

  // 解散房间
  const closedA = nextMessage(wsA, 'ROOM_CLOSED');
  const closedB = nextMessage(wsB, 'ROOM_CLOSED');
  send(wsA, { type: 'DELETE_ROOM', payload: { roomId } });
  await Promise.all([closedA, closedB]);
  check('双方收到 ROOM_CLOSED', true);

  wsA.close();
  wsB.close();
}

async function main() {
  console.log(`Kards 冒烟测试（端口 ${PORT}）`);
  await setupUsers();
  console.log('✔ 已创建临时测试账号');

  const child = spawn(process.execPath, [path.join(projectRoot, 'server', 'index.js')], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  child.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  try {
    await waitForServer(child);
    console.log('✔ 服务已就绪');

    const cookies = {
      a: await login(USERS[0].username, USERS[0].password),
      b: await login(USERS[1].username, USERS[1].password),
    };
    console.log('✔ 两个账号已登录');

    await runHttpTests(cookies);
    await runWsTests(cookies);
  } finally {
    console.log('\n清理中…');
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      await cleanupUsers();
      console.log('✔ 已删除临时测试账号');
    } catch (error) {
      console.error('清理账号失败:', error);
    }
    if (serverLog) console.log('\n--- 服务日志 ---\n' + serverLog);
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项断言失败`);
    process.exit(1);
  }
  console.log('\n✅ 全部冒烟测试通过');
}

main().catch((error) => {
  console.error('\n❌ 冒烟测试异常:', error);
  process.exit(1);
});
