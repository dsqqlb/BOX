/* ============================================================
   账户云同步 (Server Sync)
   ------------------------------------------------------------
   存档是 localStorage 里一堆 dnd_* 键（值都是 JSON 字符串）。
   本文件负责「本地 → 服务器」的写回：拦截 dnd_* 的写入，防抖后
   只把【变化的键】POST 到 /api/dnd/save（字段级增量），
   不再每次重传整包，也就不会用旧快照覆盖掉别人的新改动。

   · 额外记录「每个键最后一次成功推上去的原样值」(acked)，用于判断某个键的
     差异到底是「别的设备改了」还是「我本地还没推上去」——见 sync-merge.js。
   · 「服务器 → 本地」的合并判定在 index.html 的 <head> 内联脚本里做。
   · 未登录(401)、无权限(403)或网络失败时静默回退，绝不打断本地操作；
     失败的改动会留在待推送集合里，下次改动或下次打开页面时重试。
============================================================ */
(function () {
  if (typeof localStorage === 'undefined' || typeof fetch === 'undefined') return;

  var ACK_KEY = 'box-dnd-sync-acked';
  var PREFIX = 'dnd_';
  var DEBOUNCE_MS = 1200;
  var MAX_KEYS_PER_PUSH = 200;

  var pending = {};      /* key -> 原样字符串；null 表示该键已被删除 */
  var pendingCount = 0;
  var timer = null;

  function readAcked() {
    try { return JSON.parse(localStorage.getItem(ACK_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeAcked(map) {
    try { localStorage.setItem(ACK_KEY, JSON.stringify(map)); } catch (e) { /* 配额满就算了，只影响冲突判定 */ }
  }

  /* 把某个键标记为待推送（值取当前 localStorage 原样内容；已被删除时是 null） */
  function mark(fullKey) {
    if (!fullKey || fullKey.indexOf(PREFIX) !== 0) return;
    var key = fullKey.slice(PREFIX.length);
    if (!key) return;
    if (!(key in pending)) pendingCount += 1;
    pending[key] = localStorage.getItem(fullKey);
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { push(); }, DEBOUNCE_MS);
  }

  function schedulePushSoon() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { push(); }, 50);
  }

  /* 冷启动对账：本地和 acked 不一致的键（上次推送失败、或本次页面加载时
     sync.js 还没装上就发生的写入）重新排队，保证最终一致。 */
  function reconcileOnStart() {
    var acked = readAcked();
    var local = {};
    var key;
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) local[k.slice(PREFIX.length)] = localStorage.getItem(k);
    }
    for (key in local) {
      if (!(key in acked) || acked[key] !== local[key]) {
        if (!(key in pending)) pendingCount += 1;
        pending[key] = local[key];
      }
    }
    for (key in acked) {
      if (!(key in local)) {
        if (!(key in pending)) pendingCount += 1;
        pending[key] = null;   /* 本地删过它，服务器可能还有 */
      }
    }
    if (pendingCount > 0) schedulePushSoon();
  }

  function takeBatch() {
    var batch = {};
    var count = 0;
    for (var key in pending) {
      if (count >= MAX_KEYS_PER_PUSH) break;
      batch[key] = pending[key];
      delete pending[key];
      count += 1;
    }
    pendingCount -= count;
    if (pendingCount < 0) pendingCount = 0;
    return batch;
  }

  function requeue(batch) {
    for (var key in batch) {
      if (!(key in pending)) pendingCount += 1;
      pending[key] = batch[key];
    }
  }

  function acknowledge(batch) {
    var acked = readAcked();
    for (var key in batch) acked[key] = batch[key];   /* 删除记为 null = "我知道它没了" */
    writeAcked(acked);
  }

  /* 把待推送的键发出去。成功 → 更新 acked；失败 → 放回队列等下次。
     返回 Promise<boolean>，供「改完立刻刷新」的路径等待落库。 */
  function push(options) {
    if (timer) { clearTimeout(timer); timer = null; }
    var batch = takeBatch();
    if (!Object.keys(batch).length) return Promise.resolve(true);

    var request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ data: batch }),
    };
    if (options && options.keepalive) request.keepalive = true;

    var send = function () {
      try {
        return fetch('/api/dnd/save', request).then(function (response) {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          acknowledge(batch);
          if (pendingCount > 0) schedulePushSoon();
          return true;
        }).catch(function () {
          requeue(batch);       /* 网络/服务端失败：静默，下次再试 */
          return false;
        });
      } catch (error) {
        requeue(batch);
        return Promise.resolve(false);
      }
    };

    /* 关页面：来不及等响应，也不更新 acked —— 失败了下次打开会对账重推，安全。 */
    if (options && options.keepalive) { send(); return Promise.resolve(true); }
    return send();
  }

  /* 供「改完立刻刷新页面」的路径（角色配置保存 / 恢复默认 / 导入备份）使用：
     必须先把改动推到服务器并等它落库，再刷新，否则新页面启动时会从服务器
     拉到旧值覆盖本地，刚做的改动就被回滚了。 */
  window.__dndPushSave = function () { return push(); };

  /* 拦截 dnd_* 的写入：setItem/removeItem 是 save()、撤销、导入备份等
     所有持久化路径的最终落点，一处覆盖即可全覆盖。 */
  var nativeSetItem = localStorage.setItem.bind(localStorage);
  var nativeRemoveItem = localStorage.removeItem.bind(localStorage);

  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    mark(key);
  };
  localStorage.removeItem = function (key) {
    nativeRemoveItem(key);
    mark(key);
  };

  /* 关页面前把还没推上去的改动带上（keepalive 保证请求能发出去）。 */
  window.addEventListener('beforeunload', function () {
    if (pendingCount > 0) push({ keepalive: true });
  });

  reconcileOnStart();
})();
