#!/usr/bin/env node
/**
 * 刮刮乐阶段 1 冒烟测试（端到端）：
 *   1. 用固定端口拉起 server/index.js（生产模式，静态产物缺失也能测接口）；
 *   2. 在 SQLite 里临时创建两个测试账号：一个带 scratch-cards 权限、一个不带；
 *   3. HTTP 验证：买票扣钱 → 余额与德州扑克筹码一致（互通）→ 未刮开的票不下发答案
 *      → 桌面坐标持久化 → 桌面容量上限 → 权限与登录网关 → 流水；
 *   4. 清理测试账号（连带级联删除刮刮乐与筹码数据）并关闭服务。
 *
 * 用法：node ops/scripts/smoke-scratch.mjs
 * 失败时打印具体断言，退出码非 0。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const PORT = 19877;
const BASE = `http://localhost:${PORT}`;
const USERS = [
  // 甲：既能进刮刮乐，也能进德州扑克——「互通」那条断言要读 /api/holdem/account，所以两个权限都得有。
  { username: 'scratch_smoke_a', password: 'smoke-password-a-1234', permissions: ['scratch-cards', 'texas-holdem'] },
  // 乙：注意本项目要求每个账号至少有一个权限（auth.js 会拒绝空权限账户并让服务拒绝启动），
  // 所以「无权访问刮刮乐」的账号给的是别的工具权限，而不是空数组。
  { username: 'scratch_smoke_b', password: 'smoke-password-b-1234', permissions: ['savings-tracker'] },
  // 丙：专用于「资源不足 / 未解锁」这类边界（全新账号，0 纸屑）。
  { username: 'scratch_smoke_c', password: 'smoke-password-c-1234', permissions: ['scratch-cards'] },
];
/** 与 config.js 的 HOLDEM_STARTING_CHIPS 保持一致；改过环境变量时这里要跟着改。 */
const STARTING_CHIPS = 10000;
const TABLE_SLOTS = 12;

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
      update: {
        passwordHash,
        sessionRevision: { increment: 1 },
        permissions: { deleteMany: {}, create: permissions.map((permission) => ({ permission })) },
      },
      create: {
        username,
        passwordHash,
        sessionRevision: 0,
        permissions: { create: permissions.map((permission) => ({ permission })) },
      },
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

/** 调接口：写操作带上同源 Origin，cookie 由调用方决定传不传。 */
async function api(pathname, { method = 'GET', cookie = null, body = null, origin = true } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (origin) headers.Origin = BASE;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}

/* ── 复用小工具 ── */

const ticketUrl = (id, action = '') => `/api/scratch/tickets/${encodeURIComponent(id)}${action ? `/${action}` : ''}`;

async function buyTicketOf(kind, cookie) {
  const result = await api('/api/scratch/tickets', { method: 'POST', cookie, body: { kind } });
  return result.status === 201 ? result.body.ticket : null;
}

async function revealTicketOf(id, cookie, ratio = 1) {
  await api(ticketUrl(id, 'reveal'), { method: 'POST', cookie, body: { scratchRatio: ratio } });
}

async function shredTicketOf(id, cookie) {
  return api(ticketUrl(id, 'shred'), { method: 'POST', cookie });
}

async function fetchTicket(id, cookie) {
  return (await api('/api/scratch/tickets', { cookie })).body?.tickets?.find((item) => item.id === id) || null;
}

/** 反复「买票 → 碎纸」把纸屑攒到目标值（碎纸机升过级的话每张产出更多）。 */
async function grindScraps(target, cookie, maxAttempts = 90) {
  let scraps = (await api('/api/scratch/profile', { cookie })).body?.scraps || 0;
  for (let attempt = 0; attempt < maxAttempts && scraps < target; attempt += 1) {
    const ticket = await buyTicketOf('find-word', cookie);
    if (!ticket) break;
    const shredded = await shredTicketOf(ticket.id, cookie);
    scraps = shredded.body?.scraps ?? scraps;
  }
  return scraps;
}

/** 反复「买票 → 刮开」直到造出一张中奖票；没中的顺手碎掉，避免占满桌面。 */
async function huntWinner(cookie, maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ticket = await buyTicketOf('find-word', cookie);
    if (!ticket) return null;
    await revealTicketOf(ticket.id, cookie);
    const settled = await fetchTicket(ticket.id, cookie);
    if (settled?.outcome?.won) return settled;
    await shredTicketOf(ticket.id, cookie);
  }
  return null;
}

async function runHttpTests(cookies) {
  console.log('\n▶ 登录与权限网关');
  const anonymous = await api('/api/scratch/profile', { origin: false });
  check('未登录访问 /api/scratch/profile 返回 401', anonymous.status === 401, `实际 ${anonymous.status}`);
  const forbidden = await api('/api/scratch/profile', { cookie: cookies.b });
  check('无 scratch-cards 权限的账户返回 403', forbidden.status === 403, `实际 ${forbidden.status}`);

  console.log('\n▶ 账户总览与商店目录');
  const profile = await api('/api/scratch/profile', { cookie: cookies.a });
  check('账户总览可读', profile.status === 200, `实际 ${profile.status}`);
  check(`金钱等于初始筹码 ${STARTING_CHIPS}`, profile.body?.money === STARTING_CHIPS, `实际 ${profile.body?.money}`);
  check('纸屑初始为 0', profile.body?.scraps === 0, `实际 ${profile.body?.scraps}`);
  check(`桌面容量 ${TABLE_SLOTS} 且当前 0 张`, profile.body?.tableSlots === TABLE_SLOTS && profile.body?.usedSlots === 0, `实际 ${profile.body?.usedSlots}`);

  const catalog = await api('/api/scratch/catalog', { cookie: cookies.a });
  const tickets = catalog.body?.tickets || [];
  check('商店目录返回 6 种票（4 种开局 + 2 种待解锁）', tickets.length === 6, `实际 ${tickets.length}`);
  check('开局解锁 4 种、锁着 2 种', tickets.filter((ticket) => ticket.unlocked).length === 4 && tickets.filter((ticket) => !ticket.unlocked).length === 2, JSON.stringify(tickets.map((ticket) => `${ticket.key}:${ticket.unlocked}`)));
  check('所有票种配置校验通过', tickets.every((ticket) => Array.isArray(ticket.problems) && ticket.problems.length === 0), JSON.stringify(tickets.map((ticket) => ticket.problems)));
  check('票面标价与实际售价都有下发', tickets.every((ticket) => ticket.priceBase > 0 && ticket.price > 0), JSON.stringify(tickets.map((ticket) => `${ticket.priceBase}/${ticket.price}`)));
  check('回收率都在 0~1 之间（长期玩家是亏的）', tickets.every((ticket) => ticket.expectedReturn > 0 && ticket.expectedReturn < 1), JSON.stringify(tickets.map((ticket) => Number(ticket.expectedReturn).toFixed(3))));

  console.log('\n▶ 买票：事务扣钱 + 生成票面 + 落库');
  const bought = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'three-match' } });
  const firstTicket = bought.body?.ticket;
  check('买票返回 201', bought.status === 201, `实际 ${bought.status} ${JSON.stringify(bought.body)}`);
  check('票状态是 sealed', firstTicket?.status === 'sealed', firstTicket?.status);
  check('印刷层随票下发（格子内容就在涂层下面）', Boolean(firstTicket?.print?.cells?.length === 6), JSON.stringify(firstTicket?.print));
  check('结算还没下发（outcome 为 null）', firstTicket?.outcome === null, JSON.stringify(firstTicket?.outcome));
  check('票面 DTO 里没有 seed 字段', firstTicket ? !('seed' in firstTicket) : false);
  check('买票后余额扣掉票价 10', bought.body?.money === STARTING_CHIPS - 10, `实际 ${bought.body?.money}`);
  check('新票落在桌面坐标范围内', firstTicket?.posX >= 0 && firstTicket?.posX <= 100 && firstTicket?.posY >= 0 && firstTicket?.posY <= 100, `${firstTicket?.posX},${firstTicket?.posY}`);

  console.log('\n▶ 票面公布信息与结算分离（好运符号先公布中奖符号）');
  const luckyBuy = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'lucky-symbol' } });
  const luckyTicket = luckyBuy.body?.ticket;
  check('好运符号买票成功', luckyBuy.status === 201, `实际 ${luckyBuy.status}`);
  check('票面公布了中奖符号', typeof luckyTicket?.print?.legend?.symbol === 'string' && luckyTicket.print.legend.symbol.length > 0, JSON.stringify(luckyTicket?.print?.legend));
  check('印刷层里没有输赢字段', luckyTicket?.print ? (!('won' in luckyTicket.print) && !('prize' in luckyTicket.print)) : false, JSON.stringify(luckyTicket?.print));
  check('结算仍未下发（outcome 为 null）', luckyTicket?.outcome === null, JSON.stringify(luckyTicket?.outcome));

  console.log('\n▶ 互通验证：刮刮乐花掉的就是德州扑克那份筹码');
  const holdemAccount = await api('/api/holdem/account', { cookie: cookies.a });
  check('德州扑克账户可读', holdemAccount.status === 200, `实际 ${holdemAccount.status}`);
  check('德州扑克账户余额同步扣减', holdemAccount.body?.chips === STARTING_CHIPS - 30, `实际 ${holdemAccount.body?.chips}`);

  console.log('\n▶ 桌面坐标持久化');
  const patched = await api(`/api/scratch/tickets/${encodeURIComponent(firstTicket.id)}`, { method: 'PATCH', cookie: cookies.a, body: { posX: 42, posY: 33, z: 5 } });
  check('坐标写入返回 200', patched.status === 200, `实际 ${patched.status} ${JSON.stringify(patched.body)}`);
  const afterPatch = await api('/api/scratch/tickets', { cookie: cookies.a });
  // 列表是按 z 升序返回的，改过 z 之后这张票不一定还在第一位，所以按 id 找。
  const moved = (afterPatch.body?.tickets || []).find((item) => item.id === firstTicket.id);
  check('重新读取仍是新坐标', moved?.posX === 42 && moved?.posY === 33 && moved?.z === 5, `${moved?.posX},${moved?.posY},${moved?.z}`);
  const badPatch = await api(`/api/scratch/tickets/${encodeURIComponent(firstTicket.id)}`, { method: 'PATCH', cookie: cookies.a, body: { posX: 999 } });
  check('越界坐标被拒（400）', badPatch.status === 400, `实际 ${badPatch.status}`);

  console.log('\n▶ 边界与错误');
  const unknown = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'not-a-ticket' } });
  check('不存在的票种返回 404', unknown.status === 404, `实际 ${unknown.status}`);
  const crossOrigin = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'find-word' }, origin: false });
  check('缺少同源 Origin 的写操作返回 403', crossOrigin.status === 403, `实际 ${crossOrigin.status}`);

  // 桌上已经有 2 张（三连金 + 好运符号），继续买便宜的「找中奖」把桌面填满。
  let boughtCount = 2;
  let overflow = null;
  while (boughtCount < TABLE_SLOTS + 2) {
    const result = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'find-word' } });
    if (result.status !== 201) { overflow = result; break; }
    boughtCount += 1;
  }
  check(`一直买到桌面满（共 ${TABLE_SLOTS} 张）`, boughtCount === TABLE_SLOTS, `实际 ${boughtCount}`);
  check('超出桌面容量被挡下（409）', overflow?.status === 409, `实际 ${overflow?.status} ${JSON.stringify(overflow?.body)}`);

  const expectedMoney = STARTING_CHIPS - 10 - 20 - 5 * (TABLE_SLOTS - 2);
  const finalProfile = await api('/api/scratch/profile', { cookie: cookies.a });
  check('扣钱总额与票价一致', finalProfile.body?.money === expectedMoney, `期望 ${expectedMoney}，实际 ${finalProfile.body?.money}`);
  check(`桌面已用 ${TABLE_SLOTS} / ${TABLE_SLOTS}`, finalProfile.body?.usedSlots === TABLE_SLOTS, `实际 ${finalProfile.body?.usedSlots}`);
  check('统计里累计了购买次数', finalProfile.body?.stats?.purchased === TABLE_SLOTS, JSON.stringify(finalProfile.body?.stats));

  console.log('\n▶ 流水');
  const ledger = await api('/api/scratch/ledger', { cookie: cookies.a });
  const entries = ledger.body?.entries || [];
  check(`流水共 ${TABLE_SLOTS} 条（每次买票一条）`, entries.length === TABLE_SLOTS, `实际 ${entries.length}`);
  check('流水全部是买票且为负数', entries.every((entry) => entry.kind === 'scratch-buy' && entry.delta < 0), JSON.stringify(entries.map((entry) => entry.delta)));
  check('最新一条流水的余额快照正确', entries[0]?.balance === expectedMoney, `实际 ${entries[0]?.balance}`);

  console.log('\n▶ 刮开揭晓（结果在服务端定死，刮够了才下发）');
  const revealUrl = `/api/scratch/tickets/${encodeURIComponent(firstTicket.id)}/reveal`;
  const tooEarly = await api(revealUrl, { method: 'POST', cookie: cookies.a, body: { scratchRatio: 0.2 } });
  check('刮得不够时拒绝揭晓（409）', tooEarly.status === 409, `实际 ${tooEarly.status} ${JSON.stringify(tooEarly.body)}`);
  const badRatio = await api(revealUrl, { method: 'POST', cookie: cookies.a, body: { scratchRatio: 5 } });
  check('非法进度被拒（400）', badRatio.status === 400, `实际 ${badRatio.status}`);
  const unknownReveal = await api('/api/scratch/tickets/does-not-exist/reveal', { method: 'POST', cookie: cookies.a, body: { scratchRatio: 1 } });
  check('不存在的票返回 404', unknownReveal.status === 404, `实际 ${unknownReveal.status}`);

  const revealed = await api(revealUrl, { method: 'POST', cookie: cookies.a, body: { scratchRatio: 0.85 } });
  const revealedTicket = revealed.body?.ticket;
  check('刮够之后揭晓成功', revealed.status === 200 && revealed.body?.alreadyRevealed === false, `实际 ${revealed.status} ${JSON.stringify(revealed.body)}`);
  check('状态变成 scratched', revealedTicket?.status === 'scratched', revealedTicket?.status);
  check('结算这时才随票下发', Boolean(revealedTicket?.outcome), JSON.stringify(revealedTicket?.outcome));
  check(
    '印刷层与格子数一致',
    revealedTicket?.print?.rules === 'three-match'
      && revealedTicket?.print?.grid?.rows * revealedTicket?.print?.grid?.cols === revealedTicket?.print?.cells?.length,
    JSON.stringify(revealedTicket?.print?.grid),
  );
  check('揭晓后的 DTO 里依然没有 seed', revealedTicket ? !('seed' in revealedTicket) : false);

  const again = await api(revealUrl, { method: 'POST', cookie: cookies.a, body: { scratchRatio: 1 } });
  check('重复揭晓是幂等的', again.status === 200 && again.body?.alreadyRevealed === true, `实际 ${again.status} ${JSON.stringify(again.body)}`);

  const afterReveal = await api('/api/scratch/profile', { cookie: cookies.a });
  check('统计只记一次刮开', afterReveal.body?.stats?.revealed === 1, JSON.stringify(afterReveal.body?.stats));
  check('揭晓本身不发钱（换钱是兑奖机的事）', afterReveal.body?.money === expectedMoney, `实际 ${afterReveal.body?.money}`);
  check('刮开的票仍留在桌面上（还能继续拖）', afterReveal.body?.usedSlots === TABLE_SLOTS, `实际 ${afterReveal.body?.usedSlots}`);

  console.log('\n▶ 碎纸机：一张票 = 1 单位纸屑');
  const beforeShred = await api('/api/scratch/profile', { cookie: cookies.a });
  const shredUrl = `/api/scratch/tickets/${encodeURIComponent(firstTicket.id)}/shred`;
  const shredded = await api(shredUrl, { method: 'POST', cookie: cookies.a });
  check('把刮开的票送进碎纸机', shredded.status === 200, `实际 ${shredded.status} ${JSON.stringify(shredded.body)}`);
  check('状态变成 shredded', shredded.body?.ticket?.status === 'shredded', shredded.body?.ticket?.status);
  check('一张票产出 1 单位纸屑', shredded.body?.gained === 1, `实际 ${shredded.body?.gained}`);
  check('纸屑总数 +1', shredded.body?.scraps === (beforeShred.body?.scraps || 0) + 1, `实际 ${shredded.body?.scraps}`);
  const afterShred = await api('/api/scratch/profile', { cookie: cookies.a });
  check('碎掉的票离开桌面（槽位释放）', afterShred.body?.usedSlots === beforeShred.body?.usedSlots - 1, `实际 ${afterShred.body?.usedSlots}`);
  const shredAgain = await api(shredUrl, { method: 'POST', cookie: cookies.a });
  check('重复碎纸是幂等的', shredAgain.status === 200 && shredAgain.body?.alreadySettled === true && shredAgain.body?.gained === 0, `实际 ${shredAgain.status} ${JSON.stringify(shredAgain.body)}`);
  const redeemShredded = await api(`/api/scratch/tickets/${encodeURIComponent(firstTicket.id)}/redeem`, { method: 'POST', cookie: cookies.a });
  check('已经碎掉的票不能再兑奖（409）', redeemShredded.status === 409, `实际 ${redeemShredded.status}`);
  const scrapEntry = ((await api('/api/scratch/ledger', { cookie: cookies.a })).body?.entries || [])
    .find((entry) => entry.currency === 'scraps');
  check('纸屑流水记下来了', scrapEntry?.delta === 1 && scrapEntry?.kind === 'scratch-shred', JSON.stringify(scrapEntry));

  console.log('\n▶ 兑奖机：中奖票换成钱');
  const sealedRedeem = await api(`/api/scratch/tickets/${encodeURIComponent(luckyTicket.id)}/redeem`, { method: 'POST', cookie: cookies.a });
  check('没刮开就兑奖会被拒绝（409）', sealedRedeem.status === 409, `实际 ${sealedRedeem.status}`);

  // 先腾出空间：桌面上限 12 张，而这一节要反复买票刮开，所以先碎掉几张占位票。
  const openNow = (await api('/api/scratch/tickets', { cookie: cookies.a })).body?.tickets || [];
  for (const ticket of openNow.slice(0, 6)) {
    await api(`/api/scratch/tickets/${encodeURIComponent(ticket.id)}/shred`, { method: 'POST', cookie: cookies.a });
  }

  // 买票 → 刮开，直到**同时**拿到一张中奖票和一张没中奖的票；多余的立刻碎掉腾出槽位。
  let winner = null;
  let loser = null;
  for (let attempt = 0; attempt < 40 && (!winner || !loser); attempt += 1) {
    const buy = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.a, body: { kind: 'find-word' } });
    if (buy.status !== 201) break;
    const candidateId = buy.body.ticket.id;
    await api(`/api/scratch/tickets/${encodeURIComponent(candidateId)}/reveal`, { method: 'POST', cookie: cookies.a, body: { scratchRatio: 1 } });
    const settled = (await api('/api/scratch/tickets', { cookie: cookies.a })).body?.tickets
      ?.find((item) => item.id === candidateId);
    if (settled?.outcome?.won) {
      if (!winner) {
        winner = settled;
        continue;
      }
      await api(`/api/scratch/tickets/${encodeURIComponent(candidateId)}/shred`, { method: 'POST', cookie: cookies.a });
      continue;
    }
    if (!loser) {
      loser = settled;
      continue;
    }
    await api(`/api/scratch/tickets/${encodeURIComponent(candidateId)}/shred`, { method: 'POST', cookie: cookies.a });
  }
  check('能刮出一张中奖票（最多试 40 张）', Boolean(winner), '40 张都没中，概率极低，先怀疑生成器');
  check('能刮出一张没中奖的票', Boolean(loser), '没拿到没中奖的样本');

  if (loser) {
    const loserRedeem = await api(`/api/scratch/tickets/${encodeURIComponent(loser.id)}/redeem`, { method: 'POST', cookie: cookies.a });
    check('没中奖的票兑奖会被拒绝（409）', loserRedeem.status === 409, `实际 ${loserRedeem.status} ${JSON.stringify(loserRedeem.body)}`);
    const loserShred = await api(`/api/scratch/tickets/${encodeURIComponent(loser.id)}/shred`, { method: 'POST', cookie: cookies.a });
    check('没中奖的票可以碎掉换纸屑', loserShred.status === 200 && loserShred.body?.gained === 1, `实际 ${loserShred.status} ${JSON.stringify(loserShred.body)}`);
  }

  if (winner) {
    const beforeRedeem = await api('/api/scratch/profile', { cookie: cookies.a });
    const redeemUrl = `/api/scratch/tickets/${encodeURIComponent(winner.id)}/redeem`;
    const redeemed = await api(redeemUrl, { method: 'POST', cookie: cookies.a });
    check('把中奖票送进兑奖机', redeemed.status === 200, `实际 ${redeemed.status} ${JSON.stringify(redeemed.body)}`);
    check('状态变成 redeemed', redeemed.body?.ticket?.status === 'redeemed', redeemed.body?.ticket?.status);
    check('奖金加进余额', redeemed.body?.money === (beforeRedeem.body?.money || 0) + winner.outcome.prize, `期望 ${(beforeRedeem.body?.money || 0) + winner.outcome.prize}，实际 ${redeemed.body?.money}`);
    const holdemAfter = await api('/api/holdem/account', { cookie: cookies.a });
    check('德州扑克那边看到的是同一个数字', holdemAfter.body?.chips === redeemed.body?.money, `德州 ${holdemAfter.body?.chips} vs 刮刮乐 ${redeemed.body?.money}`);
    const redeemAgain = await api(redeemUrl, { method: 'POST', cookie: cookies.a });
    check('重复兑奖是幂等的', redeemAgain.status === 200 && redeemAgain.body?.alreadySettled === true, `实际 ${redeemAgain.status} ${JSON.stringify(redeemAgain.body)}`);
    const prizeEntry = ((await api('/api/scratch/ledger', { cookie: cookies.a })).body?.entries || [])
      .find((entry) => entry.kind === 'scratch-prize');
    check('奖金记进流水', prizeEntry?.delta === winner.outcome.prize, JSON.stringify(prizeEntry));
    const finalStats = await api('/api/scratch/profile', { cookie: cookies.a });
    check('统计记下兑奖次数与奖金总额', (finalStats.body?.stats?.redeemed || 0) >= 1 && (finalStats.body?.stats?.prizeTotal || 0) >= winner.outcome.prize, JSON.stringify(finalStats.body?.stats));
    check('兑奖后的票离开桌面', (finalStats.body?.usedSlots || 0) <= afterShred.body?.usedSlots, `${finalStats.body?.usedSlots} vs ${afterShred.body?.usedSlots}`);
  }

  console.log('\n▶ 升级树：双货币升级、效果生效与票种解锁');
  const upgradesBefore = await api('/api/scratch/upgrades', { cookie: cookies.a });
  const upgradeRows = upgradesBefore.body?.upgrades || [];
  const rootRows = upgradeRows.filter((item) => item.root);
  check('技能树返回 16 个节点（含 1 个起点）', upgradeRows.length === 16 && rootRows.length === 1, `实际 ${upgradeRows.length} 个节点、${rootRows.length} 个起点`);
  check('起点是开局点亮的（1 级）', rootRows[0]?.level === 1 && rootRows[0]?.maxLevel === 1, JSON.stringify(rootRows[0]));
  check('其余节点都从 0 级开始', upgradeRows.filter((item) => !item.root).every((item) => item.level === 0));
  check('每个节点都有说明、效果文案与列/行坐标', upgradeRows.every((item) => item.desc && item.nowText && item.nextText
    && Number.isInteger(item.column) && Number.isInteger(item.row)), JSON.stringify(upgradeRows[0]));
  check('布局是横向长条（有列数/行数）', (upgradesBefore.body?.maxColumn || 0) >= 7 && (upgradesBefore.body?.maxRow || 0) >= 2, `maxColumn=${upgradesBefore.body?.maxColumn} maxRow=${upgradesBefore.body?.maxRow}`);
  check('未满级的非起点节点都有下一级价格', upgradeRows.filter((item) => !item.root && !item.maxed).every((item) => item.cost && item.cost.money >= 0), JSON.stringify(upgradeRows.filter((item) => !item.cost).map((item) => item.id)));
  check('分类与方位都下发了', (upgradesBefore.body?.categories || []).length === 8, `实际 ${(upgradesBefore.body?.categories || []).length}`);
  check('桌面永久物品标记可用', upgradeRows.some((item) => item.shelf), JSON.stringify(upgradeRows.filter((item) => item.shelf).map((item) => item.id)));

  console.log('  · 全新账号（0 纸屑）的边界');
  const poorCatalog = await api('/api/scratch/catalog', { cookie: cookies.c });
  check('新账号看到的「连线」是锁着的', (poorCatalog.body?.tickets || []).find((item) => item.key === 'line-connect')?.unlocked === false);
  const lockedBuy = await api('/api/scratch/tickets', { method: 'POST', cookie: cookies.c, body: { kind: 'jackpot' } });
  check('直接指定 kind 买未解锁票种被拒绝（409）', lockedBuy.status === 409, `实际 ${lockedBuy.status} ${JSON.stringify(lockedBuy.body)}`);
  const poorUpgrade = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.c, body: { id: 'vault' } });
  check('纸屑不够时拒绝升级（409）', poorUpgrade.status === 409 && /纸屑/.test(poorUpgrade.body?.error || ''), `实际 ${poorUpgrade.status} ${JSON.stringify(poorUpgrade.body)}`);
  const lockedNode = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.c, body: { id: 'precision' } });
  check('前置没点亮时拒绝升级（409）', lockedNode.status === 409 && /先点亮/.test(lockedNode.body?.error || ''), `实际 ${lockedNode.status} ${JSON.stringify(lockedNode.body)}`);
  const rootBuy = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.c, body: { id: 'workshop' } });
  check('树的起点不能购买（409）', rootBuy.status === 409, `实际 ${rootBuy.status}`);
  const unknownUpgrade = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.c, body: { id: 'not-a-thing' } });
  check('不存在的升级返回 404', unknownUpgrade.status === 404, `实际 ${unknownUpgrade.status}`);
  const noIdUpgrade = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.c, body: {} });
  check('没带 id 的升级请求返回 400', noIdUpgrade.status === 400, `实际 ${noIdUpgrade.status}`);

  console.log('  · 碎纸机：升级后每张票多产纸屑');
  const moneyBeforeUpgrades = (await api('/api/scratch/profile', { cookie: cookies.a })).body?.money || 0;
  const shredderUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'shredder' } });
  const shredderRow = (shredderUp.body?.upgrades || []).find((item) => item.id === 'shredder');
  check('碎纸机升到 1 级', shredderUp.status === 200 && shredderRow?.level === 1, `实际 ${shredderUp.status} ${JSON.stringify(shredderRow)}`);
  check('升级从余额扣钱（60）', shredderUp.body?.money === moneyBeforeUpgrades - 60, `期望 ${moneyBeforeUpgrades - 60}，实际 ${shredderUp.body?.money}`);
  const twoScrapTicket = await buyTicketOf('find-word', cookies.a);
  const twoScrap = twoScrapTicket ? (await shredTicketOf(twoScrapTicket.id, cookies.a)).body : null;
  check('加成后每张票产出 2 纸屑', twoScrap?.gained === 2, `实际 ${twoScrap?.gained}`);

  console.log('  · 票种保险柜：解锁新玩法');
  const scraps = await grindScraps(70, cookies.a);
  check('攒到足够纸屑（≥70）', scraps >= 70, `实际 ${scraps}`);
  const vault1 = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'vault' } });
  check('票种保险柜升到 1 级', vault1.status === 200 && (vault1.body?.upgrades || []).find((item) => item.id === 'vault')?.level === 1, `实际 ${vault1.status}`);
  const afterVault1 = (await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || [];
  check('「连线」解锁、「头奖轮」还锁着',
    afterVault1.find((item) => item.key === 'line-connect')?.unlocked === true
      && afterVault1.find((item) => item.key === 'jackpot')?.unlocked === false);
  const vault2 = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'vault' } });
  check('票种保险柜升到 2 级', vault2.status === 200 && (vault2.body?.upgrades || []).find((item) => item.id === 'vault')?.level === 2, `实际 ${vault2.status}`);
  const vaultMaxed = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'vault' } });
  check('满级后再升级被拒绝（409）', vaultMaxed.status === 409, `实际 ${vaultMaxed.status} ${JSON.stringify(vaultMaxed.body)}`);

  const lineTicket = await buyTicketOf('line-connect', cookies.a);
  check('解锁后可以买「连线」', Boolean(lineTicket), '没买到');
  check('「连线」是 3×3 九格', lineTicket?.print?.cells?.length === 9 && lineTicket?.print?.grid?.cols === 3, JSON.stringify(lineTicket?.print?.grid));
  const jackpotTicket = await buyTicketOf('jackpot', cookies.a);
  check('解锁后可以买「头奖轮」', Boolean(jackpotTicket), '没买到');
  check('「头奖轮」是 6 格', jackpotTicket?.print?.cells?.length === 6, JSON.stringify(jackpotTicket?.print?.grid));
  if (lineTicket) await revealTicketOf(lineTicket.id, cookies.a);
  const lineSettled = lineTicket ? await fetchTicket(lineTicket.id, cookies.a) : null;
  check('「连线」能正常刮开结算', Boolean(lineSettled?.outcome), JSON.stringify(lineSettled?.outcome));
  const lineLabels = (lineSettled?.print?.cells || []).map((cell) => cell.label);
  const CONNECT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const connectCount = CONNECT_LINES.filter((line) => lineLabels[line[0]] === lineLabels[line[1]] && lineLabels[line[1]] === lineLabels[line[2]]).length;
  check('「连线」票面不存在歧义（中奖=恰好一线，不中=零线）', connectCount === (lineSettled?.outcome?.won ? 1 : 0), `线数 ${connectCount}，won=${lineSettled?.outcome?.won}`);

  console.log('  · 商店会员：折扣与桌面容量');
  const shopUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'shop' } });
  check('商店会员升到 1 级', shopUp.status === 200 && (shopUp.body?.upgrades || []).find((item) => item.id === 'shop')?.level === 1, `实际 ${shopUp.status}`);
  const discounted = (await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || [];
  const lineEntry = discounted.find((item) => item.key === 'line-connect');
  check('会员价按 5% 打折（40 → 38）', lineEntry?.price === 38 && lineEntry?.priceBase === 40, `实际 ${lineEntry?.price}（基数 ${lineEntry?.priceBase}）`);
  const slotsProfile = await api('/api/scratch/profile', { cookie: cookies.a });
  check('桌面容量随会员增加（12 → 14）', slotsProfile.body?.tableSlots === 14, `实际 ${slotsProfile.body?.tableSlots}`);

  console.log('  · 幸运护符与兑奖机：中奖率与奖金加成');
  const luckBefore = ((await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || []).find((item) => item.key === 'three-match');
  const luckUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'luck' } });
  check('幸运护符升到 1 级', luckUp.status === 200 && (luckUp.body?.upgrades || []).find((item) => item.id === 'luck')?.level === 1, `实际 ${luckUp.status}`);
  const luckAfter = ((await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || []).find((item) => item.key === 'three-match');
  check('中奖率 +2 个百分点（0.38 → 0.40）', Math.abs((luckAfter?.winChance || 0) - ((luckBefore?.winChance || 0) + 0.02)) < 1e-9, `之前 ${luckBefore?.winChance}，之后 ${luckAfter?.winChance}`);

  const bankUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'bank' } });
  check('兑奖机升到 1 级（+5%）', bankUp.status === 200 && (bankUp.body?.upgrades || []).find((item) => item.id === 'bank')?.level === 1, `实际 ${bankUp.status}`);
  const boostedWinner = await huntWinner(cookies.a);
  check('能刮出一张中奖票来验证加成', Boolean(boostedWinner), '40 张都没中');
  if (boostedWinner) {
    const beforeBoost = await api('/api/scratch/profile', { cookie: cookies.a });
    const boostedRedeem = await api(ticketUrl(boostedWinner.id, 'redeem'), { method: 'POST', cookie: cookies.a });
    const expectedPayout = Math.max(1, Math.round(boostedWinner.outcome.prize * 1.05));
    check('到账金额含兑奖机加成', boostedRedeem.body?.prize === expectedPayout && boostedRedeem.body?.basePrize === boostedWinner.outcome.prize, `期望 ${expectedPayout}（基础 ${boostedWinner.outcome.prize}），实际 ${boostedRedeem.body?.prize}`);
    check('余额按加成后的金额增加', boostedRedeem.body?.money === (beforeBoost.body?.money || 0) + expectedPayout, `期望 ${(beforeBoost.body?.money || 0) + expectedPayout}，实际 ${boostedRedeem.body?.money}`);
  }
  const upgradeLedger = ((await api('/api/scratch/ledger', { cookie: cookies.a })).body?.entries || [])
    .filter((entry) => entry.kind === 'scratch-upgrade');
  check('升级花掉的钱与纸屑都进了流水', upgradeLedger.some((entry) => entry.currency === 'money') && upgradeLedger.some((entry) => entry.currency === 'scraps'), JSON.stringify(upgradeLedger.slice(0, 3)));

  console.log('  · 技能树：前置门禁、效果叠加、结算门槛与 z 上限');
  // 先把碎纸机点高，方便攒纸屑（顺便验证等级本身）
  await grindScraps(24, cookies.a);
  const shredder2 = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'shredder' } });
  check('碎纸机升到 2 级', shredder2.status === 200 && (shredder2.body?.upgrades || []).find((item) => item.id === 'shredder')?.level === 2, `实际 ${shredder2.status}`);
  const shredder3 = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'shredder' } });
  check('碎纸机升到 3 级', shredder3.status === 200 && (shredder3.body?.upgrades || []).find((item) => item.id === 'shredder')?.level === 3, `实际 ${shredder3.status}`);
  const banked = await grindScraps(160, cookies.a);
  check('攒到 160 纸屑（碎纸机 3 级后每张 4 点）', banked >= 160, `实际 ${banked}`);

  const blockedPrecision = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'precision' } });
  check('刮刀没到 3 级时「精准刮刀」买不了（409）', blockedPrecision.status === 409 && /先点亮/.test(blockedPrecision.body?.error || ''), `实际 ${blockedPrecision.status} ${JSON.stringify(blockedPrecision.body)}`);
  for (let level = 1; level <= 3; level += 1) {
    await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'scraper' } });
  }
  const treeAfterScraper = await api('/api/scratch/upgrades', { cookie: cookies.a });
  const scraperRow = (treeAfterScraper.body?.upgrades || []).find((item) => item.id === 'scraper');
  check('刮刀点到 3 级', scraperRow?.level === 3, JSON.stringify(scraperRow));
  check('笔刷随刮刀变宽（6% → 27%）', Math.abs((treeAfterScraper.body?.effects?.brushPercent || 0) - 27) < 0.01, `实际 ${treeAfterScraper.body?.effects?.brushPercent}`);

  const precisionUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'precision' } });
  check('前置点亮后「精准刮刀」可解锁', precisionUp.status === 200 && (precisionUp.body?.upgrades || []).find((item) => item.id === 'precision')?.level === 1, `实际 ${precisionUp.status}`);
  const thresholdCatalog = ((await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || []).find((item) => item.key === 'three-match');
  check('结算门槛从 60% 降到 54%', Math.abs((thresholdCatalog?.threshold || 0) - 0.54) < 1e-9, `实际 ${thresholdCatalog?.threshold}`);
  const earlyTicket = await buyTicketOf('three-match', cookies.a);
  const earlyReveal = await api(ticketUrl(earlyTicket.id, 'reveal'), { method: 'POST', cookie: cookies.a, body: { scratchRatio: 0.56 } });
  check('54% 门槛下 56% 就能结算（升级前会被 409 拒）', earlyReveal.status === 200, `实际 ${earlyReveal.status} ${JSON.stringify(earlyReveal.body)}`);

  const shop2 = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'shop' } });
  check('商店会员升到 2 级', shop2.status === 200 && (shop2.body?.upgrades || []).find((item) => item.id === 'shop')?.level === 2, `实际 ${shop2.status}`);
  const vipUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'vip' } });
  check('会员专柜升到 1 级（折扣叠加）', vipUp.status === 200 && (vipUp.body?.upgrades || []).find((item) => item.id === 'vip')?.level === 1, `实际 ${vipUp.status}`);
  const stackedPrice = ((await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || []).find((item) => item.key === 'line-connect');
  check('折扣叠加到 13%（40 → 35）', stackedPrice?.price === 35, `实际 ${stackedPrice?.price}`);
  const stackedEffects = (await api('/api/scratch/profile', { cookie: cookies.a })).body?.effects;
  check('折扣字段是两条升级线累加后的值', Math.abs((stackedEffects?.discount || 0) - 0.13) < 1e-9, `实际 ${stackedEffects?.discount}`);

  for (let level = 1; level <= 3; level += 1) {
    await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'auto' } });
  }
  const autofocusUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'autofocus' } });
  check('自动刮机器 3 级后可解锁「自动巡桌」', autofocusUp.status === 200 && (autofocusUp.body?.upgrades || []).find((item) => item.id === 'autofocus')?.level === 1, `实际 ${autofocusUp.status}`);
  check('开关标记 autoScratchAll 被打开', autofocusUp.body?.effects?.flags?.autoScratchAll === true, JSON.stringify(autofocusUp.body?.effects?.flags));
  check('自动刮速度随等级提升（36 点/秒）', Math.abs((autofocusUp.body?.effects?.autoPointsPerSecond || 0) - 36) < 0.01, `实际 ${autofocusUp.body?.effects?.autoPointsPerSecond}`);
  check('自动刮奖机的耗时随等级变短（3 级 = 1.9 秒）', Math.abs((autofocusUp.body?.effects?.autoMachineMs ?? -1) - 1900) < 0.01, `实际 ${autofocusUp.body?.effects?.autoMachineMs}`);
  const autoRow = (autofocusUp.body?.upgrades || []).find((item) => item.id === 'auto');
  check('自动刮奖机的文案说的是桌面机器', /桌面机器/.test(autoRow?.nowText || ''), autoRow?.nowText);
  check('永久物品栏能拿到带 shelf 的节点', (autofocusUp.body?.upgrades || []).filter((item) => item.shelf && item.level >= 1).length >= 3, JSON.stringify((autofocusUp.body?.upgrades || []).filter((item) => item.shelf).map((item) => `${item.id}:${item.level}`)));

  const zTicket = ((await api('/api/scratch/tickets', { cookie: cookies.a })).body?.tickets || [])[0];
  const zPatched = await api(ticketUrl(zTicket.id), { method: 'PATCH', cookie: cookies.a, body: { z: 50 } });
  check('z 上报 50 会被压到上限以内', (zPatched.body?.ticket?.z ?? 99) <= 20, `实际 ${zPatched.body?.ticket?.z}`);
  const renumbered = (await api('/api/scratch/tickets', { cookie: cookies.a })).body?.tickets || [];
  check('重新编号是按叠放顺序 1..N', renumbered.length > 0 && renumbered.every((item, index) => item.z === index + 1), JSON.stringify(renumbered.map((item) => item.z)));

  console.log('  · 摆放角度：刚买来是随机的（null），拖过或点开就摆正（0）');
  check('刚买来的票 rotation = null（客户端按 id 给随机角）', zTicket.rotation === null, JSON.stringify(zTicket.rotation));
  const straightened = await api(ticketUrl(zTicket.id), { method: 'PATCH', cookie: cookies.a, body: { rotation: 0 } });
  check('摆正写进库（rotation = 0）', straightened.body?.ticket?.rotation === 0, JSON.stringify(straightened.body?.ticket?.rotation));
  const reloadedStraight = ((await api('/api/scratch/tickets', { cookie: cookies.a })).body?.tickets || [])
    .find((item) => item.id === zTicket.id);
  check('重新拉取还是正的（刷新后不会又歪）', reloadedStraight?.rotation === 0, JSON.stringify(reloadedStraight?.rotation));
  const badRotation = await api(ticketUrl(zTicket.id), { method: 'PATCH', cookie: cookies.a, body: { rotation: 999 } });
  check('角度超出 -180~180 会被拒（400）', badRotation.status === 400, `实际 ${badRotation.status} ${JSON.stringify(badRotation.body)}`);

  console.log('  · 桌面机器：位置与收起状态存在服务端');
  const profileForMachines = await api('/api/scratch/profile', { cookie: cookies.a });
  const machines = profileForMachines.body?.machines;
  check('三台机器都有位置（兑奖机 / 碎纸机 / 自动刮奖机）',
    Boolean(machines?.redeem) && Boolean(machines?.shred) && Boolean(machines?.auto),
    JSON.stringify(machines));
  check('默认都在桌面上（folded = false）',
    [machines?.redeem, machines?.shred, machines?.auto].every((item) => item && item.folded === false),
    JSON.stringify(machines));
  const foldedShred = await api('/api/scratch/machines', { method: 'POST', cookie: cookies.a, body: { id: 'shred', folded: true } });
  check('能把碎纸机收进「能力」栏', foldedShred.status === 200 && foldedShred.body?.machines?.shred?.folded === true, JSON.stringify(foldedShred.body));
  const movedRedeem = await api('/api/scratch/machines', { method: 'POST', cookie: cookies.a, body: { id: 'redeem', x: 40, y: 30 } });
  check('拖动机器会保存位置（40 / 30）',
    movedRedeem.body?.machines?.redeem?.x === 40 && movedRedeem.body?.machines?.redeem?.y === 30,
    JSON.stringify(movedRedeem.body?.machines?.redeem));
  const unfoldShred = await api('/api/scratch/machines', { method: 'POST', cookie: cookies.a, body: { id: 'shred', folded: false } });
  check('放回桌面后位置还在（没有被重置）',
    unfoldShred.body?.machines?.shred?.folded === false && unfoldShred.body?.machines?.shred?.x === machines.shred.x,
    JSON.stringify(unfoldShred.body?.machines?.shred));
  const badMachine = await api('/api/scratch/machines', { method: 'POST', cookie: cookies.a, body: { id: 'vending' } });
  check('没有这台机器时返回 404', badMachine.status === 404, `实际 ${badMachine.status}`);
  const machineProfileAgain = await api('/api/scratch/profile', { cookie: cookies.a });
  check('机器布局是从库里读回来的（下次进来也一样）',
    machineProfileAgain.body?.machines?.redeem?.x === 40 && machineProfileAgain.body?.machines?.redeem?.y === 30,
    JSON.stringify(machineProfileAgain.body?.machines?.redeem));

  console.log('  · 新内容：熔炼炉 / 自动兑奖 / 自动碎纸 / 暴击 / 头奖信仰');
  const smeltLocked = await api('/api/scratch/smelt', { method: 'POST', cookie: cookies.c, body: {} });
  check('没解锁熔炼炉时熔炼被拒（409）', smeltLocked.status === 409, `实际 ${smeltLocked.status} ${JSON.stringify(smeltLocked.body)}`);

  // 先把纸屑攒够：后面这串前置（兑奖机 3 级、幸运护符 2 级）与解锁都要花纸屑
  await grindScraps(300, cookies.a);
  await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'bank' } });
  await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'bank' } });
  await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'luck' } });
  const prereq = (await api('/api/scratch/upgrades', { cookie: cookies.a })).body?.upgrades || [];
  const levelOf = (id) => prereq.find((item) => item.id === id)?.level;
  check('前置就位（兑奖机 3 级、幸运护符 2 级）', levelOf('bank') === 3 && levelOf('luck') === 2, `bank=${levelOf('bank')} luck=${levelOf('luck')}`);

  const smelterUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'smelter' } });
  const smelterRow = (smelterUp.body?.upgrades || []).find((item) => item.id === 'smelter');
  check('纸屑熔炼炉升到 1 级', smelterUp.status === 200 && smelterRow?.level === 1, `实际 ${smelterUp.status} ${JSON.stringify(smelterRow)}`);
  check('熔炼汇率进 effects（每 8 纸屑换 1 币）', (smelterUp.body?.effects?.exchange ?? 0) === 8, `实际 ${smelterUp.body?.effects?.exchange}`);
  const smelted = await api('/api/scratch/smelt', { method: 'POST', cookie: cookies.a, body: { scraps: 48 } });
  check('熔炼成功', smelted.status === 200, `实际 ${smelted.status} ${JSON.stringify(smelted.body)}`);
  check('熔炼按汇率结算（48 纸屑 → 6 币）',
    smelted.body?.spent === 48 && smelted.body?.gain === 6 && smelted.body?.rate === 8,
    JSON.stringify(smelted.body));
  const afterSmelt = await api('/api/scratch/profile', { cookie: cookies.a });
  check('钱和纸屑都在同一次熔炼里变了',
    afterSmelt.body?.money === smelted.body?.money && afterSmelt.body?.scraps === smelted.body?.scraps,
    JSON.stringify({ money: afterSmelt.body?.money, scraps: afterSmelt.body?.scraps }));
  const smeltEntry = ((await api('/api/scratch/ledger', { cookie: cookies.a })).body?.entries || [])
    .find((entry) => entry.kind === 'scratch-smelt');
  check('熔炼的两笔流水都记了', smeltEntry?.currency === 'scraps' || smeltEntry?.currency === 'money', JSON.stringify(smeltEntry));

  await grindScraps(120, cookies.a);
  const autobankUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'autobank' } });
  check('兑奖机 3 级后「自动兑奖」可解锁', autobankUp.status === 200 && (autobankUp.body?.upgrades || []).find((item) => item.id === 'autobank')?.level === 1, `实际 ${autobankUp.status}`);
  check('开关 autoRedeemAll 被打开', autobankUp.body?.effects?.flags?.autoRedeemAll === true, JSON.stringify(autobankUp.body?.effects?.flags));
  const autoshredUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'autoshred' } });
  check('碎纸机 3 级后「自动碎纸」可解锁', autoshredUp.status === 200 && (autoshredUp.body?.upgrades || []).find((item) => item.id === 'autoshred')?.level === 1, `实际 ${autoshredUp.status}`);
  check('开关 autoShredAll 被打开', autoshredUp.body?.effects?.flags?.autoShredAll === true, JSON.stringify(autoshredUp.body?.effects?.flags));
  const critUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'crit' } });
  check('幸运护符 2 级后「暴击」可解锁（+5%）', critUp.status === 200 && (critUp.body?.effects?.critChance ?? 0) > 0.049, `实际 ${critUp.status} ${critUp.body?.effects?.critChance}`);
  check('暴击倍数是 2 倍', (critUp.body?.effects?.critMultiplier ?? 0) === 2, `实际 ${critUp.body?.effects?.critMultiplier}`);
  const fanUp = await api('/api/scratch/upgrade', { method: 'POST', cookie: cookies.a, body: { id: 'jackpotFan' } });
  check('保险柜 2 级后「头奖信仰」可解锁', fanUp.status === 200 && (fanUp.body?.upgrades || []).find((item) => item.id === 'jackpotFan')?.level === 1, `实际 ${fanUp.status}`);
  const jackpotEntry = ((await api('/api/scratch/catalog', { cookie: cookies.a })).body?.tickets || []).find((item) => item.key === 'jackpot');
  check('头奖轮的中奖率含票种专精（0.05 + 0.04 + 0.01 = 0.10）', Math.abs((jackpotEntry?.winChance || 0) - 0.1) < 1e-9, `实际 ${jackpotEntry?.winChance}`);

  const critWinner = await huntWinner(cookies.a);
  check('能刮出一张中奖票来验证暴击路径', Boolean(critWinner), '40 张都没中');
  if (critWinner) {
    const beforeCrit = await api('/api/scratch/profile', { cookie: cookies.a });
    const bonus = beforeCrit.body?.effects?.prizeBonus ?? 0;
    const critRedeem = await api(ticketUrl(critWinner.id, 'redeem'), { method: 'POST', cookie: cookies.a });
    const expectedBase = Math.max(1, Math.round(critWinner.outcome.prize * (1 + bonus)));
    const expectedPrize = critRedeem.body?.crit ? expectedBase * (beforeCrit.body?.effects?.critMultiplier ?? 2) : expectedBase;
    check('兑奖金额 = 加成后金额（暴击时再翻倍）', critRedeem.body?.prize === expectedPrize, `期望 ${expectedPrize}，实际 ${critRedeem.body?.prize}（crit=${critRedeem.body?.crit}）`);
    check('暴击标记是布尔值', typeof critRedeem.body?.crit === 'boolean', JSON.stringify(critRedeem.body?.crit));
    check('余额加的是实际到账金额', critRedeem.body?.money === (beforeCrit.body?.money || 0) + expectedPrize, `实际 ${critRedeem.body?.money}`);
  }

  console.log('  · 一键重置：清空所有等级并全额退还资源');
  const beforeReset = await api('/api/scratch/upgrades', { cookie: cookies.a });
  const spentLevels = (beforeReset.body?.upgrades || [])
    .filter((row) => !row.root)
    .reduce((sum, row) => sum + (row.level || 0), 0);
  check('重置预览的级数 = 所有已点等级之和（起点不算钱）',
    beforeReset.body?.refundPreview?.levels === spentLevels && spentLevels > 10,
    `预览 ${beforeReset.body?.refundPreview?.levels} vs 实际 ${spentLevels}`);
  const profileBeforeReset = await api('/api/scratch/profile', { cookie: cookies.a });
  const moneyBeforeReset = profileBeforeReset.body?.money || 0;
  const scrapsBeforeReset = profileBeforeReset.body?.scraps || 0;
  const reset = await api('/api/scratch/reset', { method: 'POST', cookie: cookies.a, body: {} });
  check('重置成功', reset.status === 200, `实际 ${reset.status} ${JSON.stringify(reset.body)}`);
  check('退款额与预览一致',
    reset.body?.refundMoney === beforeReset.body?.refundPreview?.money
    && reset.body?.refundScraps === beforeReset.body?.refundPreview?.scraps,
    `退 ${reset.body?.refundMoney}/${reset.body?.refundScraps}，预览 ${beforeReset.body?.refundPreview?.money}/${beforeReset.body?.refundPreview?.scraps}`);
  check('钱与纸屑都全额退到账上',
    reset.body?.money === moneyBeforeReset + (reset.body?.refundMoney || 0)
    && reset.body?.scraps === scrapsBeforeReset + (reset.body?.refundScraps || 0),
    JSON.stringify({
      money: reset.body?.money,
      expectMoney: moneyBeforeReset + (reset.body?.refundMoney || 0),
      scraps: reset.body?.scraps,
      expectScraps: scrapsBeforeReset + (reset.body?.refundScraps || 0),
    }));
  const afterReset = await api('/api/scratch/upgrades', { cookie: cookies.a });
  check('所有等级都被清空（只剩起点是 1 级）',
    (afterReset.body?.upgrades || []).every((item) => (item.root ? item.level === 1 : item.level === 0)),
    JSON.stringify((afterReset.body?.upgrades || []).map((item) => `${item.id}:${item.level}`)));
  check('重置后票种回到锁着（头奖轮没了）',
    !(afterReset.body?.effects?.unlockedTickets || []).includes('jackpot'),
    JSON.stringify(afterReset.body?.effects?.unlockedTickets));
  const resetEntry = ((await api('/api/scratch/ledger', { cookie: cookies.a })).body?.entries || [])
    .filter((entry) => entry.kind === 'scratch-reset');
  check('重置写进流水（money 与 scraps 各一笔）',
    resetEntry.some((entry) => entry.currency === 'money') && resetEntry.some((entry) => entry.currency === 'scraps'),
    JSON.stringify(resetEntry.slice(0, 2)));
  const resetAgain = await api('/api/scratch/reset', { method: 'POST', cookie: cookies.a, body: {} });
  check('技能树空了以后再重置会被拒（409）', resetAgain.status === 409, `实际 ${resetAgain.status} ${JSON.stringify(resetAgain.body)}`);
  const emptyReset = await api('/api/scratch/reset', { method: 'POST', cookie: cookies.c, body: {} });
  check('一次都没升级的账号重置也被拒（409）', emptyReset.status === 409, `实际 ${emptyReset.status}`);
}

async function main() {
  console.log(`刮刮乐冒烟测试（端口 ${PORT}）`);
  reportLines.push(`刮刮乐冒烟测试（端口 ${PORT}）`);
  await setupUsers();
  console.log('✔ 已创建两个临时测试账号（一个有权、一个无权）');
  reportLines.push('  [OK] 已创建两个临时测试账号（一个有权、一个无权）');
  if (process.env.SMOKE_REPORT) {
    // Windows 下把中文输出重定向到文件常被控制台编码糊掉，所以支持写一份 UTF-8 报告。
    console.log(`（报告会写到 ${process.env.SMOKE_REPORT}）`);
  }

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
    console.log('✔ 服务已启动');
    const cookies = {
      a: await login(USERS[0].username, USERS[0].password),
      b: await login(USERS[1].username, USERS[1].password),
      c: await login(USERS[2].username, USERS[2].password),
    };
    console.log('✔ 三个账号已登录');
    await runHttpTests(cookies);
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
    // 服务没起来或断言失败时，把服务端日志打出来，否则只看到“退出码 1”没法排查。
    if ((failures > 0 || !serverReady) && serverLog) console.log('\n--- 服务日志 ---\n' + serverLog);
  }

  if (failures > 0) {
    console.error(`\n✘ ${failures} 项断言失败`);
    reportLines.push(`[FAIL] ${failures} 项断言失败`);
    if (process.env.SMOKE_REPORT) {
      try {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(process.env.SMOKE_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
      } catch (error) {
        console.error('写报告失败:', error);
      }
    }
    process.exit(1);
  }
  console.log('\n✔ 全部冒烟测试通过');
  reportLines.push('[OK] 全部冒烟测试通过');
  if (process.env.SMOKE_REPORT) {
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(process.env.SMOKE_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
    } catch (error) {
      console.error('写报告失败:', error);
    }
  }
}

main().catch((error) => {
  console.error('\n✘ 冒烟测试异常:', error);
  process.exit(1);
});