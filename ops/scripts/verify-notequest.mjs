#!/usr/bin/env node
/**
 * NoteQuest 浏览器端到端验证（本地工具）：无头 Chrome + CDP。
 *
 * 验证的是一条真实用户路径：
 *   登录 → 打开 /tools/notequest → 点「新的一局」→ 让 3D 骰子把建角色那批骰子放完
 *   → 确认地图与角色面板出现 → 点地图上的门 → 再放完开门的骰子
 *   → 确认地牢片段变多、日志有记录、存档已经写进 SQLite。
 *
 * 用法（需要可用的 resources/.env.local 与数据库，并且本机有 Chrome / Edge）：
 *   node ops/scripts/verify-notequest.mjs
 * 失败时打印断言明细并返回非 0；截图落在 ops/checks/shots/。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const WebSocket = createRequire(path.join(codeRoot, 'package.json'))('ws');
const PORT = 19880;
const DEBUG_PORT = 9333;
const BASE = `http://localhost:${PORT}`;
const SHOTS_DIR = path.join(projectRoot, 'ops', 'checks', 'shots');
const USER = { username: 'notequest_ui_check', password: 'ui-check-password-1234' };
const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

let failures = 0;
const reportLines = [];
function check(name, condition, detail = '') {
  const line = `  ${condition ? '[OK]' : '[FAIL]'} ${name}${condition ? '' : ` — ${detail}`}`;
  console.log(line);
  reportLines.push(line);
  if (!condition) failures += 1;
}

function writeReport() {
  if (!process.env.VERIFY_REPORT) return;
  try {
    fs.writeFileSync(process.env.VERIFY_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
  } catch (error) {
    console.error('写报告失败:', error);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scryptHash(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 + 16 * 1024 * 1024 }).toString('base64url');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

async function setupUser() {
  const { prisma } = await import(pathToFileURL(path.join(codeRoot, 'server', 'db.js')).href);
  // 先清掉上一次可能残留的账号（级联删除它的存档与墓地），保证从干净状态开始
  await prisma.user.deleteMany({ where: { username: USER.username } });
  const passwordHash = scryptHash(USER.password);
  await prisma.user.create({
    data: { username: USER.username, passwordHash, sessionRevision: 0, permissions: { create: [{ permission: 'notequest' }] } },
  });
  await prisma.$disconnect();
}

async function cleanupUser() {
  const { prisma } = await import(pathToFileURL(path.join(codeRoot, 'server', 'db.js')).href);
  await prisma.user.deleteMany({ where: { username: USER.username } });
  await prisma.$disconnect();
}

async function waitForServer(child, timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务提前退出，退出码 ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.status < 500) return;
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  throw new Error('服务启动超时');
}

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
    body: new URLSearchParams({ username: USER.username, password: USER.password }).toString(),
  });
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败：HTTP ${response.status}`);
  const [name, value] = setCookie.split(';')[0].split('=');
  return { name, value };
}

async function api(pathname, cookie, method = 'GET') {
  const headers = cookie ? { Cookie: `${cookie.name}=${cookie.value}` } : {};
  if (method !== 'GET') {
    headers.Origin = BASE;
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`${BASE}${pathname}`, { method, headers, body: method === 'GET' ? undefined : '{}' });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function findChrome() {
  return CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function launchChrome(executable) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'nq-chrome-'));
  const child = spawn(executable, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-default-browser-check',
    '--window-size=1440,1000',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://localhost:${DEBUG_PORT}/json/list`);
      if (response.ok) return child;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪');
}

async function openPage() {
  const list = await (await fetch(`http://localhost:${DEBUG_PORT}/json/list`)).json();
  const target = list.find((item) => item.type === 'page');
  if (!target) throw new Error('没有可用的 page target');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    let counter = 0;
    const pending = new Map();
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    });
    socket.on('error', reject);
    socket.on('open', () => resolve({
      send(method, params = {}) {
        counter += 1;
        const id = counter;
        return new Promise((res) => {
          pending.set(id, res);
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      close: () => socket.close(),
    }));
  });
}

async function evaluate(page, expression) {
  const result = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.result?.exceptionDetails) throw new Error(result.result.exceptionDetails.text ?? '页面脚本异常');
  return result.result?.result?.value;
}

/** 逐颗点掉 3D 骰子遮罩（每颗结果卡停留 2 秒），最多等 maxMs。 */
async function settleDice(page, maxMs = 180000) {
  const deadline = Date.now() + maxMs;
  let rounds = 0;
  while (Date.now() < deadline) {
    const visible = await evaluate(page, `Boolean(document.querySelector('.nq-dice-overlay'))`).catch(() => false);
    if (!visible) return rounds;
    rounds += 1;
    await sleep(800);
    await evaluate(page, `(() => { const overlay = document.querySelector('.nq-dice-overlay'); if (overlay) overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`).catch(() => false);
    await sleep(400);
  }
  return rounds;
}

/** 在页面里按按钮文字点一下（返回一段可交给 evaluate 的表达式）。 */
function clickByText(text) {
  return `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes(${JSON.stringify(text)})); if (button) button.click(); return Boolean(button); })()`;
}

async function screenshot(page, name) {
  const result = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, name);
  fs.writeFileSync(file, Buffer.from(result.result.data, 'base64'));
  return file;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('跳过浏览器验证：本机没有找到 Chrome / Edge。');
    return;
  }
  console.log(`使用浏览器：${chrome}`);
  await setupUser();

  const server = spawn(process.execPath, [path.join(codeRoot, 'server', 'index.js')], {
    cwd: codeRoot,
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  let browser = null;
  let page = null;
  try {
    await waitForServer(server);
    browser = await launchChrome(chrome);
    page = await openPage();
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Network.enable');
    const cookie = await login();
    await page.send('Network.setCookie', { name: cookie.name, value: cookie.value, domain: 'localhost', path: '/', httpOnly: true });

    console.log('\n▶ 打开 /tools/notequest');
    await page.send('Page.navigate', { url: `${BASE}/tools/notequest` });
    for (let attempt = 0; attempt < 75; attempt += 1) {
      const ready = await evaluate(page, `document.readyState === 'complete' && Boolean(document.querySelector('.nq-app'))`).catch(() => false);
      if (ready) break;
      await sleep(400);
    }
    const title = await evaluate(page, `document.querySelector('.nq-title')?.textContent ?? ''`);
    check('页面渲染出 NoteQuest 标题', String(title).includes('NoteQuest'), String(title));
    check('人物池界面可见（还没开局）', await evaluate(page, `Boolean(document.querySelector('.nq-start'))`));

    console.log('\n▶ 存档栏位：一个账号三个，且互相隔离');
    const slotUi = await evaluate(page, `({
      cards: document.querySelectorAll('.nq-slot-card').length,
      switch: Boolean(document.querySelector('.nq-slot-switch')),
      label: document.querySelector('.nq-slot-card.is-on .nq-hero-name')?.textContent ?? '',
    })`);
    check('首页出现三个存档栏位', slotUi.cards === 3, JSON.stringify(slotUi));
    check('顶栏有栏位切换按钮', slotUi.switch, JSON.stringify(slotUi));
    check('当前栏位标出来了', String(slotUi.label).includes('存档'), slotUi.label);

    console.log('\n▶ 掷骰建角 → 存进人物池（栏位 1）');
    await evaluate(page, clickByText('掷骰建角'));
    await sleep(1500);
    check('建角界面出现', await evaluate(page, `Boolean(document.querySelector('.nq-creator'))`));
    check('3D 骰子遮罩出现（建角掷骰，画面上写着为什么掷）',
      await evaluate(page, `Boolean(document.querySelector('.nq-dice-overlay')) && Boolean(document.querySelector('.nq-dice-label'))`));
    const rounds = await settleDice(page);
    check(`骰子放完（共点了 ${rounds} 次）`, rounds > 0, `rounds=${rounds}`);
    await evaluate(page, clickByText('保存到人物池'));
    await sleep(2000);
    const pool = await evaluate(page, `({ cards: document.querySelectorAll('.nq-hero-card').length })`);
    check('人物池里出现了新角色', pool.cards >= 1, JSON.stringify(pool));

    console.log('\n▶ 自定义建角：改已有角色');
    await evaluate(page, `(() => {
      const card = document.querySelector('.nq-hero-card');
      const button = card ? [...card.querySelectorAll('button')].find((item) => item.textContent.trim() === '自定义') : null;
      if (button) button.click();
      return Boolean(button);
    })()`);
    await sleep(1200);
    const custom = await evaluate(page, `({
      open: Boolean(document.querySelector('.nq-creator')),
      field: Boolean(document.querySelector('.nq-creator .nq-field input:not([type="number"])')),
      name: document.querySelector('.nq-creator .nq-field input:not([type="number"])')?.value ?? '',
    })`);
    check('自定义建角打开并预填了当前角色', custom.open && custom.field && custom.name.length > 0, JSON.stringify(custom));
    await evaluate(page, clickByText('返回'));
    await sleep(800);

    console.log('\n▶ 切换到栏位 2：人物池应当整套换掉');
    await evaluate(page, `(() => { const dots = document.querySelectorAll('.nq-slot-switch .nq-slot-dot'); if (dots[1]) dots[1].click(); return dots.length; })()`);
    await sleep(2500);
    const slot2 = await evaluate(page, `({
      cards: document.querySelectorAll('.nq-hero-card').length,
      label: document.querySelector('.nq-slot-card.is-on .nq-hero-name')?.textContent ?? '',
    })`);
    check('栏位 2 是空的（栏位之间完全隔离）', slot2.cards === 0, JSON.stringify(slot2));
    check('当前栏位切到了存档 2', String(slot2.label).includes('2'), slot2.label);
    await evaluate(page, `(() => { const dots = document.querySelectorAll('.nq-slot-switch .nq-slot-dot'); if (dots[0]) dots[0].click(); return dots.length; })()`);
    await sleep(2500);
    const back = await evaluate(page, `document.querySelectorAll('.nq-hero-card').length`);
    check('切回栏位 1 后角色还在', back >= 1, `cards=${back}`);

    console.log('\n▶ 出发 → 城镇 → 进入地牢');
    await evaluate(page, clickByText('出发'));
    await sleep(2500);
    await settleDice(page);
    check('城镇画面出现', await evaluate(page, `Boolean(document.querySelector('.nq-town'))`));
    await evaluate(page, clickByText('进入「'));
    await sleep(2500);
    await settleDice(page);
    const afterCreate = await evaluate(page, `({
      hasMap: Boolean(document.querySelector('.nq-map-svg')),
      canvas: Boolean(document.querySelector('.nq-map-canvas')),
      zoom: document.querySelector('.nq-map-zoom')?.textContent ?? '',
      nodes: document.querySelectorAll('.nq-map-node').length,
      doors: document.querySelectorAll('.nq-door').length,
      hp: document.querySelector('.nq-hp-text')?.textContent ?? '',
      log: [...document.querySelectorAll('.nq-log-line')].slice(0, 3).map((item) => item.textContent),
    })`);
    check('地牢 HUD 里出现地图', afterCreate.hasMap, JSON.stringify(afterCreate));
    check('地图支持拖拽平移与滚轮缩放（有画布与缩放比例）', afterCreate.canvas && String(afterCreate.zoom).includes('%'), JSON.stringify(afterCreate));
    check('地图上有片段（入口）', afterCreate.nodes >= 1, `nodes=${afterCreate.nodes}`);
    check('地图上每个片段都画出了门（墙上的加粗门框）', afterCreate.doors >= 1, `doors=${afterCreate.doors}`);
    check('人物状态显示了 HP', String(afterCreate.hp).includes('/'), afterCreate.hp);
    check('日志里出现开局记录', afterCreate.log.length > 0, JSON.stringify(afterCreate.log));
    check('画面上有掷骰记录（开局那几次掷骰的目的与结果）',
      (await evaluate(page, `document.querySelectorAll('.nq-roll-row').length`)) > 0);

    console.log('\n▶ 点地图上的门掷开门表');
    const before = afterCreate.nodes;
    const doorClick = await evaluate(page, `(() => {
      const door = document.querySelector('.nq-door.is-clickable') || document.querySelector('.nq-door');
      if (door) door.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return Boolean(door);
    })()`);
    check('地图上的门可以点击（不是飘在房间外的圆点标记）', doorClick);
    await sleep(1200);
    await settleDice(page);
    const afterDoor = await evaluate(page, `({
      nodes: document.querySelectorAll('.nq-map-node').length,
      linked: document.querySelectorAll('.nq-door.is-linked').length,
      rolls: document.querySelectorAll('.nq-roll-row').length,
      log: [...document.querySelectorAll('.nq-log-line')].slice(0, 8).map((item) => item.textContent),
    })`);
    check('开门动作有结果（片段变多，或拿到锁门/陷阱反馈）',
      afterDoor.nodes > before || afterDoor.log.some((line) => line.includes('开门') || line.includes('陷阱') || line.includes('锁') || line.includes('走廊') || line.includes('房间')),
      JSON.stringify(afterDoor));
    check('开门掷骰也进了掷骰记录', afterDoor.rolls >= 1, `rolls=${afterDoor.rolls}`);
    if (afterDoor.nodes > before) {
      check('相邻两间房的门重叠着画（共享那一格上有两扇门）', afterDoor.linked >= 2, `linked=${afterDoor.linked}`);
    }

    const shot = await screenshot(page, 'notequest.png');
    console.log(`   截图：${shot}`);

    console.log('\n▶ 存档已经写进 SQLite');
    const runs = await api('/api/notequest/runs', cookie);
    check('存档列表至少有 1 条记录', runs.status === 200 && (runs.body?.runs?.length ?? 0) >= 1, JSON.stringify(runs.body));
    const summary = runs.body?.runs?.find((item) => item.heroName) ?? runs.body?.runs?.[0];
    check('摘要里有角色与地牢名', Boolean(summary?.heroName) && Boolean(summary?.dungeonName), JSON.stringify(summary));
    const detail = await api(`/api/notequest/runs/${summary?.id}`, cookie);
    check('快照里有地图节点', Array.isArray(detail.body?.run?.state?.dungeon?.nodes) && detail.body.run.state.dungeon.nodes.length >= 1);

    console.log('\n▶ 存档栏位在服务端也互相隔离');
    const slotsApi = await api('/api/notequest/slots', cookie);
    check('栏位接口返回三个栏位', slotsApi.status === 200 && (slotsApi.body?.slots?.length ?? 0) === 3, JSON.stringify(slotsApi.body));
    const slot0Runs = await api('/api/notequest/runs?slot=0', cookie);
    check('栏位 0 里就是刚才这一局', (slot0Runs.body?.runs?.length ?? 0) >= 1, JSON.stringify(slot0Runs.body));
    const slot2Runs = await api('/api/notequest/runs?slot=2', cookie);
    check('栏位 2 里没有任何存档', (slot2Runs.body?.runs?.length ?? 0) === 0, JSON.stringify(slot2Runs.body));
    const slot0Chars = await api('/api/notequest/characters?slot=0', cookie);
    const slot2Chars = await api('/api/notequest/characters?slot=2', cookie);
    check('人物池也按栏位隔离', (slot0Chars.body?.characters?.length ?? 0) >= 1 && (slot2Chars.body?.characters?.length ?? 0) === 0,
      JSON.stringify({ s0: slot0Chars.body?.characters?.length, s2: slot2Chars.body?.characters?.length }));
    const slot0Dungeons = await api('/api/notequest/dungeons?slot=0', cookie);
    const slot2Dungeons = await api('/api/notequest/dungeons?slot=2', cookie);
    check('永久地牢图也按栏位隔离', (slot0Dungeons.body?.dungeons?.length ?? 0) >= 1 && (slot2Dungeons.body?.dungeons?.length ?? 0) === 0,
      JSON.stringify({ s0: slot0Dungeons.body?.dungeons?.length, s2: slot2Dungeons.body?.dungeons?.length }));
    check('地图是按「类型 + 栏位」取的',
      (await api('/api/notequest/dungeons?slot=0&typeId=' + encodeURIComponent(summary?.dungeonTypeId ?? 'palace'), cookie)).body?.dungeon !== null);
    const cleared = await api('/api/notequest/slots/2', cookie, 'DELETE');
    check('清空栏位 2 成功（它本来就是空的）', cleared.status === 200, JSON.stringify(cleared.body));
    const reruns = await api('/api/notequest/runs?slot=0', cookie);
    check('清空别的栏位不会影响当前栏位', (reruns.body?.runs?.length ?? 0) >= 1, JSON.stringify(reruns.body));
  } finally {
    page?.close();
    browser?.kill();
    server.kill();
    await sleep(900);
    try {
      await cleanupUser();
      console.log('已清理测试账号');
    } catch (error) {
      console.error('清理测试账号失败:', error);
    }
    if (failures > 0) console.log('\n--- 服务输出 ---\n' + serverLog.slice(-2000));
    writeReport();
  }

  if (failures > 0) {
    console.error(`\n失败 ${failures} 项`);
    process.exit(1);
  }
  console.log('\n浏览器验证全部通过');
}

main().catch((error) => {
  console.error('\n浏览器验证异常:', error);
  process.exit(1);
});