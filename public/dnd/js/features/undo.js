/* ============================================================
   撤销上一步
   ------------------------------------------------------------
   原理：包一层 save()，把“同一次操作（同一事件循环）内改动的键 + 旧值”
   收集成一条事务。凡是这次操作**新增了一条日志**（sessions 多出一条 entry）
   的，就记为一个可撤销点。撤销时只还原这几个键的旧值、连带移除那条日志、
   重渲染，并短暂提示撤销了什么。

   · 只记录“产生了日志的操作”，所以拖滑块、切页、改主题等不会污染撤销栈。
   · 只还原该操作真正改过的键，不会把之后的无关改动一起回退。
============================================================ */
(function () {

  const MAX = 50;

  /* state 对象里的键：还原后同步内存 state 并集中重渲染 */
  const STATE_KEYS = [
    'hp', 'maxHp', 'tempHp', 'slots', 'cantripIds', 'preparedIds',
    'deathSave', 'exhaustion', 'channel', 'hitDice', 'tempSpells', 'buffs', 'buffPicks',
    'buffDurations', 'concentration', 'luckyDice', 'xp', 'xpToNextManual', 'skillProfs', 'sessions', 'currentSessionId',
  ];
  /* 键为空(从未存过)时的兜底默认，避免还原成 undefined 导致渲染崩溃 */
  const DEFAULTS = {
    hp: CHAR.maxHp, maxHp: CHAR.maxHp, tempHp: 0, slots: [],
    cantripIds: [], preparedIds: [],
    deathSave: { success: [false, false, false], fail: [false, false, false] },
    exhaustion: new Array(6).fill(false),
    channel: [], hitDice: [], tempSpells: [], buffs: {}, buffPicks: [], buffDurations: {},
    concentration: null, luckyDice: 0, xp: 0, xpToNextManual: null, skillProfs: [], sessions: [], currentSessionId: null,
  };

  const undoStack = [];
  let txn = null;
  let isUndoing = false;

  /* ──── 包一层 save()，记录每次操作改动的键的旧值 ──── */
  const _origSave = window.save;
  window.save = function (key, val) {
    if (!isUndoing) recordSave(key);
    return _origSave(key, val);
  };

  function recordSave(key) {
    if (!txn) { txn = {}; queueMicrotask(flushTxn); }
    if (!(key in txn)) txn[key] = localStorage.getItem('dnd_' + key);   /* 旧值(可能为 null) */
  }

  /* 事件循环结束时结算这次事务 */
  function flushTxn() {
    const t = txn;
    txn = null;
    if (!t || !('sessions' in t)) return;              /* 没写日志 → 不可撤销 */
    const added = findAddedEntry(t['sessions']);
    if (!added) return;                                /* sessions 变了但没“新增”条目(如删除/重命名) → 跳过 */
    if (added.cat === 'timer') return;                 /* 开始/暂停/继续/结束跑团 → 不可撤销 */
    undoStack.push({ delta: t, label: (added.icon ? added.icon + ' ' : '') + added.text });
    if (undoStack.length > MAX) undoStack.shift();
    updateBtn();
  }

  /* 对比旧 sessions 与当前，找出这次新增的那条日志条目 */
  function findAddedEntry(oldRaw) {
    let oldIds = new Set();
    try {
      (oldRaw ? JSON.parse(oldRaw) : []).forEach(s => (s.entries || []).forEach(e => oldIds.add(e.id)));
    } catch (e) {}
    for (const s of state.sessions) {
      for (const e of (s.entries || [])) {
        if (!oldIds.has(e.id)) return e;
      }
    }
    return null;
  }

  /* 供外部调用：清空撤销历史（如结束跑团后）*/
  window.clearUndoHistory = function () {
    undoStack.length = 0;
    updateBtn();
  };

  /* ──── 执行撤销 ──── */
  function performUndo() {
    if (!undoStack.length) return;
    const rec = undoStack.pop();
    isUndoing = true;

    const extraKeys = [];
    Object.keys(rec.delta).forEach(k => {
      const oldRaw = rec.delta[k];
      if (oldRaw === null) localStorage.removeItem('dnd_' + k);
      else localStorage.setItem('dnd_' + k, oldRaw);

      if (STATE_KEYS.includes(k)) {
        if (oldRaw === null) state[k] = JSON.parse(JSON.stringify(DEFAULTS[k] !== undefined ? DEFAULTS[k] : null));
        else { try { state[k] = JSON.parse(oldRaw); } catch (e) {} }
      } else {
        extraKeys.push(k);   /* bag_items / currency 等交给各模块自行重载 */
      }
    });

    if (typeof reconcileState === 'function') reconcileState();   /* 修正法术位/引导神力形状 */
    isUndoing = false;

    renderAll();
    if (extraKeys.length) {
      document.dispatchEvent(new CustomEvent('undorestore', { detail: { keys: extraKeys } }));
    }
    updateBtn();
    showToast('已撤销：' + rec.label);
  }

  function renderAll() {
    const fns = [
      typeof renderHp === 'function' && renderHp,
      typeof renderSpellPanel === 'function' && renderSpellPanel,
      typeof renderDeathSaves === 'function' && renderDeathSaves,
      typeof renderExhaustion === 'function' && renderExhaustion,
      typeof renderChannel === 'function' && renderChannel,
      typeof renderHitDice === 'function' && renderHitDice,
      typeof renderTempSpells === 'function' && renderTempSpells,
      typeof renderBuffs === 'function' && renderBuffs,
      typeof renderConcentration === 'function' && renderConcentration,
      typeof renderLuckyDice === 'function' && renderLuckyDice,
      typeof renderXp === 'function' && renderXp,
      typeof renderSkills === 'function' && renderSkills,
      typeof window.renderTimer === 'function' && window.renderTimer,
      typeof window.renderLog === 'function' && window.renderLog,
    ];
    fns.forEach(fn => { if (fn) { try { fn(); } catch (e) {} } });
  }

  /* ──── 短暂提示 ──── */
  let toastTimer = null;
  function showToast(msg) {
    const el = $('undo-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function updateBtn() {
    const btn = $('btn-undo');
    if (btn) btn.classList.toggle('hidden', undoStack.length === 0);
  }

  /* ──── 绑定 ──── */
  $('btn-undo').addEventListener('click', performUndo);
  updateBtn();

})();
