/* ============================================================
   角色卡存档：字段级同步的「三方比对」判定（纯函数，无副作用）

   存档是 localStorage 里一堆 dnd_* 键，值都是 JSON 字符串。
   为了既能跨设备同步、又绝不静默丢改动，客户端额外记住
   「每个键最后一次成功推到服务器的原样值」= acked 表
   （存在 localStorage 的 box-dnd-sync-acked，不带 dnd_ 前缀，不参与快照/备份）。

   有了它，逐键就能判断差异的来源：

     本地有 / 服务器有，相同                      → 无事（记 acked）
     本地有 / 服务器有，不同：
        本地 == acked   → 本地已同步，是服务器变了 → 采纳服务器的
        否则            → 本地有未推送的改动       → 保留本地并推上去
                          （服务器的值同时写进冲突暂存，绝不静默丢）
     本地有 / 服务器没有：
        本地 == acked   → 服务器那边删了它         → 本地也删
        否则            → 本地新增的键             → 推上去
     本地没有 / 服务器有：
        acked 无记录    → 全新浏览器               → 采纳服务器的（首次灌入）
        有记录          → 本地删过它               → 推删除(null)
============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DndSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function has(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

  /* 从 localStorage 里收集某个前缀的全部键（值保持原样字符串） */
  function collect(prefix, store) {
    var out = {};
    for (var i = 0; i < store.length; i++) {
      var key = store.key(i);
      if (key && key.indexOf(prefix) === 0) out[key.slice(prefix.length)] = store.getItem(key);
    }
    return out;
  }

  function decide(local, server, acked) {
    local = local || {};
    server = server || {};
    acked = acked || {};
    var plan = { synced: {}, adopt: {}, removeLocal: [], push: {}, pushDelete: [], conflicts: {} };
    var keys = {};
    var key;
    for (key in local) if (has(local, key)) keys[key] = true;
    for (key in server) if (has(server, key)) keys[key] = true;

    for (key in keys) {
      var inLocal = has(local, key);
      var inServer = has(server, key);
      var hasAcked = has(acked, key);
      var localValue = inLocal ? local[key] : null;
      var serverValue = inServer ? server[key] : null;

      if (inLocal && inServer) {
        if (localValue === serverValue) { plan.synced[key] = localValue; continue; }
        if (hasAcked && acked[key] === localValue) { plan.adopt[key] = serverValue; continue; }
        plan.push[key] = localValue;        /* 本地有未推送的改动 → 本地优先 */
        plan.conflicts[key] = serverValue;  /* 但服务器那份留档，绝不静默丢 */
        continue;
      }
      if (inLocal && !inServer) {
        if (hasAcked && acked[key] === localValue) { plan.removeLocal.push(key); continue; }
        plan.push[key] = localValue;
        continue;
      }
      /* !inLocal && inServer */
      if (!hasAcked) { plan.adopt[key] = serverValue; continue; }
      plan.pushDelete.push(key);
    }
    return plan;
  }

  return { collect: collect, decide: decide };
});
