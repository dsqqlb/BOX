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

async function api(pathname, cookie) {
  const response = await fetch(`${BASE}${pathname}`, { headers: cookie ? { Cookie: `${cookie.name}=${cookie.value}` } : {} });
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
    check('开场引导可见（还没开局）', await evaluate(page, `Boolean(document.querySelector('.nq-intro'))`));

    console.log('\n▶ 点「新的一局」并放完建角色的骰子');
    await evaluate(page, `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('掷骰开始新的一局')); if (button) button.click(); return Boolean(button); })()`);
    await sleep(1500);
    check('3D 骰子遮罩出现（建角色掷骰）', await evaluate(page, `Boolean(document.querySelector('.nq-dice-overlay'))`));
    const rounds = await settleDice(page);
    check(`骰子放完（共点了 ${rounds} 次）`, rounds > 0, `rounds=${rounds}`);
    const afterCreate = await evaluate(page, `({
      hasMap: Boolean(document.querySelector('.nq-map-svg')),
      nodes: document.querySelectorAll('.nq-map-node').length,
      hp: document.querySelector('.nq-hp-text')?.textContent ?? '',
      log: [...document.querySelectorAll('.nq-log-line')].slice(0, 3).map((item) => item.textContent),
    })`);
    check('地图出现', afterCreate.hasMap, JSON.stringify(afterCreate));
    check('地图上有片段（入口）', afterCreate.nodes >= 1, `nodes=${afterCreate.nodes}`);
    check('角色面板显示了 HP', String(afterCreate.hp).includes('/'), afterCreate.hp);
    check('日志里出现开局记录', afterCreate.log.length > 0, JSON.stringify(afterCreate.log));

    console.log('\n▶ 先「返回地牢」，再点地图上的门');
    await evaluate(page, `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('返回地牢')); if (button) button.click(); return Boolean(button); })()`);
    await sleep(1200);
    await settleDice(page);
    const inDungeon = await evaluate(page, `({
      townbar: Boolean(document.querySelector('.nq-townbar')),
      log: [...document.querySelectorAll('.nq-log-line')].slice(0, 4).map((item) => item.textContent),
    })`);
    check('进入地牢后城镇提示条消失', !inDungeon.townbar, JSON.stringify(inDungeon));

    const before = afterCreate.nodes;
    await evaluate(page, `(() => { const door = document.querySelector('.nq-map-door'); if (door) door.dispatchEvent(new MouseEvent('click', { bubbles: true })); return Boolean(door); })()`);
    await sleep(1200);
    await settleDice(page);
    const afterDoor = await evaluate(page, `({
      nodes: document.querySelectorAll('.nq-map-node').length,
      log: [...document.querySelectorAll('.nq-log-line')].slice(0, 8).map((item) => item.textContent),
    })`);
    check('开门动作有结果（片段变多，或拿到锁门/陷阱反馈）',
      afterDoor.nodes > before || afterDoor.log.some((line) => line.includes('开门') || line.includes('陷阱') || line.includes('锁') || line.includes('走廊') || line.includes('房间')),
      JSON.stringify(afterDoor));

    const shot = await screenshot(page, 'notequest.png');
    console.log(`   截图：${shot}`);

    console.log('\n▶ 存档已经写进 SQLite');
    const runs = await api('/api/notequest/runs', cookie);
    check('存档列表至少有 1 条记录', runs.status === 200 && (runs.body?.runs?.length ?? 0) >= 1, JSON.stringify(runs.body));
    const summary = runs.body?.runs?.find((item) => item.heroName) ?? runs.body?.runs?.[0];
    check('摘要里有角色与地牢名', Boolean(summary?.heroName) && Boolean(summary?.dungeonName), JSON.stringify(summary));
    const detail = await api(`/api/notequest/runs/${summary?.id}`, cookie);
    check('快照里有地图节点', Array.isArray(detail.body?.run?.state?.dungeon?.nodes) && detail.body.run.state.dungeon.nodes.length >= 1);
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