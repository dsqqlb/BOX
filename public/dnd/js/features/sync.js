/* ============================================================
   账户云同步 (Server Sync)
   ------------------------------------------------------------
   原本所有数据只存 localStorage（dnd_ 前缀）。这里把它接到 BOX 的
   /api/dnd/save 接口：任何对 dnd_* 键的写入（save()、撤销、导入备份等）
   都会被拦截，防抖后把全量快照 POST 回服务器，实现按账户自动保存。

   · 「读取」（服务器 → 本地）在 index.html 的 <head> 内联脚本里做，
     本文件只负责「写回」。
   · 未登录(401)、无权限(403)或网络失败时静默回退，绝不打断本地操作。
============================================================ */
(function () {
  if (typeof localStorage === 'undefined' || typeof fetch === 'undefined') return;

  var DEBOUNCE_MS = 800;
  var timer = null;
  var dirty = false;

  /* 收集所有 dnd_* 键，值保持 localStorage 里的原始 JSON 字符串；
     服务器端按「键 → 字符串」不透明映射原样存取，双方都不解析。 */
  function snapshot() {
    var data = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('dnd_') === 0) data[k.slice(4)] = localStorage.getItem(k);
    }
    return data;
  }

  /* opts.keepalive 只在「关页面来不及等响应」时使用。
     ⚠ 浏览器对 keepalive 请求体有 64KiB 上限，超限会被静默拒绝；
     存档快照会随跑团日志变大，所以常规防抖保存不带它。 */
  function push(opts) {
    dirty = false;
    if (timer) { clearTimeout(timer); timer = null; }
    var req = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ data: snapshot() }),
    };
    if (opts && opts.keepalive) req.keepalive = true;
    try {
      return fetch('/api/dnd/save', req)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return true; })
        .catch(function () { return false; }); /* 网络/服务端失败：静默，下次改动再试 */
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function schedule() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { push(); }, DEBOUNCE_MS);
  }

  /* 供「改完立刻刷新页面」的路径（角色配置保存 / 恢复默认 / 导入备份）使用：
     必须先把新数据推到服务器并等它落库，再刷新。否则新页面启动时会从服务器
     拉到旧存档、覆盖刚改的本地数据，改动就被永久回滚了。 */
  window.__dndPushSave = function () { return push(); };


  /* 拦截 dnd_* 的写入，统一触发自动保存。setItem/removeItem 是 save()、
     撤销、导入备份等所有持久化路径的最终落点，一处覆盖即可全覆盖。 */
  var _setItem = localStorage.setItem.bind(localStorage);
  var _removeItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function (k, v) {
    _setItem(k, v);
    if (k && k.indexOf('dnd_') === 0) schedule();
  };
  localStorage.removeItem = function (k) {
    _removeItem(k);
    if (k && k.indexOf('dnd_') === 0) schedule();
  };

  /* 关页面前尽量把最后的改动推上去（keepalive 保证请求能发出去）。 */
  window.addEventListener('beforeunload', function () {
    if (dirty) push({ keepalive: true });
  });
})();
