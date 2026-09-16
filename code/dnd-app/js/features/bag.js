/* ============================================================
   背包 & 物品管理
   ------------------------------------------------------------
   钱与物品都拆成「个人 / 团队」两套独立账目（bagItems[owner] /
   currency[owner]），页面顶部用 owner 标签切换，切换只换渲染的
   数据源，DOM 结构复用。
   货币不再是孤零零的总数：每次变动（无论是直接改输入框，还是用
   「＋ 记一笔」记多币种收支）都会在 bag_ledger[owner] 里留一条流水
   （时间+备注+各币种增减），可在列表里逐条撤销单笔记录。
============================================================ */
(function () {
  const OWNER_LABEL = { personal: '个人', team: '团队' };
  const CUR_KEYS  = ['pp', 'gp', 'sp', 'cp'];
  const CUR_LABEL = { cp: '铜', sp: '银', gp: '金', pp: '铂' };

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(t) {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /* ── 迁移旧数据：旧的单一物品数组 → bag_items.personal，
     旧的单一 currency 总数 → currency.personal，团队账目从空白开始 ── */
  function migrateBagItems() {
    const saved = load('bag_items', null);
    if (saved && !Array.isArray(saved)) return { personal: saved.personal || [], team: saved.team || [] };
    let personal = [];
    if (Array.isArray(saved)) {
      personal = saved.filter(it => !it.id.startsWith('_c')).map(it => ({ ...it, qty: it.qty ?? 1 }));
    } else {
      const old = [...load('equip_items', []), ...load('misc_items', [])].filter(it => !it.id.startsWith('_c'));
      const map = {};
      old.forEach(it => {
        if (map[it.id]) map[it.id].qty = (map[it.id].qty || 1) + (it.qty || 1);
        else map[it.id] = { ...it, qty: it.qty ?? 1 };
      });
      personal = Object.values(map);
    }
    return { personal, team: [] };
  }

  function migrateCurrency() {
    const saved = load('currency', null);
    const blank = () => ({ cp: 0, sp: 0, gp: 0, pp: 0 });
    if (saved && ('personal' in saved || 'team' in saved)) {
      return { personal: { ...blank(), ...saved.personal }, team: { ...blank(), ...saved.team } };
    }
    if (saved) return { personal: { ...blank(), ...saved }, team: blank() };
    return { personal: blank(), team: blank() };
  }

  /* 旧的记事本是个人/团队共用的一份 equip_notepad，迁移到 personal，团队从空白开始 */
  function migrateNotepad() {
    const saved = load('notepad', null);
    if (saved && (saved.personal || saved.team)) return { personal: saved.personal || [], team: saved.team || [] };
    return { personal: load('equip_notepad', []), team: [] };
  }

  let bagItems = migrateBagItems();
  let currency = migrateCurrency();
  let notepad  = migrateNotepad();
  let ledger   = load('bag_ledger', { personal: [], team: [] });
  let owner    = load('bagOwner', 'personal');

  const bagPresetList = $('equip-preset-list');

  /* ── owner 切换标签 ── */
  const panelEquip = $('panel-equip');
  function markOwner() {
    if (panelEquip) panelEquip.classList.toggle('owner-team', owner === 'team');
  }
  markOwner();
  document.querySelectorAll('.bag-owner-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.owner === owner);
    btn.addEventListener('click', () => {
      if (btn.dataset.owner === owner) return;
      owner = btn.dataset.owner;
      save('bagOwner', owner);
      document.querySelectorAll('.bag-owner-tab').forEach(b => b.classList.toggle('active', b === btn));
      markOwner();
      renderAll();
    });
  });

  function renderAll() { renderBag(); renderCurrency(); renderLedger(); renderNotepad(); }

  /* ── chip 构建工具 ── */
  function makeQtyChip(name, qty, onDelta, onRemove) {
    const el = document.createElement('div');
    el.className = 'item-chip';
    el.innerHTML =
      `<span class="item-chip-name">${name}</span>` +
      `<span class="item-chip-fill"></span>` +
      `<span class="item-qty-row">` +
        `<button class="item-qty-btn" data-dir="-1">−</button>` +
        `<span class="item-qty-val">${qty}</span>` +
        `<button class="item-qty-btn" data-dir="1">＋</button>` +
      `</span>` +
      `<button class="item-chip-remove">✕</button>`;
    el.querySelectorAll('.item-qty-btn').forEach(btn =>
      btn.addEventListener('click', () => onDelta(+btn.dataset.dir))
    );
    el.querySelector('.item-chip-remove').addEventListener('click', onRemove);
    return el;
  }

  /* ── 物品渲染（按当前 owner）── */
  function renderBag() {
    bagPresetList.innerHTML = '';
    (bagItems[owner] || []).forEach(item => {
      const db = ITEM_DB.find(d => d.id === item.id);
      if (!db) return;
      bagPresetList.appendChild(makeQtyChip(db.name, item.qty,
        delta => {
          const before = item.qty;
          item.qty = Math.max(1, item.qty + delta);
          save('bag_items', bagItems); renderBag();
          if (item.qty !== before && typeof logEvent === 'function') {
            const diff = item.qty - before;
            logEvent('bag', '🎒', `[${OWNER_LABEL[owner]}] ${db.name} ×${item.qty}（${diff > 0 ? '+' : ''}${diff}）`);
          }
        },
        ()    => {
          bagItems[owner] = bagItems[owner].filter(e => e.id !== item.id);
          save('bag_items', bagItems); renderBag();
          if (typeof logEvent === 'function') logEvent('bag', '🎒', `[${OWNER_LABEL[owner]}] 移除 ${db.name}`);
        }
      ));
    });
    renderWeight();
  }

  /* ── 重量统计 + 搬运上限（5e：力量 × 15，只对个人物品生效）── */
  function renderWeight() {
    const total = (bagItems[owner] || []).reduce((sum, item) => {
      const db = ITEM_DB.find(d => d.id === item.id);
      return sum + (db ? db.weight * item.qty : 0);
    }, 0);
    const rounded = Math.round(total * 10) / 10;
    document.getElementById('total-weight').textContent = rounded;

    const capEl   = document.getElementById('weight-cap');
    const summary = document.getElementById('weight-summary');
    if (owner === 'personal') {
      const cap = (CHAR.abilities.str || 0) * 15;   // 搬运上限 = 力量得分 × 15
      if (capEl) { capEl.style.display = ''; capEl.textContent = '/ ' + cap; }
      if (summary) summary.classList.toggle('weight-over', rounded > cap);
    } else {
      if (capEl) capEl.style.display = 'none';   /* 团队物品不套用个人搬运上限 */
      if (summary) summary.classList.remove('weight-over');
    }
  }

  /* ── 货币显示（按当前 owner）── */
  function renderCurrency() {
    CUR_KEYS.forEach(k => {
      const el = document.getElementById('cur-' + k);
      if (el) el.value = currency[owner][k];
    });
  }

  /* 直接编辑余额输入框：提交时算出差额，记一条「手动调整」流水 */
  CUR_KEYS.forEach(key => {
    const el = document.getElementById('cur-' + key);
    if (!el) return;
    let before = currency[owner][key];
    el.addEventListener('focus', () => { before = currency[owner][key]; });
    el.addEventListener('input', () => {
      currency[owner][key] = parseInt(el.value) || 0;   /* 编辑中只更新内存，提交(change)时才落盘，便于整体撤销 */
    });
    el.addEventListener('change', () => {
      const d = currency[owner][key] - before;
      save('currency', currency);
      if (d) addLedgerEntry({ [key]: d }, '手动调整');
      before = currency[owner][key];
    });
  });

  /* ── 收支流水：每笔变动都留痕，余额 = 手动余额 + 流水累积影响 ── */
  function addLedgerEntry(deltas, note) {
    const amounts = { cp: 0, sp: 0, gp: 0, pp: 0, ...deltas };
    ledger[owner].push({ id: uid(), t: Date.now(), amounts, note: note || '' });
    save('bag_ledger', ledger);
    renderLedger();
    if (typeof logEvent === 'function') {
      const parts = CUR_KEYS.filter(k => amounts[k]).map(k => `${amounts[k] > 0 ? '+' : ''}${amounts[k]}${CUR_LABEL[k]}`).join(' ');
      logEvent('bag', '🪙', `[${OWNER_LABEL[owner]}] ${parts}${note ? '：' + note : ''}`);
    }
  }

  function renderLedger() {
    const list = $('ledger-list');
    if (!list) return;
    list.innerHTML = '';
    const entries = ledger[owner] || [];
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'ledger-empty';
      empty.textContent = '暂无流水记录';
      list.appendChild(empty);
      return;
    }
    [...entries].reverse().forEach(entry => {
      const amtHtml = CUR_KEYS.filter(k => entry.amounts[k]).map(k => {
        const v = entry.amounts[k];
        return `<span class="${v > 0 ? 'amt-pos' : 'amt-neg'}">${v > 0 ? '+' : ''}${v}${CUR_LABEL[k]}</span>`;
      }).join('');
      const row = document.createElement('div');
      row.className = 'ledger-row';
      row.innerHTML =
        `<span class="ledger-time">${fmtDate(entry.t)}</span>` +
        `<span class="ledger-note">${entry.note || ''}</span>` +
        `<span class="ledger-amounts">${amtHtml}</span>` +
        `<button class="ledger-remove">✕</button>`;
      row.querySelector('.ledger-remove').addEventListener('click', () => {
        ledger[owner] = ledger[owner].filter(e => e.id !== entry.id);
        CUR_KEYS.forEach(k => { currency[owner][k] -= entry.amounts[k] || 0; });   /* 撤回这笔对余额的影响 */
        save('bag_ledger', ledger);
        save('currency', currency);
        renderCurrency();
        renderLedger();
        if (typeof logEvent === 'function') logEvent('bag', '🪙', `[${OWNER_LABEL[owner]}] 删除流水：${entry.note || '（无备注）'}`);
      });
      list.appendChild(row);
    });
  }

  /* ── 「＋ 记一笔」弹窗：先选收入/支出方向，再填各币种数额（非负），一次多币种同记 ──
     常用项（收入/支出各一套）自带预设金额，点一下备注+金额一起填好；
     也可以自己填好备注+金额后点「☆ 存为常用」存成新的常用项，全部存在 localStorage，
     可无限自定义、逐条删除，不需要改代码。 */
  const ledgerModal  = $('ledger-modal');
  const presetsEl    = $('ledger-presets');
  let ledgerType = 'income';   // 'income' | 'expense'，决定提交时的正负号

  const blankAmt = () => ({ cp: 0, sp: 0, gp: 0, pp: 0 });
  const DEFAULT_PRESETS = {
    income: [
      { id: 'inc-reward',  label: '冒险奖励', amounts: { ...blankAmt(), gp: 10 } },
      { id: 'inc-loot',    label: '卖战利品', amounts: { ...blankAmt(), gp: 5 } },
      { id: 'inc-bounty',  label: '悬赏酬金', amounts: { ...blankAmt(), gp: 20 } },
      { id: 'inc-labor',   label: '打工零工', amounts: { ...blankAmt(), sp: 5 } },
    ],
    expense: [
      { id: 'exp-inn',     label: '住宿',      amounts: { ...blankAmt(), gp: 1 } },
      { id: 'exp-food',    label: '餐饮',      amounts: { ...blankAmt(), sp: 3 } },
      { id: 'exp-travel',  label: '路费',      amounts: { ...blankAmt(), sp: 5 } },
      { id: 'exp-supply',  label: '药水/材料', amounts: { ...blankAmt(), gp: 5 } },
      { id: 'exp-repair',  label: '修理装备',  amounts: { ...blankAmt(), gp: 2 } },
      { id: 'exp-bribe',   label: '贿赂/打点', amounts: { ...blankAmt(), gp: 10 } },
      { id: 'exp-heal',    label: '医疗',      amounts: { ...blankAmt(), gp: 5 } },
    ],
  };
  let ledgerPresets = load('ledger_presets', DEFAULT_PRESETS);
  if (!ledgerPresets.income) ledgerPresets.income = [];
  if (!ledgerPresets.expense) ledgerPresets.expense = [];

  function fmtPresetAmt(amounts) {
    return CUR_KEYS.filter(k => amounts[k]).map(k => `${amounts[k]}${CUR_LABEL[k]}`).join(' ') || '0';
  }

  function renderPresets() {
    presetsEl.innerHTML = '';
    ledgerPresets[ledgerType].forEach(preset => {
      const chip = document.createElement('button');
      chip.className = 'ledger-preset-chip';
      chip.innerHTML =
        `<span>${preset.label}</span>` +
        `<span class="ledger-preset-amt">${fmtPresetAmt(preset.amounts)}</span>` +
        `<span class="ledger-preset-remove">✕</span>`;
      chip.addEventListener('click', e => {
        if (e.target.classList.contains('ledger-preset-remove')) {
          ledgerPresets[ledgerType] = ledgerPresets[ledgerType].filter(p => p.id !== preset.id);
          save('ledger_presets', ledgerPresets);
          renderPresets();
          return;
        }
        $('ledger-note').value = preset.label;
        CUR_KEYS.forEach(k => { $('ledger-' + k).value = preset.amounts[k] || 0; });
      });
      presetsEl.appendChild(chip);
    });
  }
  renderPresets();

  $('ledger-save-preset').addEventListener('click', () => {
    const label = $('ledger-note').value.trim();
    if (!label) { $('ledger-note').focus(); return; }
    const amounts = blankAmt();
    CUR_KEYS.forEach(k => { amounts[k] = Math.abs(parseInt($('ledger-' + k).value) || 0); });
    ledgerPresets[ledgerType] = ledgerPresets[ledgerType].filter(p => p.label !== label);   /* 同名覆盖 */
    ledgerPresets[ledgerType].push({ id: uid(), label, amounts });
    save('ledger_presets', ledgerPresets);
    renderPresets();
  });

  function setLedgerType(type) {
    ledgerType = type;
    document.querySelectorAll('.ledger-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
    renderPresets();
  }

  document.querySelectorAll('.ledger-type-btn').forEach(btn => {
    btn.addEventListener('click', () => setLedgerType(btn.dataset.type));
  });

  $('btn-ledger-add').addEventListener('click', () => {
    setLedgerType('income');
    CUR_KEYS.forEach(k => { $('ledger-' + k).value = 0; });
    $('ledger-note').value = '';
    ledgerModal.classList.remove('hidden');
    $('ledger-note').focus();
  });
  $('ledger-modal-close').addEventListener('click', () => ledgerModal.classList.add('hidden'));
  ledgerModal.addEventListener('click', e => { if (e.target === ledgerModal) ledgerModal.classList.add('hidden'); });

  $('ledger-submit').addEventListener('click', () => {
    const sign = ledgerType === 'expense' ? -1 : 1;
    const deltas = {};
    let any = false;
    CUR_KEYS.forEach(k => {
      const v = Math.abs(parseInt($('ledger-' + k).value) || 0);
      deltas[k] = v * sign;
      if (v) any = true;
    });
    if (!any) return;
    CUR_KEYS.forEach(k => { currency[owner][k] += deltas[k]; });
    save('currency', currency);
    renderCurrency();
    addLedgerEntry(deltas, $('ledger-note').value.trim());
    ledgerModal.classList.add('hidden');
  });

  /* ── 记事本：个人 / 团队各一份，切标签时把同一批输入框的内容换成对应 owner 的 ── */
  const NOTEPAD_ROWS = 20;
  let notepadInputs = [];
  function initNotepad(containerId) {
    const container = $(containerId);
    for (let i = 0; i < NOTEPAD_ROWS; i++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'notepad-line';
      inp.addEventListener('input', () => {
        notepad[owner] = notepadInputs.map(el => el.value);
        save('notepad', notepad);
      });
      container.appendChild(inp);
      notepadInputs.push(inp);
    }
    renderNotepad();
  }

  function renderNotepad() {
    const vals = notepad[owner] || [];
    notepadInputs.forEach((inp, i) => { inp.value = vals[i] || ''; });
  }

  /* ── 物品模态框（展示全部预设物品） ── */
  const modal      = $('item-modal');
  const modalTitle = $('item-modal-title');
  const modalTabs  = $('item-modal-tabs');
  const modalList  = $('item-modal-list');
  let   modalCategory = 'all';
  let   modalSearch   = '';

  const CAT_LABELS = { weapon: '武器', armor: '护甲', gear: '装备', consumable: '消耗品' };
  const ITEM_CATS  = [
    { key: 'all',        label: '全部' },
    { key: 'weapon',     label: '武器' },
    { key: 'armor',      label: '护甲' },
    { key: 'gear',       label: '装备' },
    { key: 'consumable', label: '消耗品' },
  ];

  function renderModalTabs() {
    modalTabs.innerHTML = '';
    ITEM_CATS.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'item-tab' + (cat.key === modalCategory ? ' active' : '');
      btn.textContent = cat.label;
      btn.addEventListener('click', () => {
        modalCategory = cat.key;
        renderModalTabs();
        renderModalList();
      });
      modalTabs.appendChild(btn);
    });
  }

  function renderModalList() {
    modalList.innerHTML = '';
    const query = modalSearch.toLowerCase();
    const base  = modalCategory === 'all' ? ITEM_DB : ITEM_DB.filter(it => it.category === modalCategory);
    const items = query
      ? base.filter(it => it.name.toLowerCase().includes(query) || it.nameEn.toLowerCase().includes(query))
      : base;
    let lastCat = null;
    items.forEach(item => {
      if (modalCategory === 'all' && item.category !== lastCat) {
        lastCat = item.category;
        const hdr = document.createElement('div');
        hdr.className = 'item-cat-header';
        hdr.textContent = CAT_LABELS[item.category] || item.category;
        modalList.appendChild(hdr);
      }
      const already = bagItems[owner].some(e => e.id === item.id);
      const row     = document.createElement('div');
      row.className = 'item-row' + (already ? ' added' : '');
      row.innerHTML =
        `<div class="item-row-name">${item.name} <span class="item-name-en">${item.nameEn}</span></div>` +
        `<div class="item-row-props">${item.props}</div>`;
      if (!already) row.addEventListener('click', () => addPreset(item.id));
      modalList.appendChild(row);
    });
  }

  function addPreset(id) {
    const existing = bagItems[owner].find(e => e.id === id);
    if (existing) { existing.qty++; }
    else { bagItems[owner].push({ id, qty: 1 }); }
    save('bag_items', bagItems);
    renderBag();
    renderModalList();
    if (typeof logEvent === 'function') {
      const db = ITEM_DB.find(d => d.id === id);
      if (db) logEvent('bag', '🎒', `[${OWNER_LABEL[owner]}] 获得 ${db.name}${existing ? `（×${existing.qty}）` : ''}`);
    }
  }

  document.querySelectorAll('.btn-item-add').forEach(btn => {
    btn.addEventListener('click', () => {
      modalCategory = 'all';
      modalSearch   = '';
      document.getElementById('item-modal-search').value = '';
      modalTitle.textContent = `选择物品（${OWNER_LABEL[owner]}）`;
      renderModalTabs();
      renderModalList();
      modal.classList.remove('hidden');
    });
  });

  $('item-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  document.getElementById('item-modal-search').addEventListener('input', e => {
    modalSearch = e.target.value.trim();
    renderModalList();
  });

  save('bag_items', bagItems);
  save('currency', currency);
  save('notepad', notepad);
  save('bag_ledger', ledger);
  renderAll();
  initNotepad('equip-notepad');

  /* 撤销还原后，重新载入背包/货币/流水并刷新 */
  document.addEventListener('undorestore', () => {
    bagItems = load('bag_items', bagItems);
    currency = load('currency', currency);
    notepad  = load('notepad', notepad);
    ledger   = load('bag_ledger', ledger);
    renderAll();
  });
}());
