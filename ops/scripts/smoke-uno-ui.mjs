#!/usr/bin/env node
/**
 * UNO 界面端到端冒烟（无头 Chrome + CDP）：
 *   1. 用临时账户 + 生产模式服务（需先 npm run build）；
 *   2. 真浏览器里走一遍：大厅 → 勾机器人 → 建房 → 等待室 → 开局 → 牌桌 → 自己的回合里抓一张牌、出一张牌；
 *   3. 顺手截图（大厅 / 等待室 / 牌桌 / 出牌后），路径会打印出来，方便肉眼确认界面。
 *
 * 用法：
 *   npm run smoke:uno-ui
 *   node ops/scripts/smoke-uno-ui.mjs --keep      # 失败时保留服务进程
 * 找不到 Chrome 时会明确报错退出（不会假装通过）。
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const require = createRequire(import.meta.url);
const WebSocket = require(path.join(codeRoot, 'node_modules', 'ws'));

const PORT = 19880;
const BASE = `http://127.0.0.1:${PORT}`;
const CDP_PORT = 9223;
const KEEP = process.argv.includes('--keep');
const SHOT_DIR = path.join(process.env.TEMP || os.tmpdir(), 'uno-ui-shots');
const USER = { username: 'uno_ui_probe', password: 'uno-ui-probe-1234' };

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${ok ? '' : ` → ${detail}`}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function hashPassword(password) {
  const N = 16384, r = 8, p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function seedAccount() {
  process.env.DATABASE_URL = 'file:' + path.join(projectRoot, 'resources', 'data', 'box.sqlite').replace(/\\/g, '/');
  const { PrismaClient } = require(path.join(codeRoot, 'node_modules', '@prisma', 'client'));
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({ where: { username: USER.username } });
    const created = await prisma.user.create({ data: { username: USER.username, passwordHash: hashPassword(USER.password) } });
    await prisma.userPermission.create({ data: { userId: created.id, permission: 'uno' } });
  } finally {
    await prisma.$disconnect();
  }
}

async function removeAccount() {
  const { PrismaClient } = require(path.join(codeRoot, 'node_modules', '@prisma', 'client'));
  const prisma = new PrismaClient();
  try {
    await prisma.user.deleteMany({ where: { username: USER.username } });
    await prisma.$executeRawUnsafe("DELETE FROM LoginRecord WHERE username LIKE 'uno_ui_probe%'");
  } finally {
    await prisma.$disconnect();
  }
}

function startServer() {
  const child = spawn(process.execPath, ['code/server/index.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk) => output.push(chunk.toString('utf8')));
  return { child, output };
}

async function waitServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      return response.status;
    } catch { /* 还没起来 */ }
    await sleep(400);
  }
  return null;
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function launchChrome(chromePath) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uno-ui-'));
  const child = spawn(chromePath, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-default-browser-check',
    '--window-size=1440,1100',
    'about:blank',
  ], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (response.ok) return { child, userData };
    } catch { /* Chrome 还没起来 */ }
    await sleep(250);
  }
  throw new Error('Chrome 的 CDP 端口没有就绪');
}

async function pageTarget() {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((target) => target.type === 'page');
  if (!page) throw new Error('没有可用的 page target');
  return page.webSocketDebuggerUrl;
}

function cdpClient(socket) {
  let counter = 0;
  const pending = new Map();
  const consoleErrors = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text || 'exception');
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    counter += 1;
    pending.set(counter, resolve);
    socket.send(JSON.stringify({ id: counter, method, params }));
  });
  return { send, consoleErrors };
}

(async () => {
  let server = null;
  let chrome = null;
  const shots = [];
  try {
    if (!fs.existsSync(path.join(codeRoot, 'out', 'tools', 'uno.html')) && !fs.existsSync(path.join(codeRoot, 'out', 'tools', 'uno'))) {
      check('生产产物里已经有 UNO 页面（npm run build 的产物）', false, '没找到 code/out/tools/uno，请先执行 npm run build');
      throw new Error('缺少构建产物');
    }

    const chromePath = findChrome();
    check('找到可用的 Chrome/Edge', Boolean(chromePath), '常见安装路径里都没有找到');
    if (!chromePath) throw new Error('没有浏览器可用');

    await seedAccount();
    server = startServer();
    const status = await waitServer(60000);
    check('服务已启动（生产模式）', status !== null, `探活状态码 ${status}`);
    if (status === null) throw new Error(`服务启动超时：\n${server.output.join('').slice(-1500)}`);

    const loginResponse = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: BASE },
      body: new URLSearchParams({ username: USER.username, password: USER.password }).toString(),
    });
    const setCookie = loginResponse.headers.get('set-cookie') || '';
    const [cookieName, cookieValue] = setCookie.split(';')[0].split('=');
    check('临时账户登录成功并拿到会话 Cookie', loginResponse.status === 303 && Boolean(cookieName && cookieValue), `HTTP ${loginResponse.status}`);

    chrome = await launchChrome(chromePath);
    const socket = new WebSocket(await pageTarget(), { maxPayload: 64 * 1024 * 1024 });
    await new Promise((resolve, reject) => { socket.on('open', resolve); socket.on('error', reject); });
    const { send, consoleErrors } = cdpClient(socket);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Network.setCookie', { name: cookieName, value: cookieValue, url: BASE, path: '/' });

    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.result?.exceptionDetails) {
        throw new Error(result.result.exceptionDetails.exception?.description || 'exception');
      }
      return result.result?.result?.value;
    };
    const waitFor = async (expression, timeoutMs, label) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await evaluate(expression)) return true;
        await sleep(200);
      }
      throw new Error(`等待超时：${label}`);
    };
    const shoot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = path.join(SHOT_DIR, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(result.result.data, 'base64'));
      shots.push(file);
      return file;
    };
    const clickExpr = (selector) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`;
    const clickTextExpr = (selector, text) => `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = nodes.find((node) => (node.textContent || '').trim() === ${JSON.stringify(text)});
      if (!el) return false;
      el.click();
      return true;
    })()`;

    await send('Page.navigate', { url: `${BASE}/tools/uno` });
    await waitFor(`!!document.querySelector('[data-action="create-room"]')`, 30000, '大厅渲染完成');
    check('大厅加载完成（建房按钮出现）', true);
    check('大厅里能看到「加入房间」输入框', Boolean(await evaluate(`!!document.querySelector('input[placeholder="6 位房间号"]')`)));
    await shoot('1-lobby');

    // 勾 1 位机器人 → 建房
    check('可以勾选机器人数量', Boolean(await evaluate(clickTextExpr('[data-action="bot-count"]', '1'))));
    await sleep(300);
    check('点击建房按钮', Boolean(await evaluate(clickExpr('[data-action="create-room"]'))));

    await waitFor(`!!document.querySelector('[data-action="start-game"]')`, 20000, '进入等待室');
    const roomId = await evaluate(`(() => {
      const node = [...document.querySelectorAll('div')].find((el) => /^\\d{6}$/.test((el.textContent || '').trim()) && String(el.className).includes('font-mono'));
      return node ? node.textContent.trim() : '';
    })()`);
    check('等待室显示 6 位房间号', /^\d{6}$/.test(String(roomId)), `读到「${roomId}」`);
    check('等待室里机器人已经入座', Boolean(await evaluate(`document.body.innerText.includes('机器人')`)));
    await shoot('2-waiting-room');

    check('点击开始牌局', Boolean(await evaluate(clickExpr('[data-action="start-game"]'))));
    await waitFor(`document.querySelectorAll('[data-card-id]').length === 7`, 25000, '牌桌发牌（7 张手牌）');
    check('牌桌渲染出 7 张自己的手牌', true);
    check('牌桌能看到弃牌堆顶牌', Boolean(await evaluate(`!!document.querySelector('[data-uno-top]')`)));
    check('牌桌能看到对手座位（机器人）与牌背数量', Boolean(await evaluate(`document.body.innerText.includes('机器人')`)));
    await shoot('3-table');

    // 等轮到自己 → 抓一张（抓牌在轮到自己时一定可用，比出牌更稳）
    await waitFor(`(() => { const el = document.querySelector('[data-action="draw"]'); return !!el && !el.disabled; })()`, 60000, '轮到自己（抓牌按钮可用）');
    const handBefore = await evaluate(`document.querySelectorAll('[data-card-id]').length`);
    check('轮到自己时抓牌按钮可用', true);
    check('点击「抓一张」', Boolean(await evaluate(clickExpr('[data-action="draw"]'))));
    await waitFor(`document.body.innerText.includes('摸了')`, 15000, '抓牌结果出现在日志里');
    const handAfter = await evaluate(`document.querySelectorAll('[data-card-id]').length`);
    check('抓牌后日志出现记录，手牌数量随之变化', handAfter !== handBefore, `抓牌前 ${handBefore} 张 → 抓牌后 ${handAfter} 张`);
    await shoot('4-after-draw');

    // 出一张能出的普通牌（避开万能牌，免得还要先选颜色）
    const playableId = await evaluate(`(() => {
      const nodes = [...document.querySelectorAll('[data-playable="1"]')];
      const target = nodes.find((node) => !String(node.getAttribute('data-card-id') || '').startsWith('wild-'));
      return target ? target.getAttribute('data-card-id') : '';
    })()`);
    if (playableId) {
      const topBefore = await evaluate(`document.querySelector('[data-uno-top]')?.getAttribute('title') || ''`);
      check(`点击一张能出的牌（${playableId}）`, Boolean(await evaluate(clickExpr(`[data-card-id="${playableId}"]`))));
      await waitFor(`(document.querySelector('[data-uno-top]')?.getAttribute('title') || '') !== ${JSON.stringify(topBefore)}`, 15000, '出牌后弃牌堆顶变化');
      check('出牌后弃牌堆顶牌真的变了', true, `原来是「${topBefore}」`);
      await shoot('5-after-play');
    } else {
      check('（这一手没有可出的普通牌，跳过出牌点击；抓牌链路已覆盖）', true);
    }

    // 移动端：竖屏与横屏两套布局（手牌要压得进屏幕，不能横向溢出）
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    const portrait = await evaluate(`(() => {
      const cards = [...document.querySelectorAll('[data-card-id]')];
      const rights = cards.map((node) => node.getBoundingClientRect().right);
      const hand = document.querySelector('[data-uno-hand]');
      const felt = document.querySelector('[data-uno-felt]');
      return {
        cards: cards.length,
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        maxRight: rights.length ? Math.max(...rights) : 0,
        width: window.innerWidth,
        vh: window.innerHeight,
        handTop: hand ? Math.round(hand.getBoundingClientRect().top) : -1,
        feltBottom: felt ? Math.round(felt.getBoundingClientRect().bottom) : -1,
      };
    })()`);
    check('手机竖屏：手牌仍然全部渲染', portrait.cards >= 7, `看到 ${portrait.cards} 张`);
    check('手机竖屏：手牌没有超出屏幕', portrait.maxRight <= portrait.width + 6, `最右侧 ${Math.round(portrait.maxRight)}px / 屏幕 ${portrait.width}px`);
    check('手机竖屏：页面不产生横向滚动', portrait.overflow <= 6, `超出 ${portrait.overflow}px`);
    check(
      '手机竖屏：手牌落在首屏（牌桌先看到、手牌紧跟着）',
      portrait.handTop > 0 && portrait.handTop < portrait.vh + 260,
      `手牌顶部 ${portrait.handTop}px / 屏幕高 ${portrait.vh}px，牌桌底部 ${portrait.feltBottom}px`,
    );
    await shoot('6-mobile-portrait');

    await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    const landscape = await evaluate(`(() => {
      const card = document.querySelector('[data-card-id]');
      const hand = document.querySelector('[data-uno-hand]');
      const felt = document.querySelector('[data-uno-felt]');
      return {
        handVisible: !!card && card.getBoundingClientRect().height > 20,
        tableVisible: !!document.querySelector('[data-uno-top]'),
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        vh: window.innerHeight,
        handTop: hand ? Math.round(hand.getBoundingClientRect().top) : -1,
        sideBySide: Boolean(hand && felt && hand.getBoundingClientRect().left > felt.getBoundingClientRect().right - 8),
      };
    })()`);
    check('手机横屏：牌桌与手牌都在', landscape.handVisible && landscape.tableVisible, `横向溢出 ${landscape.overflow}px`);
    check('手机横屏：手牌落在首屏', landscape.handTop > 0 && landscape.handTop < landscape.vh + 80, `手牌顶部 ${landscape.handTop}px / 屏幕高 ${landscape.vh}px`);
    check('手机横屏：牌桌与手牌左右并排（不用往下翻）', landscape.sideBySide, `并排=${landscape.sideBySide}`);
    await shoot('7-mobile-landscape');
    await send('Emulation.clearDeviceMetricsOverride');
    await sleep(300);

    check('整个流程里浏览器没有 JS 报错', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } catch (error) {
    check('UI 冒烟流程未抛异常', false, error?.message || String(error));
  } finally {
    if (chrome && !KEEP) {
      chrome.child.kill();
      await sleep(500);
    }
    if (server && !KEEP) {
      server.child.kill();
      await sleep(800);
    }
    try { await removeAccount(); } catch { /* 清理失败不影响结论 */ }

    const failed = checks.filter((item) => !item.ok);
    console.log('');
    console.log(failed.length
      ? `❌ ${failed.length} 项未通过`
      : `✅ 全部通过（${checks.length} 项）｜截图：${shots.join('、') || '无'}`);
    process.exit(failed.length ? 1 : 0);
  }
})();