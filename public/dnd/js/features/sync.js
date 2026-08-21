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

  function push() {
    dirty = false;
    if (timer) { clearTimeout(timer); timer = null; }
    try {
      fetch('/api/dnd/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ data: snapshot() }),
      }).catch(function () { /* 网络失败：静默，下次改动再试 */ });
    } catch (e) { /* 忽略 */ }
  }

  function schedule() {
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(push, DEBOUNCE_MS);
  }

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
    if (dirty) push();
  });
})();
