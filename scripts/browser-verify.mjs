// 浏览器端到端验证：无头 Chrome + CDP，测 CSS 层叠解释器（纯画廊 + 解释按钮）
// 用法：node scripts/browser-verify.mjs  （需先 node server/index.js 跑在 9999）
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9222;
const APP = 'http://localhost:9999/tools/css-cascade';

// 真实 globals.css，用于画廊「贴入真实 CSS」用例
const GLOBALS_CSS = fs.readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

// 大文件压测：1500 条生成规则（约 90KB），点「解释」应出现加载层并完成，不卡死
const BIG_CSS = Array.from({ length: 1500 }, (_, i) => {
  const color = `#${((i * 2654435761) >>> 0).toString(16).padStart(6, '0').slice(0, 6)}`;
  return `.cls-${i} { color: ${color}; margin-top: ${i % 40}px; }`;
}).join('\n');

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

    const waitReady = async () => {
      for (let i = 0; i < 60; i++) {
        const r = await send('Runtime.evaluate', {
          expression: `!!document.querySelector('.cc-gallery-toolbar') && !!document.querySelector('.cc-explain-btn')`,
          returnByValue: true,
        });
        if (r.result?.result?.value === true) return true;
        await sleep(250);
      }
      return false;
    };
    const appReady = await waitReady();
    check('页面加载完成（工具栏 + 解释按钮就绪）', appReady);
    if (!appReady) throw new Error('页面未就绪');

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

    // 原生 setter 写 React 受控输入（textarea / input）
    const pasteExpr = (selector, value) => `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
        : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event(${JSON.stringify(el.tagName === 'SELECT' ? 'change' : 'input')}, { bubbles: true }));
      return true;
    })()`;

    // 等待画廊解释完成（工具栏出现且总数 > 0）
    const waitDone = async (minTotal = 1, maxWait = 20000) => {
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const r = await runExpr(`(async () => {
          if (!document.querySelector('.cc-loading')) {
            const tb = document.querySelector('.cc-gallery-toolbar');
            if (tb) {
              const m = (tb.textContent || '').match(/命中 (\\d+) 条规则/);
              if (m && Number(m[1]) >= ${minTotal}) return { done: true, total: Number(m[1]) };
            }
          }
          return { done: false };
        })()`);
        if (r && r.done) return r;
        await sleep(80);
      }
      return { done: false };
    };

    // 切换视图（🧊 全息滑轨 / 🧱 卡片画廊）
    const switchView = async (label) => {
      await runExpr(`(() => {
        const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').includes(${JSON.stringify(label)}));
        if (b) b.click();
        return !!b;
      })()`);
      await sleep(600);
    };

    // ============ E1：默认进入全息滑轨（内置示例已解释） ============
    const e1 = await runExpr(`(async () => {
      await new Promise(r => setTimeout(r, 500));
      const stage = !!document.querySelector('.cc-rail-stage');
      const front = document.querySelector('.cc-rail-card--front');
      const frontText = (front||{}).textContent || '';
      const progress = (document.querySelector('.cc-rail-progress-text')||{}).textContent?.trim() || '';
      const atChips = document.querySelectorAll('.cc-rail-atchip').length;
      const explainBtn = !!document.querySelector('.cc-explain-btn');
      const tbText = (document.querySelector('.cc-gallery-toolbar')||{}).textContent || '';
      const filterBar = tbText.length > 0;
      const noDemo = !document.querySelector('iframe[title="demo"]');
      const noSimTab = ![...document.querySelectorAll('button')].some(b => b.textContent.includes('层叠模拟'));
      const noDirty = !document.body.textContent.includes('内容已修改');
      const galleryHidden = document.querySelectorAll('.cc-rule-card').length === 0;
      const toggle = [...document.querySelectorAll('button')].some(b => b.textContent?.includes('全息滑轨'));
      const total = Number((tbText.match(/命中 (\\d+) 条规则/) || [])[1]);
      return { ok: stage && !!front && atChips===2 && explainBtn && filterBar && noDemo && noSimTab && noDirty && galleryHidden && toggle && total === 8 && progress.startsWith('1 / 8'),
        frontHead: frontText.slice(0, 24), progress, atChips, total, galleryHidden };
    })()`);
    check('默认进入全息滑轨（正面卡 + 进度 1/8 + 2 特殊声明）', e1.ok, JSON.stringify(e1));

    // 后续画廊用例切到卡片画廊
    await switchView('卡片画廊');

    // ============ E2：编辑 CSS → 画廊不自动刷新，出现「已修改」提示 ============
    const e2 = await runExpr(`(async () => {
      const cardsBefore = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      const ta = document.querySelector('textarea[aria-label="css"]');
      setter.call(ta, ta.value + '\\n.new-rule { color: red; }');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
      const cardsAfter = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      const dirty = document.body.textContent.includes('内容已修改');
      const reExplain = [...document.querySelectorAll('button')].some(b => b.textContent.includes('重新解释'));
      return { ok: cardsBefore === cardsAfter && dirty && reExplain && cardsAfter === 8, cardsBefore, cardsAfter, dirty, reExplain };
    })()`);
    check('编辑 CSS 不自动刷新，显示「重新解释」提示', e2.ok, JSON.stringify(e2));

    // ============ E3：贴入 globals.css → 点「解释」→ 全量解析完成 ============
    await runExpr(`(async () => {
      const ta = document.querySelector('textarea[aria-label="css"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(GLOBALS_CSS)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      return true;
    })()`);
    // 此时画廊仍是旧结果
    const e3a = await runExpr(`(() => {
      const cards = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      return { ok: cards === 8, cards };
    })()`);
    check('贴入真实 globals.css 后画廊保持旧结果（不卡死）', e3a.ok, JSON.stringify(e3a));

    await runExpr(`(() => {
      const btn = document.querySelector('.cc-explain-btn');
      if (btn) btn.click();
      return true;
    })()`);
    const e3 = await waitDone(200);
    check('点击解释 → globals.css 全量解析完成', e3.done, `total=${e3.total}`);

    const e3b = await runExpr(`(async () => {
      const ruleCards = [...document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)')];
      const atCards = document.querySelectorAll('.cc-atrule-card').length;
      const sels = ruleCards.map(c => (c.querySelector('.cc-sel')||{}).textContent || '');
      const garbage = sels.filter(s => /^(0%|from|to|\\d+%)$/.test(s.trim()));
      const layerTags = ruleCards.filter(c => c.querySelector('.cc-tag-layer')).length;
      const kfCards = [...document.querySelectorAll('.cc-atrule-card')].filter(c => c.querySelector('.cc-frame-chip')).length;
      const noDirty = !document.body.textContent.includes('内容已修改');
      return { ok: ruleCards.length>=100 && garbage.length===0 && layerTags>50 && kfCards>30 && atCards>30 && noDirty,
        loaded: ruleCards.length, atCards, garbage: garbage.slice(0,3), layerTags, kfCards };
    })()`);
    check('解释结果干净：无 keyframe 垃圾规则 / @layer 标记 / keyframes 卡', e3b.ok, JSON.stringify(e3b));

    // ============ E4：滚动到底 → 分块懒加载补全 ============
    const e4 = await runExpr(`(async () => {
      const sc = document.querySelector('.cc-gallery-scroll');
      if (!sc) return { ok:false, err:'no scroll container' };
      const before = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      for (let i=0;i<10;i++) {
        sc.scrollTop = sc.scrollHeight;
        await new Promise(r=>setTimeout(r,300));
      }
      const after = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      const toolbar = (document.querySelector('.cc-gallery-toolbar')||{}).textContent||'';
      const total = Number((toolbar.match(/命中 (\\d+) 条规则/)||[])[1]);
      return { ok: after>before && after===total && total>200, before, after, total };
    })()`);
    check('滚动到底 → 分块懒加载补全规则卡', e4.ok, JSON.stringify(e4));

    // ============ E5：搜索 / 排序 / @layer 筛选 ============
    const e5 = await runExpr(`(async () => {
      const input = document.querySelector('input[aria-label="搜索规则"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '.cc-rule-card'); input.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const mid = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      setter.call(input, 'zzz_no_match_zzz'); input.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const empty = document.body.textContent.includes('没有匹配当前筛选的规则');
      setter.call(input, ''); input.dispatchEvent(new Event('input', {bubbles:true}));
      await new Promise(r=>setTimeout(r,400));

      const sel = document.querySelector('select[aria-label="排序"]');
      const setSel = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setSel.call(sel, 'spec-desc'); sel.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const badges = [...document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card) .cc-spec-badge')].map(b => b.textContent.trim().replace(/[(),]/g,''));
      const specs = badges.map(s => s.split(',').map(Number));
      let breaks = 0;
      for (let i=1;i<specs.length;i++) {
        const [a1,b1,c1]=specs[i-1], [a2,b2,c2]=specs[i];
        if (a1*1e6+b1*1e3+c1 < a2*1e6+b2*1e3+c2) breaks++;
      }
      setSel.call(sel, 'source'); sel.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise(r=>setTimeout(r,300));

      const chip = [...document.querySelectorAll('.cc-gallery-toolbar button')].find(b => b.textContent.trim().includes('@layer'));
      chip.click();
      await new Promise(r=>setTimeout(r,400));
      const cards = [...document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)')];
      const allLayer = cards.length>0 && cards.every(c => !!c.querySelector('.cc-tag-layer'));
      chip.click();
      await new Promise(r=>setTimeout(r,300));

      return { ok: mid>0 && empty && specs.length>100 && breaks===0 && allLayer, mid, empty, specs:specs.length, breaks, allLayer };
    })()`);
    check('画廊搜索 / 排序 / @layer 筛选可用', e5.ok, JSON.stringify(e5));

    // ============ E6：点击规则卡 → 详情卡（特异性分解 + 独立效果预览） ============
    const e6 = await runExpr(`(async () => {
      const card = document.querySelector('.cc-rule-card:not(.cc-atrule-card)');
      if (!card) return { ok:false, err:'no card' };
      card.click();
      await new Promise(r=>setTimeout(r,500));
      const detail = document.querySelector('.cc-detail-card');
      const hasSpec = !!detail && !!detail.querySelector('.cc-spec-a') && !!detail.querySelector('.cc-spec-b') && !!detail.querySelector('.cc-spec-c');
      const hasSel = !!detail && !!detail.querySelector('.cc-rule-selector');
      const probe = detail ? detail.querySelector('iframe[title="single-rule-preview"]') : null;
      const closeBtn = detail ? detail.querySelector('.cc-detail-card button, .cc-detail-card [role="dialog"] button') || detail.querySelector('button') : null;
      if (closeBtn) closeBtn.click();
      await new Promise(r=>setTimeout(r,300));
      const closed = !document.querySelector('.cc-detail-card');
      return { ok: !!detail && hasSpec && hasSel && closed, hasSpec, hasSel, hasProbe: !!probe, closed };
    })()`);
    check('点击规则卡 → 详情卡（特异性分解，可关闭）', e6.ok, JSON.stringify(e6));

    // ============ E7：hover 规则卡 → 源码行高亮 ============
    const e7 = await runExpr(`(async () => {
      const card = document.querySelector('.cc-rule-card:not(.cc-atrule-card)');
      if (!card) return { ok:false, err:'no card' };
      card.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
      await new Promise(r=>setTimeout(r,400));
      const bars = document.querySelectorAll('.cc-editor-hover-bar').length;
      const hovered = card.classList.contains('cc-gallery-hovered');
      card.dispatchEvent(new MouseEvent('mouseout', { bubbles:true }));
      return { ok: bars>0 && hovered, bars, hovered };
    })()`);
    check('hover 规则卡 → 源码行高亮联动', e7.ok, JSON.stringify(e7));

    // ============ E8：大文件（1500 条）点解释 → 加载层出现 + 完成不卡死 ============
    await runExpr(`(async () => {
      const ta = document.querySelector('textarea[aria-label="css"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(BIG_CSS)});
      ta.dispatchEvent(new Event('input', { bubbles:true }));
      await new Promise(r=>setTimeout(r,400));
      return true;
    })()`);
    const e8 = await runExpr(`(async () => {
      const btn = document.querySelector('.cc-explain-btn');
      btn.click();
      // 立即高频轮询：加载层应真实出现在屏幕上（工作态绘制后才同步解析）
      let sawLoading = false;
      const start = Date.now();
      while (Date.now() - start < 3000) {
        if (document.querySelector('.cc-loading')) { sawLoading = true; break; }
        await new Promise(r=>setTimeout(r,10));
      }
      // 等完成
      let done = false, total = 0;
      for (let i=0;i<200;i++) {
        const tb = document.querySelector('.cc-gallery-toolbar');
        if (tb) {
          const m = (tb.textContent||'').match(/命中 (\\d+) 条规则/);
          if (m) { total = Number(m[1]); if (total === 1500) { done = true; break; } }
        }
        await new Promise(r=>setTimeout(r,100));
      }
      const sels = [...document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card) .cc-sel')].map(c=>c.textContent||'');
      const garbage = sels.filter(s => /^(0%|from|to)$/.test(s.trim()));
      return { ok: sawLoading && done && total===1500 && garbage.length===0, sawLoading, done, total, garbage: garbage.length };
    })()`);
    check('大文件（1500 条）解释：加载层出现 + 完成无垃圾规则', e8.ok, JSON.stringify(e8));

    // ============ E9：重置示例 → 回到 8 条 ============
    const e9 = await runExpr(`(async () => {
      const resetBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('重置示例'));
      if (!resetBtn) return { ok:false, err:'no reset btn' };
      resetBtn.click();
      let total = 0;
      for (let i=0;i<100;i++) {
        const tb = document.querySelector('.cc-gallery-toolbar');
        if (tb) {
          const m = (tb.textContent||'').match(/命中 (\\d+) 条规则/);
          if (m) { total = Number(m[1]); if (total === 8) break; }
        }
        await new Promise(r=>setTimeout(r,100));
      }
      const noDirty = !document.body.textContent.includes('内容已修改');
      return { ok: total === 8 && noDirty, total };
    })()`);
    check('重置示例 → 恢复内置 8 条', e9.ok, JSON.stringify(e9));

    // ============ 全息滑轨用例（重置后的 8 条内置示例） ============
    await switchView('全息滑轨');

    // E10：窗口虚拟化渲染 + 正面卡含特异性三柱
    const e10 = await runExpr(`(async () => {
      await new Promise(r=>setTimeout(r,400));
      const stage = !!document.querySelector('.cc-rail-stage');
      const cards = document.querySelectorAll('.cc-rail-card').length;
      const front = document.querySelector('.cc-rail-card--front');
      const specBars = front ? front.querySelectorAll('.cc-rail-spec-fill').length : 0;
      const progress = (document.querySelector('.cc-rail-progress-text')||{}).textContent?.trim() || '';
      return { ok: stage && cards>=3 && cards<=9 && specBars===3 && progress.startsWith('1 / 8'),
        cards, specBars, progress };
    })()`);
    check('全息滑轨：窗口虚拟化渲染 + 正面卡特异性三柱', e10.ok, JSON.stringify(e10));

    // E11：右箭头导航 → 聚焦前移
    const e11 = await runExpr(`(async () => {
      const btn = document.querySelector('.cc-rail-nav--right');
      if (!btn) return { ok:false, err:'no nav right' };
      btn.click();
      await new Promise(r=>setTimeout(r,650));
      const p1 = (document.querySelector('.cc-rail-progress-text')||{}).textContent?.trim() || '';
      btn.click();
      await new Promise(r=>setTimeout(r,650));
      const p2 = (document.querySelector('.cc-rail-progress-text')||{}).textContent?.trim() || '';
      const frontSel = (document.querySelector('.cc-rail-card--front .cc-sel')||{}).textContent || '';
      return { ok: p1.startsWith('2 / 8') && p2.startsWith('3 / 8'), p1, p2, frontSel: frontSel.slice(0,24) };
    })()`);
    check('全息滑轨：右箭头导航聚焦前移（2/8 → 3/8）', e11.ok, JSON.stringify(e11));

    // E12：点侧卡 → 聚焦到那张
    const e12 = await runExpr(`(async () => {
      const side = document.querySelector('.cc-rail-card--side');
      if (!side) return { ok:false, err:'no side card' };
      side.click();
      await new Promise(r=>setTimeout(r,650));
      const p = (document.querySelector('.cc-rail-progress-text')||{}).textContent?.trim() || '';
      return { ok: p !== '3 / 8', p };
    })()`);
    check('全息滑轨：点击侧卡聚焦到对应规则', e12.ok, JSON.stringify(e12));

    // E13：点正面卡 → 详情卡
    const e13 = await runExpr(`(async () => {
      const front = document.querySelector('.cc-rail-card--front');
      if (!front) return { ok:false, err:'no front' };
      front.click();
      await new Promise(r=>setTimeout(r,500));
      const detail = document.querySelector('.cc-detail-card');
      const hasSpec = !!detail && !!detail.querySelector('.cc-spec-a') && !!detail.querySelector('.cc-spec-b') && !!detail.querySelector('.cc-spec-c');
      const closeBtn = detail ? detail.querySelector('button') : null;
      if (closeBtn) closeBtn.click();
      await new Promise(r=>setTimeout(r,300));
      const closed = !document.querySelector('.cc-detail-card');
      return { ok: !!detail && hasSpec && closed, hasSpec, closed };
    })()`);
    check('全息滑轨：点正面卡 → 详情卡（可关闭）', e13.ok, JSON.stringify(e13));

    // E14：hover 滑轨卡 → 源码行高亮 + 卡片增亮
    const e14 = await runExpr(`(async () => {
      const front = document.querySelector('.cc-rail-card--front');
      if (!front) return { ok:false, err:'no front' };
      front.dispatchEvent(new MouseEvent('mouseover', { bubbles:true }));
      await new Promise(r=>setTimeout(r,400));
      const bars = document.querySelectorAll('.cc-editor-hover-bar').length;
      const hovered = front.classList.contains('cc-rail-card--hovered');
      front.dispatchEvent(new MouseEvent('mouseout', { bubbles:true }));
      return { ok: bars>0 && hovered, bars, hovered };
    })()`);
    check('全息滑轨：hover → 源码行高亮联动', e14.ok, JSON.stringify(e14));

    // E15：点 at-rule chip → at-rule 详情
    const e15 = await runExpr(`(async () => {
      const chip = document.querySelector('.cc-rail-atchip');
      if (!chip) return { ok:false, err:'no chip' };
      chip.click();
      await new Promise(r=>setTimeout(r,500));
      const detail = document.querySelector('.cc-detail-card');
      const hasAtName = !!detail && !!detail.querySelector('.cc-atrule-name');
      const closeBtn = detail ? detail.querySelector('button') : null;
      if (closeBtn) closeBtn.click();
      await new Promise(r=>setTimeout(r,300));
      const closed = !document.querySelector('.cc-detail-card');
      return { ok: !!detail && hasAtName && closed, hasAtName, closed };
    })()`);
    check('全息滑轨：at-rule 全息条 → 点击开详情', e15.ok, JSON.stringify(e15));

    // E16：切回画廊 → 8 张卡
    await switchView('卡片画廊');
    const e16 = await runExpr(`(async () => {
      await new Promise(r=>setTimeout(r,400));
      const cards = document.querySelectorAll('.cc-rule-card:not(.cc-atrule-card)').length;
      const railGone = !document.querySelector('.cc-rail-stage');
      return { ok: cards === 8 && railGone, cards, railGone };
    })()`);
    check('切回卡片画廊 → 8 张卡', e16.ok, JSON.stringify(e16));

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
