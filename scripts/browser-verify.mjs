// 浏览器端到端验证：无头 Chrome + CDP，测 CSS 层叠解释器
// 用法：node scripts/browser-verify.mjs  （需先 node server/index.js 跑在 9999）
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const APP = 'http://localhost:9999/tools/css-cascade';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-headless-'));
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--disable-gpu',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  // 等 CDP 就绪
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/list`);
      if (r.ok) return proc;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome CDP 未就绪');
}

async function getPageWsUrl() {
  const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('没有 page target');
  return page.webSocketDebuggerUrl;
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text || 'exception');
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, consoleErrors };
}

async function main() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  let chromeProc;
  try {
    chromeProc = await launchChrome();
    const ws = new WebSocket(await getPageWsUrl(), { maxPayload: 64 * 1024 * 1024 });
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    const { send, consoleErrors } = cdp(ws);

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: APP });

    // 等页面完全可交互
    const waitReady = async () => {
      for (let i = 0; i < 60; i++) {
        const r = await send('Runtime.evaluate', {
          expression: `!!document.querySelector('iframe[title="demo"]') && !!document.querySelector('.cc-panel')`,
          returnByValue: true,
        });
        if (r.result?.result?.value === true) return true;
        await sleep(250);
      }
      return false;
    };
    const ready = await waitReady();
    check('页面加载，iframe 就绪', ready);
    if (!ready) throw new Error('页面未就绪');

    const runExpr = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.result?.exceptionDetails) {
        return { __error: r.result.exceptionDetails.exception?.description || 'exception' };
      }
      return r.result?.result?.value;
    };

    // ---- 测试 1：点击 .panel-title → 瀑布出现，color 胜出者为 .panel .panel-title (#67e8f9)
    const t1 = await runExpr(`(async () => {
      await new Promise(r => setTimeout(r, 1200));
      const frame = document.querySelector('iframe[title="demo"]');
      if (!frame || !frame.contentDocument) return { ok:false, err:'no iframe' };
      const el = frame.contentDocument.querySelector('h2.panel-title');
      if (!el) return { ok:false, err:'no h2.panel-title' };
      el.dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles:true, cancelable:true }));
      await new Promise(r => setTimeout(r, 900));
      const summary = document.querySelector('.cc-summary');
      const selText = summary ? (summary.querySelector('.font-mono') || {}).textContent : null;
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const colorPipe = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono') || {}).textContent || '').trim() === 'color');
      const win = colorPipe ? colorPipe.querySelector('.cc-seg-winner') : null;
      const winnerText = win ? win.textContent.replace(/\\s+/g,' ').trim() : null;
      const hits = colorPipe ? colorPipe.querySelectorAll('.cc-seg').length : 0;
      return { ok:!!selText, selText, winnerText, hits, hasPanelTitle: !!(winnerText||'').includes('.panel .panel-title'), has67e8f9: !!(winnerText||'').includes('#67e8f9') };
    })()`);
    check('选中元素显示 selector', t1.ok && !!t1.selText, JSON.stringify(t1));
    check('.panel-title 的 color 胜出者 = .panel .panel-title', t1.hasPanelTitle, `winnerText=${t1.winnerText}`);
    check('胜出值为 #67e8f9', t1.has67e8f9, `winnerText=${t1.winnerText}`);

    // ---- 测试 2：点击 .badge → color 胜出者为 !important 规则 (#86efac)
    const t2 = await runExpr(`(async () => {
      await new Promise(r => setTimeout(r, 400));
      const frame = document.querySelector('iframe[title="demo"]');
      const el = frame.contentDocument.querySelector('.badge');
      el.dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles:true, cancelable:true }));
      await new Promise(r => setTimeout(r, 900));
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const colorPipe = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono') || {}).textContent || '').trim() === 'color');
      const win = colorPipe ? colorPipe.querySelector('.cc-seg-winner') : null;
      const winnerText = win ? win.textContent.replace(/\\s+/g,' ').trim() : null;
      const hasImp = !!(winnerText||'').includes('!important') || !!colorPipe.querySelector('.cc-seg-winner .cc-gate');
      return { ok:!!winnerText, winnerText, hasImp, has86efac: !!(winnerText||'').includes('#86efac') };
    })()`);
    check('.badge 的 color 胜出者含 !important', t2.hasImp, `winnerText=${t2.winnerText}`);
    check('胜出值为 #86efac', t2.has86efac, `winnerText=${t2.winnerText}`);

    // ---- 测试 3：点击瀑布规则 → 详情卡弹出，含独立效果 iframe
    const t3 = await runExpr(`(async () => {
      await new Promise(r => setTimeout(r, 400));
      const seg = document.querySelector('.cc-pipe .cc-seg:not(.cc-seg-winner)');
      if (!seg) return { ok:false, err:'no seg' };
      seg.click();
      await new Promise(r => setTimeout(r, 600));
      const card = document.querySelector('.cc-detail-card');
      const probe = card ? card.querySelector('iframe[title="single-rule-preview"]') : null;
      const specBadge = card ? (card.querySelector('.font-mono b') || {}).textContent : null;
      const bodyText = card ? card.textContent.includes('独立效果') : false;
      return { ok:!!card, hasProbe:!!probe, specBadge, bodyText };
    })()`);
    check('点击规则弹出详情卡', t3.ok, JSON.stringify(t3));
    check('详情卡含独立效果预览 iframe', t3.hasProbe);
    check('详情卡显示特异性', !!t3.specBadge, `spec=${t3.specBadge}`);

    // ---- 测试 4：点击"在主预览中高亮" → iframe 内出现 .cc-outline
    const t4 = await runExpr(`(async () => {
      const btn = [...document.querySelectorAll('.cc-detail-card button')].find(b => b.textContent.includes('高亮'));
      if (!btn) return { ok:false, err:'no btn' };
      btn.click();
      await new Promise(r => setTimeout(r, 500));
      const frame = document.querySelector('iframe[title="demo"]');
      const n = frame.contentDocument.querySelectorAll('.cc-outline').length;
      return { ok:n > 0, n };
    })()`);
    check('在主预览中高亮匹配元素', t4.ok, `outlines=${t4.n}`);

    // ---- 测试 5：编辑 CSS → 瀑布重新计算（加一条 !important 覆盖）
    const t5 = await runExpr(`(async () => {
      // 关闭详情卡
      const closeBtn = document.querySelector('.cc-detail-card button');
      if (closeBtn) closeBtn.click();
      await new Promise(r => setTimeout(r, 300));
      // 在 CSS 末尾追加规则
      const ta = document.querySelector('textarea[aria-label="css"]');
      if (!ta) return { ok:false, err:'no css textarea' };
      const css = ta.value;
      // React 受控组件：必须走原生 value setter 才会触发 onChange
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, css + '\\n.panel-title { color: #ff0077 !important; }');
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r => setTimeout(r, 1500));
      // 重新点击 panel-title（iframe 重载过）
      const frame = document.querySelector('iframe[title="demo"]');
      const el = frame.contentDocument.querySelector('h2.panel-title');
      el.dispatchEvent(new frame.contentWindow.MouseEvent('click', { bubbles:true, cancelable:true }));
      await new Promise(r => setTimeout(r, 900));
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const colorPipe = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono') || {}).textContent || '').trim() === 'color');
      const win = colorPipe ? colorPipe.querySelector('.cc-seg-winner') : null;
      const winnerText = win ? win.textContent.replace(/\\s+/g,' ').trim() : null;
      return { ok:!!winnerText, winnerText, hasNew: !!(winnerText||'').includes('#ff0077') };
    })()`);
    check('编辑 CSS 后 !important 规则胜出', t5.hasNew, `winnerText=${t5.winnerText}`);

    // ---- 测试 6：瀑布 hover → 源码行高亮（双向联动）
    const t6 = await runExpr(`(async () => {
      let pipe = [...document.querySelectorAll('.cc-pipe')].find(p => ((p.querySelector('.cc-pipe-head .font-mono')||{}).textContent||'').trim()==='color');
      if (!pipe) {
        const frame = document.querySelector('iframe[title="demo"]');
        frame.contentDocument.querySelector('h2.panel-title').dispatchEvent(new frame.contentWindow.MouseEvent('click',{bubbles:true,cancelable:true}));
        await new Promise(r=>setTimeout(r,900));
        pipe = [...document.querySelectorAll('.cc-pipe')].find(p => ((p.querySelector('.cc-pipe-head .font-mono')||{}).textContent||'').trim()==='color');
      }
      const seg = pipe.querySelector('.cc-seg');
      if (!seg) return { ok:false, err:'no seg' };
      seg.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
      await new Promise(r=>setTimeout(r,400));
      const bars = document.querySelectorAll('.cc-editor-hover-bar').length;
      const hovered = seg.classList.contains('cc-seg-hovered');
      return { ok: bars>0 || hovered, bars, hovered };
    })()`);
    check('瀑布 hover → 源码行高亮', t6.ok, `bars=${t6.bars} hovered=${t6.hovered}`);

    // ---- 测试 7：详情卡 probe 实际渲染出该规则的样式效果
    const t7 = await runExpr(`(async () => {
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const colorPipe = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono')||{}).textContent||'').trim()==='color');
      const segs = [...colorPipe.querySelectorAll('.cc-seg')];
      const target = segs.find(s => s.textContent.includes('.panel .panel-title'));
      if (!target) return { ok:false, err:'no .panel .panel-title seg' };
      target.click();
      await new Promise(r=>setTimeout(r,600));
      const probe = document.querySelector('.cc-detail-card iframe[title="single-rule-preview"]');
      if (!probe) return { ok:false, err:'no probe' };
      const pd = probe.contentDocument;
      const el = pd.querySelector('.panel-title');
      if (!el) return { ok:false, err:'probe 中无 .panel-title 元素', body: pd.body.innerHTML.slice(0,160) };
      const color = pd.defaultView.getComputedStyle(el).color;
      return { ok: color==='rgb(103, 232, 249)', color, hasText: el.textContent.includes('目标元素') };
    })()`);
    check('probe 独立渲染 #67e8f9 效果', t7.ok, `color=${t7.color}`);

    // ---- 测试 8：窄窗口 → @media 规则生效（.panel padding 12px）
    await send('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
    const t8 = await runExpr(`(async () => {
      await new Promise(r=>setTimeout(r,800));
      const frame = document.querySelector('iframe[title="demo"]');
      const el = frame.contentDocument.querySelector('.panel');
      if (!el) return { ok:false, err:'no .panel' };
      el.dispatchEvent(new frame.contentWindow.MouseEvent('click',{bubbles:true,cancelable:true}));
      await new Promise(r=>setTimeout(r,900));
      const pipes = [...document.querySelectorAll('.cc-pipe')];
      const padPipe = pipes.find(p => ((p.querySelector('.cc-pipe-head .font-mono')||{}).textContent||'').trim()==='padding');
      const win = padPipe ? padPipe.querySelector('.cc-seg-winner') : null;
      const winnerText = win ? win.textContent.replace(/\\s+/g,' ').trim() : null;
      return { ok: !!(winnerText||'').includes('12px'), winnerText, hasGate: !!(winnerText||'').includes('@media') };
    })()`);
    check('窄窗口下 @media 规则胜出 (padding 12px)', t8.ok, `winnerText=${t8.winnerText}`);
    await send('Emulation.clearDeviceMetricsOverride');

    // ---- 运行期错误检查 ----
    const realErrors = consoleErrors.filter((e) => !e.includes('React DevTools'));
    check('全程无运行时错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | ') || 'clean');

    ws.close();
  } finally {
    if (chromeProc) { try { chromeProc.kill(); } catch {} }
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} 通过`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error('❌ 测试失败:', e); process.exit(1); });
