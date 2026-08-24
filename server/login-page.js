'use strict';

/**
 * 登录页渲染：独立的静态 HTML 页面（不依赖 Next.js，生产静态导出也可用）。
 */

const { safeReturnPath } = require('./http-utils');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function sendLoginPage(res, hasError = false, nextPath = '/') {
  const escapedError = hasError ? '<p class="error" role="alert">用户名或密码错误，或登录尝试次数过多。</p>' : '';
  const escapedNext = escapeHtml(safeReturnPath(nextPath));
  const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>登录 · BOX</title>
  <style>
    :root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box} body{margin:0;min-width:320px;min-height:100vh;overflow-x:hidden;background:#070915;color:#eef2ff}
    .scene{position:relative;isolation:isolate;display:grid;min-height:100vh;place-items:center;padding:28px 20px;background:radial-gradient(circle at 10% 0%,rgba(91,77,211,.31),transparent 31%),radial-gradient(circle at 88% 22%,rgba(8,145,178,.18),transparent 28%),linear-gradient(160deg,#11142e 0%,#090b1a 46%,#070915 100%)}
    .scene::before{content:"";pointer-events:none;position:absolute;z-index:-1;inset:0;opacity:.42;background-image:linear-gradient(rgba(148,163,184,.09) 1px,transparent 1px),linear-gradient(90deg,rgba(148,163,184,.09) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 68%)}
    .orb{position:absolute;z-index:-1;border-radius:999px;filter:blur(68px);pointer-events:none}.orb.one{width:300px;height:300px;left:-110px;bottom:-80px;background:rgba(99,102,241,.18)}.orb.two{width:260px;height:260px;right:-90px;top:18%;background:rgba(34,211,238,.12)}
    .layout{width:min(100%,1010px);display:grid;grid-template-columns:1fr 420px;overflow:hidden;border:1px solid rgba(255,255,255,.11);border-radius:28px;background:rgba(13,16,37,.77);box-shadow:0 32px 100px rgba(0,0,0,.45);backdrop-filter:blur(20px)}
    .intro{position:relative;display:flex;min-height:470px;flex-direction:column;overflow:hidden;padding:42px;background:linear-gradient(145deg,rgba(113,91,238,.18),rgba(19,25,54,.04) 54%)}
    .intro::after{content:"";position:absolute;width:310px;height:310px;right:-140px;bottom:-140px;border:1px solid rgba(196,181,253,.22);border-radius:999px;box-shadow:0 0 0 36px rgba(167,139,250,.035),0 0 0 72px rgba(167,139,250,.025)}
    .brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none}.brandmark{display:grid;width:42px;height:42px;place-items:center;border:1px solid rgba(255,255,255,.21);border-radius:13px;background:linear-gradient(135deg,#a78bfa,#4f46e5);box-shadow:0 10px 30px rgba(99,102,241,.36)}.brandmark svg{width:24px;height:24px}.brandname{font-size:15px;font-weight:800;letter-spacing:.2em}.brand small{display:block;margin-top:3px;color:#7781a5;font-size:9px;font-weight:700;letter-spacing:.16em}
    .intro-copy{position:relative;z-index:1;margin-top:auto}.eyebrow{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:#a5f3fc;font-size:11px;font-weight:750;letter-spacing:.15em}.eyebrow::before{width:25px;height:1px;background:#67e8f9;content:""}.intro h1{max-width:360px;margin:0;color:#fff;font-size:clamp(28px,3.5vw,40px);line-height:1.14;letter-spacing:-.045em}.intro p{max-width:300px;margin:13px 0 0;color:#a8b0ca;font-size:14px;line-height:1.7}
    .login{display:flex;flex-direction:column;justify-content:center;padding:48px 44px;background:rgba(5,7,18,.33)}.login-head{margin-bottom:28px}.login-head h2{margin:0;color:#fff;font-size:24px;letter-spacing:-.03em}.login-head p{margin:9px 0 0;color:#8490af;font-size:13px;line-height:1.6}.error{margin:0 0 18px;border:1px solid rgba(251,113,133,.25);border-radius:11px;background:rgba(159,18,57,.16);padding:11px 12px;color:#fecdd3;font-size:12px;line-height:1.5}
    label{display:block;margin:18px 0 8px;color:#c6cee2;font-size:12px;font-weight:650}input{width:100%;border:1px solid rgba(255,255,255,.11);border-radius:11px;background:rgba(1,4,14,.48);padding:12px 13px;color:#f8fafc;font:inherit;font-size:14px;outline:none;transition:border-color .2s,box-shadow .2s,background .2s}input:hover{border-color:rgba(255,255,255,.2)}input:focus{border-color:rgba(103,232,249,.7);background:rgba(1,4,14,.72);box-shadow:0 0 0 4px rgba(103,232,249,.1)}
    button{width:100%;margin-top:25px;border:0;border-radius:11px;background:linear-gradient(135deg,#a78bfa,#6366f1);padding:12px 16px;color:#fff;font:inherit;font-size:14px;font-weight:760;cursor:pointer;box-shadow:0 10px 26px rgba(79,70,229,.3);transition:transform .2s,filter .2s,box-shadow .2s}button:hover{filter:brightness(1.08);box-shadow:0 13px 30px rgba(79,70,229,.42);transform:translateY(-1px)}button:focus-visible{outline:2px solid #67e8f9;outline-offset:3px}.login-foot{margin:26px 0 0;color:#66718f;font-size:11px;line-height:1.65}.login-foot strong{color:#9ba6c5;font-weight:650}
    @media(max-width:760px){.scene{padding:18px}.layout{display:block;max-width:440px;border-radius:23px}.intro{min-height:auto;padding:24px 26px}.intro-copy{display:none}.login{padding:31px 26px 34px}.login-head{margin-bottom:24px}.orb.one{left:-170px}.orb.two{right:-160px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <main class="scene">
    <span class="orb one"></span><span class="orb two"></span>
    <section class="layout" aria-label="BOX 登录">
      <div class="intro">
        <a class="brand" href="/" aria-label="BOX 私有工作台"><span class="brandmark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m16 2.5 11 5.8v15.4L16 29.5 5 23.7V8.3L16 2.5Z" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M5.3 8.5 16 14.2 26.7 8.5M16 14.2v15" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="m11.5 11.8 4.5 2.4 4.5-2.4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><span class="brandname">BOX</span><small>PRIVATE WORKSPACE</small></span></a>
        <div class="intro-copy"><div class="eyebrow">SECURE TOOL SPACE</div><h1>你的私人工具台。</h1><p>仅展示你已获授权的工具。</p></div>
      </div>
      <div class="login">
        <div class="login-head"><h2>欢迎回来</h2><p>使用已授权的账户继续进入，不支持注册</p></div>
        ${escapedError}
        <form method="post" action="/api/auth/login">
          <input type="hidden" name="next" value="${escapedNext}">
          <label for="username">用户名</label><input id="username" name="username" autocomplete="username" required maxlength="64" autofocus>
          <label for="password">密码</label><input id="password" type="password" name="password" autocomplete="current-password" required maxlength="1024">
          <button type="submit">安全进入工作台 <span aria-hidden="true">→</span></button>
        </form>
        <p class="login-foot"><strong>私有访问</strong> · 未获授权的账户无法查看工具及其数据。</p>
      </div>
    </section>
  </main>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  res.end(page);
}

module.exports = { sendLoginPage };
