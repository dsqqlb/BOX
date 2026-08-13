// 截图验证 GUI 视觉效果
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9223;
const APP = 'http://localhost:9999/tools/css-cascade';
const OUT = path.resolve('scripts/shots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-shot-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,1000', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let list;
    for (let i = 0; i < 40; i++) {
      try { list = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); if (list.length) break; } catch {}
      await sleep(250);
    }
    const page = list.find((t) => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    let id = 0; const pending = new Map();
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
    const send = (method, params = {}) => new Promise((r) => { const mid = ++id; pending.set(mid, r); ws.send(JSON.stringify({ id: mid, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      return r.result?.result?.value;
    };
    const shot = async (name) => {
      await sleep(300);
      const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, captureBeyondViewport: false });
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, name + '.jpg'), Buffer.from(r.result.data, 'base64'));
      console.log('saved', name);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: APP });
    await sleep(2500);
    await shot('01-initial');

    // 点击元素 → 瀑布
    await evalJs(`(async () => {
      const frame = document.querySelector('iframe[title="demo"]');
      const el = frame.contentDocument.querySelector('h2.panel-title');
      el.dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles:true, cancelable:true }));
      await new Promise(r=>setTimeout(r,1000));
    })()`);
    await shot('02-waterfall');

    // 打开详情卡
    await evalJs(`(async () => {
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const cp = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono')||{}).textContent||'').trim()==='color');
      const seg = [...cp.querySelectorAll('.cc-seg')].find(s => s.textContent.includes('.panel .panel-title'));
      seg.click();
      await new Promise(r=>setTimeout(r,700));
    })()`);
    await shot('03-detail-card');

    ws.close();
  } finally {
    try { proc.kill(); } catch {}
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
