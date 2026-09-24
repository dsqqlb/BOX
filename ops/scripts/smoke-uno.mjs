#!/usr/bin/env node
/**
 * UNO 房间端到端冒烟测试（真起服务、真 WebSocket、真打完一局）。
 *
 *   1. 用临时端口拉起 server/index.js（生产模式），并把房间回收阈值调小，方便验证回收；
 *   2. 建 4 个临时账号：3 个有 uno 权限、1 个没有（验证升级被拒 403）；
 *   3. 建房 → 加入 → 加机器人 → 开局 → 打完整局 → 再来一局 → 解散房间；
 *   4. 过程中验证：房间号格式、大厅列表、权限与非法操作被拒、
 *      别人手牌不下发（隐私）、各客户端看到的状态一致、牌张守恒、
 *      思考超时托管、掉线与重新加入收回座位、闲置回收、房主解散。
 *
 * 用法：
 *   node ops/scripts/smoke-uno.mjs
 *   node ops/scripts/smoke-uno.mjs --keep          # 失败时保留服务进程，方便排查
 * 失败时打印具体断言，退出码非 0。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(codeRoot, 'node_modules', 'ws'));

const PORT = 19879;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_BASE = `ws://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes('--keep');
const OUT = process.env.TEMP ? path.join(process.env.TEMP, 'uno-smoke-report.txt') : '';

const THINK_SECONDS = 10;
const shortTtl = {
  UNO_ROOM_WAITING_TTL_MS: '4000',
  UNO_ROOM_EMPTY_TTL_MS: '4000',
  UNO_ROOM_PLAYING_TTL_MS: '600000',
  UNO_ROOM_SWEEP_MS: '700',
};

process.env.DATABASE_URL = 'file:' + path.join(projectRoot, 'resources', 'data', 'box.sqlite').replace(/\\/g, '/');
const { PrismaClient } = require(path.join(codeRoot, 'node_modules', '@prisma', 'client'));

const USERS = [
  { username: 'uno_smoke_a', password: 'uno-smoke-a-1234', permissions: ['uno'] },
  { username: 'uno_smoke_b', password: 'uno-smoke-b-1234', permissions: ['uno'] },
  { username: 'uno_smoke_c', password: 'uno-smoke-c-1234', permissions: ['uno'] },
  { username: 'uno_smoke_d', password: 'uno-smoke-d-1234', permissions: ['savings-tracker'] },
];

const checks = [];
const lines = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  lines.push(`  [${ok ? 'OK' : 'FAIL'}] ${name}${ok ? '' : ` → ${detail}`}`);
}
function log(text) { lines.push(text); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function seedAccounts() {
  const prisma = new PrismaClient();
  try {
    for (const user of USERS) {
      await prisma.user.deleteMany({ where: { username: user.username } });
      const created = await prisma.user.create({ data: { username: user.username, passwordHash: hashPassword(user.password) } });
      for (const permission of user.permissions) {
        await prisma.userPermission.create({ data: { userId: created.id, permission } });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function removeAccounts() {
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({ where: { username: { in: USERS.map((user) => user.username) } } });
    await prisma.$executeRawUnsafe("DELETE FROM LoginRecord WHERE username LIKE 'uno_smoke_%'");
  } finally {
    await prisma.$disconnect();
  }
}

function startServer() {
  const child = spawn(process.execPath, ['code/server/index.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT), ...shortTtl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => output.push(chunk.toString('utf8')));
  return { child, output };
}

async function waitReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      return response.status;
    } catch { /* 还没起来 */ }
    await sleep(500);
  }
  return null;
}

async function login(username, password) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ username, password }).toString(),
  });
  return { status: response.status, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
}

async function api(pathname, cookie, options = {}) {
  const headers = { Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  if (options.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: response.status, text, body };
}

async function waitUntil(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  if (predicate()) return true;
  throw new Error(`等待超时：${label}`);
}

/** 需要发异步请求的等待（比如反复查大厅列表）。 */
async function waitForAsync(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(200);
  }
  log(`  注意：${label} 在 ${Math.round(timeoutMs / 1000)} 秒内没有观察到`);
  return false;
}

async function expectStatus(url, cookie, status, label) {
  const response = await fetch(`${BASE}${url}`, { headers: { Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) } });
  check(label, response.status === status, `期望 ${status}，实际 ${response.status}`);
  return response.status;
}

class UnoClient {
  constructor(label, cookie) {
    this.label = label;
    this.cookie = cookie;
    this.socket = null;
    this.state = null;
    this.errors = [];
    this.closed = null;
    this.paused = false;
    this.stateCount = 0;
  }

  async connect() {
    const socket = new WebSocket(`${WS_BASE}/ws?uno=1`, { headers: { Cookie: this.cookie, Origin: BASE } });
    this.socket = socket;
    socket.on('message', (data) => {
      let message = null;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === 'ROOM_STATE') {
        this.state = message.payload;
        this.stateCount += 1;
      } else if (message.type === 'ERROR') {
        this.errors.push(message.payload?.message || '未命名的错误');
      } else if (message.type === 'ROOM_CLOSED') {
        this.closed = message.payload;
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${this.label} 连接超时`)), 6000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (error) => { clearTimeout(timer); reject(new Error(`${this.label} 连接失败：${error?.message || error}`)); });
      socket.once('unexpected-response', (request, response) => {
        clearTimeout(timer);
        reject(new Error(`${this.label} 升级被拒：HTTP ${response.statusCode}`));
        response.resume();
      });
    });
    return this;
  }

  send(type, payload = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, payload }));
  }

  close() {
    try { this.socket?.close(); } catch { /* 忽略 */ }
    this.socket = null;
  }

  /** 记下当前状态快照（用于前后对比）。 */
  snapshot() {
    return {
      seq: this.state?.seq ?? null,
      seat: this.state?.seat ?? null,
      phase: this.state?.phase ?? null,
      handIds: (this.state?.game?.hand || []).map((card) => card.id).sort(),
      topId: this.state?.game?.top?.id ?? null,
    };
  }

  waitFor(predicate, timeout = 8000, label = '') {
    return waitUntil(() => predicate(this), timeout, `${this.label}：${label}`);
  }
}

function pickColor(hand) {
  const counts = {};
  for (const card of hand) {
    if (card.color === 'wild') continue;
    counts[card.color] = (counts[card.color] || 0) + 1;
  }
  return Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] || 'red';
}

/** 按服务端给的合法动作，替真人客户端做一个动作；返回动作描述或 null（现在不该他动）。 */
function actAsHuman(client) {
  const state = client.state;
  const game = state?.game;
  if (!game || state.phase !== 'playing') return null;
  const seatInfo = state.seats?.[state.seat];
  if (!seatInfo || seatInfo.autoPiloted || seatInfo.isBot) return null;

  const me = game.players.find((player) => player.seat === state.seat);

  // 剩两张牌时先喊 UNO（forgetUno 的客户端故意不喊，用来验证「忘喊被举报」）。
  if (!client.forgetUno && me && me.handCount === 2 && !me.saidUno) {
    client.send('CALL_UNO');
    return `${client.label} 喊 UNO`;
  }

  if (game.awaitColorSeat === state.seat) {
    const color = pickColor(game.hand);
    client.send('CHOOSE_COLOR', { color });
    return `${client.label} 选色 ${color}`;
  }
  if (game.turnSeat !== state.seat) return null;

  const legal = game.legal || {};
  if (legal.playable?.length) {
    const playable = game.hand.filter((card) => legal.playable.includes(card.id));
    const card = playable.find((item) => item.kind === 'number') || playable[0];
    client.send('PLAY_CARD', { cardId: card.id, ...(card.color === 'wild' ? { color: pickColor(game.hand) } : {}) });
    return `${client.label} 出 ${card.face}`;
  }
  if (legal.canDraw) {
    client.send('DRAW_CARD');
    return `${client.label} 抓牌`;
  }
  if (legal.canPass) {
    client.send('PASS');
    return `${client.label} 过牌`;
  }
  return null;
}

function actingSeatOf(state) {
  const game = state?.game;
  if (!game || state.phase !== 'playing') return null;
  return game.awaitColorSeat !== null ? game.awaitColorSeat : game.turnSeat;
}

function conservationOk(state) {
  const game = state?.game;
  if (!game) return false;
  const hands = game.players.reduce((sum, player) => sum + player.handCount, 0);
  return hands + game.drawPileCount + game.discardCount === 108;
}

/** 一边推进（替未托管的真人按合法动作出手），一边等条件成立。 */
async function driveWhile(predicate, { timeout, humans }) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    const state = humans.find((client) => client.state)?.state;
    const seatToAct = actingSeatOf(state);
    const seatInfo = seatToAct === null ? null : state?.seats?.[seatToAct];
    if (seatInfo && !seatInfo.isBot && !seatInfo.autoPiloted) {
      const client = humans.find((item) => item.state?.seat === seatToAct && !item.paused);
      if (client) actAsHuman(client);
    }
    await sleep(80);
  }
  return predicate();
}

(async () => {
  let server = null;
  const clients = [];
  try {
    await seedAccounts();
    server = startServer();
    const ready = await waitReady(60000);
    if (ready === null) throw new Error(`服务启动超时：\n${server.output.join('').slice(-2000)}`);
    log(`服务已就绪（探活状态码 ${ready}，房间回收阈值已调小）`);

    const loginA = await login(USERS[0].username, USERS[0].password);
    const loginB = await login(USERS[1].username, USERS[1].password);
    const loginC = await login(USERS[2].username, USERS[2].password);
    const loginD = await login(USERS[3].username, USERS[3].password);
    check('四个临时账号都能登录', [loginA, loginB, loginC, loginD].every((item) => item.status === 303 && item.cookie));

    await expectStatus('/api/uno/rooms', '', 401, '未登录访问大厅被拒 401');
    await expectStatus('/api/uno/rooms', loginD.cookie, 403, '无 uno 权限访问大厅被拒 403');
    await expectStatus('/api/uno/catalog', loginD.cookie, 403, '无 uno 权限访问牌库目录被拒 403');

    const catalog = await api('/api/uno/catalog', loginA.cookie);
    check('GET /api/uno/catalog 返回牌组目录',
      catalog.status === 200 && catalog.body?.kinds?.length === 6 && catalog.body?.houseRules?.length === 6 && catalog.body?.colors?.length === 4,
      `HTTP ${catalog.status} kinds=${catalog.body?.kinds?.length} rules=${catalog.body?.houseRules?.length}`);
    check('目录带建房所需的选项与人数上限',
      catalog.body?.thinkOptions?.length === 4 && catalog.body?.limits?.minSeats === 2 && catalog.body?.limits?.maxSeats === 4,
      JSON.stringify(catalog.body?.limits));

    let blockedStatus = 0;
    try {
      await new UnoClient('丁', loginD.cookie).connect();
    } catch (error) {
      blockedStatus = Number((String(error.message).match(/HTTP (\d+)/) || [])[1] || 0);
    }
    check('无 uno 权限的账户连 /ws?uno=1 被拒 403', blockedStatus === 403, `实际 ${blockedStatus}`);

    const host = await new UnoClient('甲', loginA.cookie).connect();
    const guestB = await new UnoClient('乙', loginB.cookie).connect();
    const guestC = await new UnoClient('丙', loginC.cookie).connect();
    clients.push(host, guestB, guestC);

    host.send('CREATE_ROOM', { seats: 4, thinkSeconds: THINK_SECONDS, rules: { stackDraw: true, callUno: true, wild4Strict: false } });
    await host.waitFor((client) => client.state?.phase === 'waiting', 6000, '建房并收到等待中状态');
    const roomId = host.state.roomId;
    check('房间号是 6 位数字', /^\d{6}$/.test(String(roomId)), String(roomId));
    check('建房者坐在 0 号位且是房主', host.state.seat === 0 && host.state.isHost === true, `seat=${host.state.seat} isHost=${host.state.isHost}`);
    check('房主设置的房规与思考时间生效',
      host.state.settings.rules.stackDraw === true && host.state.settings.thinkSeconds === THINK_SECONDS,
      JSON.stringify(host.state.settings));
    check('只有一个人时不能开局', host.state.canStart === false);

    const lobby = await api('/api/uno/rooms', loginA.cookie);
    const lobbyRoom = (lobby.body?.rooms || []).find((room) => room.roomId === roomId);
    check('大厅列表能查到刚建的房间', Boolean(lobbyRoom), JSON.stringify(lobby.body));
    check('大厅列表不含手牌等对局信息',
      Boolean(lobbyRoom) && !('game' in lobbyRoom) && !('hands' in lobbyRoom) && typeof lobbyRoom.seatCount === 'number');
    check('大厅列表人数统计正确',
      lobbyRoom?.seatedCount === 1 && lobbyRoom?.humanCount === 1 && lobbyRoom?.botCount === 0,
      JSON.stringify(lobbyRoom));

    guestB.send('JOIN_ROOM', { roomId });
    await guestB.waitFor((client) => client.state?.roomId === roomId, 6000, '乙加入房间');
    check('乙加入后坐在 1 号位', guestB.state.seat === 1, `seat=${guestB.state.seat}`);
    guestC.send('JOIN_ROOM', { roomId });
    await guestC.waitFor((client) => client.state?.roomId === roomId, 6000, '丙加入房间');
    check('丙加入后坐在 2 号位', guestC.state.seat === 2, `seat=${guestC.state.seat}`);
    await host.waitFor((client) => client.state.seats.filter((seat) => seat.occupied).length === 3, 6000, '房主看到三个人');
    check('房主视角看到三名真人玩家', host.state.seats.filter((seat) => seat.username).length === 3);

    const errorsBeforeBadJoin = guestB.errors.length;
    guestB.send('JOIN_ROOM', { roomId: '000000' });
    await waitUntil(() => guestB.errors.length > errorsBeforeBadJoin, 4000, '加入不存在的房间应报错');
    check('加入不存在的房间会报错', /不存在|回收/.test(guestB.errors.at(-1) || ''), guestB.errors.at(-1));

    // 第一局先不请机器人：只用三位真人，这样赢家必然是真人，
    // 「有人剩一张牌没喊 UNO」的举报窗口就一定会出现（机器人总是会喊 UNO）。
    const errorsBeforeStart = guestB.errors.length;
    guestB.send('START_GAME');
    await waitUntil(() => guestB.errors.length > errorsBeforeStart, 4000, '非房主开局应报错');
    check('非房主开始牌局被拒', /只有房主/.test(guestB.errors.at(-1) || ''), guestB.errors.at(-1));

    host.send('START_GAME');
    await host.waitFor((client) => client.state.phase === 'playing', 8000, '开局');
    check('开局后每人 7 张手牌',
      host.state.game.hand.length === 7 && host.state.game.players.every((player) => player.handCount === 7),
      JSON.stringify(host.state.game.players.map((player) => player.handCount)));
    const roundOnePlayers = host.state.game.players.length;
    check('开局翻出一张底牌，牌堆剩 108 − 7×人数 − 1 张',
      host.state.game.discardCount === 1 && host.state.game.drawPileCount === 108 - roundOnePlayers * 7 - 1 && Boolean(host.state.game.top),
      `人数 ${roundOnePlayers}，牌堆 ${host.state.game.drawPileCount} 弃牌 ${host.state.game.discardCount}`);
    check('开局事件里带发牌动画需要的 deal 事件',
      host.state.events.some((event) => event.kind === 'deal'), JSON.stringify(host.state.events.map((event) => event.kind)));
    check('牌张守恒（手牌 + 牌堆 + 弃牌堆 = 108）', conservationOk(host.state));

    await guestB.waitFor((client) => client.state.phase === 'playing', 8000, '乙收到开局状态');
    await guestC.waitFor((client) => client.state.phase === 'playing', 8000, '丙收到开局状态');
    check('三个人拿到的牌互不重复（自己视角）',
      guestB.state.game.hand.every((card) => !host.state.game.hand.some((mine) => mine.id === card.id))
      && guestC.state.game.hand.every((card) => !host.state.game.hand.some((mine) => mine.id === card.id)));
    check('服务端不下发别人的手牌（只有张数）',
      guestB.state.game.players.every((player) => !('hand' in player) && typeof player.handCount === 'number'));
    check('快照里没有牌堆数组、只有数量',
      !('drawPile' in guestB.state.game) && !('discardPile' in guestB.state.game));
    check('自己看到的张数与座位信息一致',
      guestC.state.game.hand.length === guestC.state.game.players.find((player) => player.seat === 2)?.handCount,
      `${guestC.state.game.hand.length}`);

    const humans = [host, guestB, guestC];
    const turnSeat = actingSeatOf(host.state);
    const outsider = humans.find((client) => client.state.seat !== turnSeat);
    const errorsBeforeTurn = outsider.errors.length;
    outsider.send('PLAY_CARD', { cardId: outsider.state.game.hand[0]?.id });
    await waitUntil(() => outsider.errors.length > errorsBeforeTurn, 4000, '越权出牌应报错');
    check('不是自己行动轮时出牌被拒', /不是你操作|还没轮到/.test(outsider.errors.at(-1) || ''), outsider.errors.at(-1));

    const actor = humans.find((client) => client.state.seat === turnSeat);
    if (actor) {
      const illegal = actor.state.game.hand.find((card) => !actor.state.game.legal.playable.includes(card.id) && card.color !== 'wild');
      if (illegal) {
        const errorsBeforeIllegal = actor.errors.length;
        actor.send('PLAY_CARD', { cardId: illegal.id });
        await waitUntil(() => actor.errors.length > errorsBeforeIllegal, 4000, '不能出的牌应报错');
        check('不能出的牌被服务端拒绝', /不能出|现在不能/.test(actor.errors.at(-1) || ''), actor.errors.at(-1));
      } else {
        check('（本局起手牌里没有可用于验证的非法牌，跳过该项）', true);
      }
    }

    const richClient = humans.find((client) => client.state.game.hand.length > 2);
    if (richClient) {
      const errorsBeforeUno = richClient.errors.length;
      richClient.send('CALL_UNO');
      await waitUntil(() => richClient.errors.length > errorsBeforeUno, 4000, '手牌过多时喊 UNO 应报错');
      check('手牌超过两张时喊 UNO 被拒', /三张以上/.test(richClient.errors.at(-1) || ''), richClient.errors.at(-1));
    }

    const errorsBeforeChallenge = host.errors.length;
    host.send('CHALLENGE_UNO', { targetSeat: 99 });
    await waitUntil(() => host.errors.length > errorsBeforeChallenge, 4000, '举报不存在的座位应报错');
    check('举报不存在的座位被拒', /座位不存在/.test(host.errors.at(-1) || ''), host.errors.at(-1));

    // ---------- 打完整局 ----------
    for (const client of humans) client.forgetUno = true; // 三个真人都不喊 UNO，用来验证「忘喊被举报」
    let steps = 0;
    let sawPendingDraw = false;
    let sawPenalty = false;
    let sawChallenge = false;
    let sawForgotPenalty = false;
    let sawFalseChallenge = false;
    let challengeTargetGain = 0;
    while (host.state.phase === 'playing' && steps < 800) {
      const snapshot = host.state;
      if (!conservationOk(snapshot)) throw new Error(`牌张不守恒：手牌 ${snapshot.game.players.map((player) => player.handCount).join('/')}、牌堆 ${snapshot.game.drawPileCount}、弃牌 ${snapshot.game.discardCount}`);
      if (snapshot.game.pendingDraw > 0) sawPendingDraw = true;
      const gameLog = snapshot.game.log || [];
      if (gameLog.some((entry) => /罚摸|接不住/.test(entry.text))) sawPenalty = true;
      if (gameLog.some((entry) => /忘了喊 UNO/.test(entry.text))) sawForgotPenalty = true;
      if (gameLog.some((entry) => /举报失败/.test(entry.text))) sawFalseChallenge = true;

      // 只要有人忘喊 UNO（待举报），就由另一个真人立刻举报——不管现在轮到谁，
      // 因为「跳过牌」可能让忘喊的人下一手又轮到自己，中间没人有机会举报。
      const forgetful = snapshot.game.players.find((player) => player.unoPending);
      // 只举报一次：验证机制即可，反复举报会不断罚牌、把这一局拖得很长。
      if (forgetful && !sawChallenge) {
        const challenger = humans.find((item) => item.state?.seat !== forgetful.seat && item.socket);
        if (challenger) {
          const before = forgetful.handCount;
          challenger.send('CHALLENGE_UNO', { targetSeat: forgetful.seat });
          sawChallenge = true;
          steps += 1;
          await waitUntil(() => host.state.seq !== snapshot.seq, 8000, '举报之后应该收到新状态');
          const after = host.state.game.players.find((player) => player.seat === forgetful.seat)?.handCount ?? before;
          if (after > before) challengeTargetGain = after - before;
          continue;
        }
      }

      const seatToAct = actingSeatOf(snapshot);
      const seatInfo = seatToAct === null ? null : snapshot.seats[seatToAct];
      if (!seatInfo || seatInfo.isBot || seatInfo.autoPiloted) {
        await sleep(120); // 机器人 / 托管由服务端驱动
        continue;
      }
      const client = humans.find((item) => item.state.seat === seatToAct);
      if (!client) { await sleep(120); continue; }

      if (!actAsHuman(client)) { await sleep(120); continue; }
      steps += 1;
      await waitUntil(() => host.state.seq !== snapshot.seq, 8000, '动作之后应该收到新状态');
    }
    check('整局能在有限步数内打完', host.state.phase === 'roundOver', `用了 ${steps} 步，阶段 ${host.state.phase}，seq ${host.state.seq}`);
    check('对局过程中牌张始终守恒', conservationOk(host.state));
    check('房规「罚牌叠加」在实战中生效过', sawPendingDraw, '');
    check('对局过程中出现过罚摸', sawPenalty, '');
    check('忘喊 UNO 被举报后确实罚摸两张', sawChallenge && challengeTargetGain === 2, `是否举报过=${sawChallenge}，目标摸了 ${challengeTargetGain} 张`);
    check('第一局里没有出现「诬告」', sawFalseChallenge === false);
    if (sawForgotPenalty) log('  说明：同时观察到机器人/日志侧的「忘喊 UNO 罚摸」记录');

    await guestB.waitFor((client) => client.state.phase === 'roundOver', 8000, '乙也收到局终状态');
    const winnerSeat = host.state.game.winner;
    check('局终有明确赢家，且赢家手牌为 0',
      Number.isInteger(winnerSeat) && host.state.game.players.find((player) => player.seat === winnerSeat)?.handCount === 0,
      `winner=${winnerSeat}`);
    check('三个客户端对赢家的判断一致', humans.every((client) => client.state.game.winner === winnerSeat));
    check('局终后不再有思考倒计时', host.state.turnDeadline === null);
    const converged = await waitUntil(() => {
      const seqs = humans.map((client) => client.state.seq);
      return new Set(seqs).size === 1;
    }, 5000, '三个客户端收敛到同一版本').then(() => true).catch(() => false);
    check('三个客户端最终看到同一版本（seq 一致）', converged, humans.map((client) => client.state.seq).join('/'));

    // ---------- 加机器人（第二局开始前） ----------
    host.send('ADD_BOT', { level: 'hard' });
    await host.waitFor((client) => client.state.seats.some((seat) => seat.isBot), 6000, '添加机器人');
    check('房主可以添加机器人', host.state.seats.some((seat) => seat.isBot) && Boolean(host.state.seats.find((seat) => seat.isBot).displayName), JSON.stringify(host.state.seats.filter((seat) => seat.isBot)));

    const errorsBeforeBot = guestB.errors.length;
    guestB.send('ADD_BOT', { level: 'easy' });
    await waitUntil(() => guestB.errors.length > errorsBeforeBot, 4000, '非房主加机器人应报错');
    check('非房主添加机器人被拒', /只有房主/.test(guestB.errors.at(-1) || ''), guestB.errors.at(-1));

    // ---------- 再来一局 ----------
    const errorsBeforeRematch = guestB.errors.length;
    guestB.send('REMATCH');
    await waitUntil(() => guestB.errors.length > errorsBeforeRematch, 4000, '非房主再来一局应报错');
    check('非房主开始新一局被拒', /只有房主/.test(guestB.errors.at(-1) || ''), guestB.errors.at(-1));

    host.send('REMATCH');
    await host.waitFor((client) => client.state.phase === 'playing' && client.state.roundNumber === 2, 8000, '再来一局');
    check('房主点再来一局后重新发牌（每人 7 张）',
      host.state.game.hand.length === 7 && host.state.game.players.every((player) => player.handCount === 7),
      JSON.stringify(host.state.game.players.map((player) => player.handCount)));
    check('新一局重新发牌且局数 +1',
      host.state.game.players.every((player) => player.handCount === 7)
      && host.state.game.drawPileCount === 108 - host.state.game.players.length * 7 - 1
      && host.state.game.discardCount === 1
      && host.state.roundNumber === 2,
      `人数 ${host.state.game.players.length}，牌堆 ${host.state.game.drawPileCount}，局数 ${host.state.roundNumber}`);
    check('新一局开始前托管状态被清空', host.state.seats.every((seat) => seat.autoPiloted === false));

    // ---------- 手动托管 / 收回 ----------
    const errorsBeforeManual = guestB.errors.length;
    guestB.send('SET_AUTO_PILOT', { on: true });
    await guestB.waitFor((client) => client.state.seats[1].autoPiloted === true, 5000, '手动托管生效');
    check('玩家可以主动点托管（立即交给机器人）', guestB.state.seats[1].autoPiloted === true);
    guestB.send('SET_AUTO_PILOT', { on: false });
    await guestB.waitFor((client) => client.state.seats[1].autoPiloted === false, 5000, '收回控制权');
    check('玩家可以点收回，立即拿回操作权', guestB.state.seats[1].autoPiloted === false);
    check('托管开关操作不产生错误', guestB.errors.length === errorsBeforeManual, guestB.errors.at(-1));

    // ---------- 思考超时 → 机器人托管 ----------
    guestC.paused = true; // 丙故意不出手，等超时
    const pilotedAt = Date.now();
    const piloted = await driveWhile(() => guestC.state?.seats?.[2]?.autoPiloted === true, { timeout: THINK_SECONDS * 1000 + 30000, humans });
    check(`思考超时（${THINK_SECONDS} 秒）后由机器人托管`, piloted, `等待 ${Math.round((Date.now() - pilotedAt) / 1000)} 秒后仍未托管`);
    check('托管后对局仍在继续', ['playing', 'roundOver'].includes(guestC.state.phase), guestC.state.phase);
    guestC.paused = false;
    guestC.send('SET_AUTO_PILOT', { on: false });
    await guestC.waitFor((client) => client.state.seats[2].autoPiloted === false, 5000, '丙收回控制权');
    check('托管之后可以立刻收回控制权', guestC.state.seats[2].autoPiloted === false);

    // ---------- 掉线 + 重新加入：座位与手牌归属保留 ----------
    const beforeDrop = guestC.snapshot();
    guestC.close();
    await host.waitFor((client) => client.state.seats[2].connected === false, 8000, '房主看到丙掉线');
    check('掉线后座位仍归原账户所有',
      host.state.seats[2].username === USERS[2].username && host.state.seats[2].occupied === true,
      JSON.stringify(host.state.seats[2]));

    const back = await new UnoClient('丙(重连)', loginC.cookie).connect();
    clients.push(back);
    back.send('JOIN_ROOM', { roomId });
    await back.waitFor((client) => client.state?.roomId === roomId, 8000, '重新加入房间');
    check('重新加入后回到原来的 2 号座位', back.state.seat === 2, `seat=${back.state.seat}`);
    check('重新加入后自动收回控制权（解除托管）',
      back.state.seats[2].autoPiloted === false && back.state.seats[2].connected === true,
      JSON.stringify(back.state.seats[2]));
    check('重新加入后能拿回自己的手牌视角',
      back.state.game === null
      || back.state.game.hand.length === back.state.game.players.find((player) => player.seat === 2)?.handCount,
      `手牌 ${back.state.game?.hand?.length}`);
    log(`  说明：掉线前自己拿着 ${beforeDrop.handIds.length} 张牌，重连后 ${back.snapshot().handIds.length} 张`
      + '（重连瞬间若正好被托管代打过，张数可能变化，这属于预期）');

    const humansAfterRejoin = [host, guestB, back];
    for (const client of humansAfterRejoin) client.forgetUno = false; // 第二局起正常喊 UNO
    const roundTwoDone = await driveWhile(() => host.state.phase === 'roundOver', { timeout: 120000, humans: humansAfterRejoin });
    check('第 2 局也能正常打完', roundTwoDone, `阶段 ${host.state.phase}`);
    check('第 2 局里出现过喊 UNO（真人 + 机器人混桌）',
      (host.state.game?.log || []).some((entry) => /喊了 UNO/.test(entry.text)),
      JSON.stringify((host.state.game?.log || []).slice(-6).map((entry) => entry.text)));

    // ---------- 解散与回收 ----------
    const errorsBeforeDelete = guestB.errors.length;
    guestB.send('DELETE_ROOM');
    await waitUntil(() => guestB.errors.length > errorsBeforeDelete, 4000, '非房主解散房间应报错');
    check('非房主解散房间被拒', /只有房主/.test(guestB.errors.at(-1) || ''), guestB.errors.at(-1));

    host.send('DELETE_ROOM');
    await host.waitFor((client) => Boolean(client.closed), 6000, '收到房间解散通知');
    check('房主解散房间后客户端收到 ROOM_CLOSED',
      host.closed?.roomId === roomId && /解散/.test(host.closed?.reason || ''),
      JSON.stringify(host.closed));
    await guestB.waitFor((client) => Boolean(client.closed), 6000, '乙也收到解散通知');
    check('其他玩家同样收到 ROOM_CLOSED', Boolean(guestB.closed));
    const lobbyAfterDelete = await api('/api/uno/rooms', loginA.cookie);
    check('解散后大厅列表里没有这个房间',
      !(lobbyAfterDelete.body?.rooms || []).some((room) => room.roomId === roomId));

    // 等待中的房间长时间没人进入 → 自动回收（测试把阈值调到了 4 秒）
    const lonely = await new UnoClient('甲(新)', loginA.cookie).connect();
    clients.push(lonely);
    lonely.send('CREATE_ROOM', { seats: 2, thinkSeconds: 0 });
    await lonely.waitFor((client) => client.state?.phase === 'waiting', 6000, '再建一个房间');
    const lonelyId = lonely.state.roomId;
    await lonely.waitFor((client) => Boolean(client.closed), 25000, '等待中的空房间被回收');
    check('等待中一直没人进入的房间会被自动回收', /没人进入/.test(lonely.closed?.reason || ''), JSON.stringify(lonely.closed));
    const lobbyAfterReclaim = await api('/api/uno/rooms', loginA.cookie);
    check('被回收的房间从大厅列表消失',
      !(lobbyAfterReclaim.body?.rooms || []).some((room) => room.roomId === lonelyId));

    // 全员掉线 → 房间回收（建一个房间，两人加入后一起断开）
    const emptyHost = await new UnoClient('甲(2)', loginA.cookie).connect();
    const emptyGuest = await new UnoClient('乙(2)', loginB.cookie).connect();
    clients.push(emptyHost, emptyGuest);
    emptyHost.send('CREATE_ROOM', { seats: 2, thinkSeconds: 0 });
    await emptyHost.waitFor((client) => client.state?.phase === 'waiting', 6000, '建一个用于测试掉线回收的房间');
    const emptyRoomId = emptyHost.state.roomId;
    emptyGuest.send('JOIN_ROOM', { roomId: emptyRoomId });
    await emptyGuest.waitFor((client) => client.state?.roomId === emptyRoomId, 6000, '第二个人加入');
    emptyHost.close();
    emptyGuest.close();
    const goneAfterEmpty = await waitForAsync(async () => {
      const rooms = await api('/api/uno/rooms', loginA.cookie);
      return !(rooms.body?.rooms || []).some((room) => room.roomId === emptyRoomId);
    }, 25000, '全员掉线的房间被回收');
    check('全员掉线的房间会被自动回收', goneAfterEmpty, `房间号 ${emptyRoomId}`);
  } catch (error) {
    check('脚本执行未抛异常', false, error?.message || String(error));
  } finally {
    for (const client of clients) client.close();
    if (server && !KEEP) {
      server.child.kill();
      await sleep(1000);
      log('服务进程已关闭');
    }
    try {
      await removeAccounts();
      log('临时账号与登录记录已清理');
    } catch (error) {
      log(`清理临时账号失败：${error?.message || error}`);
    }
    const failed = checks.filter((item) => !item.ok);
    const report = [
      'UNO 房间端到端冒烟测试',
      '='.repeat(60),
      ...lines,
      '',
      failed.length ? `❌ ${failed.length} 项未通过` : '✅ 全部通过',
      `RESULT: ${failed.length ? 'FAIL' : 'PASS'} (${checks.filter((item) => item.ok).length}/${checks.length})`,
    ].join('\n');
    console.log(report);
    if (OUT) fs.writeFileSync(OUT, report, 'utf8');
    process.exit(failed.length ? 1 : 0);
  }
})();