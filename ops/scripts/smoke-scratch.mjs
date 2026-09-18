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
  check('商店目录返回 4 种票', tickets.length === 4, `实际 ${tickets.length}`);
  check('所有票种配置校验通过', tickets.every((ticket) => Array.isArray(ticket.problems) && ticket.problems.length === 0), JSON.stringify(tickets.map((ticket) => ticket.problems)));
  check('所有票种默认解锁', tickets.every((ticket) => ticket.unlocked === true));
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
    };
    console.log('✔ 两个账号已登录');
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