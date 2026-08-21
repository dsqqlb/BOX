
/* ============================================================
   状态选择器 Modal（像法术一样挑选面板上显示哪些状态）
============================================================ */
const BUFF_CATS = [
  { key: 'all',       label: '全部' },
  { key: 'condition', label: '状态' },
  { key: 'buff',      label: '增益' },
  { key: 'tactic',    label: '战术' },
];
const BUFF_CAT_LABELS = { condition: '状态', buff: '增益', tactic: '战术' };
let buffModalCat = 'all';

function openBuffPicker() {
  buffModalCat = 'all';
  $('buff-modal-title').textContent = '选择状态标签';
  renderBuffModalTabs();
  renderBuffModalList();
  $('buff-modal').classList.remove('hidden');
}

function renderBuffModalTabs() {
  const tabs = $('buff-modal-tabs');
  tabs.innerHTML = '';
  BUFF_CATS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'sp-tab' + (c.key === buffModalCat ? ' active' : '');
    btn.textContent = c.label;
    btn.addEventListener('click', () => {
      buffModalCat = c.key;
      renderBuffModalTabs();
      renderBuffModalList();
    });
    tabs.appendChild(btn);
  });
}

function renderBuffModalList() {
  const list = $('buff-modal-list');
  list.innerHTML = '';
  const base = buffModalCat === 'all' ? BUFF_DB : BUFF_DB.filter(b => b.cat === buffModalCat);
  let lastCat = null;
  base.forEach(b => {
    /* “全部”视图下按分类插入小标题 */
    if (buffModalCat === 'all' && b.cat !== lastCat) {
      lastCat = b.cat;
      const hdr = document.createElement('div');
      hdr.className = 'item-cat-header';
      hdr.textContent = BUFF_CAT_LABELS[b.cat] || b.cat;
      list.appendChild(hdr);
    }
    const picked = state.buffPicks.includes(b.id);
    const row = document.createElement('div');
    row.className = 'picker-row' + (picked ? ' added' : '');
    const main = document.createElement('div');
    main.className = 'picker-row-main';
    main.innerHTML =
      `<div class="picker-name-area">
         <span class="picker-spell-cn">${b.name}</span>
         <span class="picker-spell-meta">${b.effect}</span>
       </div>`;
    const btn = document.createElement('button');
    btn.className = 'picker-add-btn' + (picked ? ' picker-added-btn' : '');
    btn.textContent = picked ? '移除' : '＋ 添加';
    btn.addEventListener('click', () => toggleBuffPick(b.id));
    main.appendChild(btn);
    row.appendChild(main);
    list.appendChild(row);
  });
}

function toggleBuffPick(id) {
  const i = state.buffPicks.indexOf(id);
  if (i === -1) {
    state.buffPicks.push(id);
  } else {
    state.buffPicks.splice(i, 1);
    delete state.buffs[id];        /* 移除标签时一并清除其点亮状态 */
    save('buffs', state.buffs);
  }
  save('buffPicks', state.buffPicks);
  renderBuffModalList();
  renderBuffs();
}

/* 状态选择器关闭 */
$('buff-modal-close').addEventListener('click', () => $('buff-modal').classList.add('hidden'));
$('buff-modal').addEventListener('click', e => {
  if (e.target === $('buff-modal')) $('buff-modal').classList.add('hidden');
});

function renderLuckyDice() {
  $('lucky-val').textContent = state.luckyDice;
  const pips = $('lucky-pips');
  pips.innerHTML = '';
  for (let i = 0; i < state.luckyDice && i < 20; i++) {
    const pip = document.createElement('div');
    pip.className = 'lucky-pip';
    pips.appendChild(pip);
  }
}

/* ============================================================
   法术选择器 Modal
   ------------------------------------------------------------
   两种浏览视图，共享同一份“翻阅序列”（pickerSpells）与位置（pickerIndex）：
     · 列表视图：双栏名录 → 点开进入整屏详情页（带 返回 / 上一个 / 下一个）
     · 卡片视图：法术详情以扑克牌形式堆叠，左右拨动切换
   视图选择记入 localStorage，下次打开保持。翻到当前环阶/搜索结果的头尾即停住。
============================================================ */
let pickerClass = null;        /* 当前选择器过滤到的法表职业（＋选择 从哪个职业分区打开）*/
let pickerTempAdd = false;     /* true = 选择器处于"添加临时法术"模式（不限职业，加为临时法术）*/
let pickerLevel = 0;
let pickerSearch = '';         /* 法术搜索关键词（中/英模糊）*/
let pickerView  = load('pickerView', 'list');  /* 'list' | 'card' —— 记忆上次选择 */
let pickerSpells = [];         /* 当前翻阅序列（按环阶或搜索结果顺序）*/
let pickerIndex = 0;           /* 两视图共享的当前位置 */
let pickerListDetailOpen = false;   /* 列表视图下：是否处于整屏详情页 */
let pickerSearchActive = false;     /* 当前是否为搜索结果序列（决定是否显示环阶小标）*/

/* 动态生成法术选择器的环阶标签：戏法 + 1环…最高环（最高环由 CHAR.spellSlots 决定）。
   这样以后在配置里解锁更高环，标签会自动出现，无需改 index.html。 */
function buildSpellTabs() {
  const wrap = $('spell-modal-tabs');
  if (!wrap) return;
  wrap.innerHTML = '';
  const maxLv = CHAR.spellSlots.length - 1;
  for (let lv = 0; lv <= maxLv; lv++) {
    const btn = document.createElement('button');
    btn.className = 'sp-tab' + (lv === 0 ? ' active' : '');
    btn.dataset.lv = lv;
    btn.textContent = (lv === 0) ? '戏法' : `${lv}环`;
    btn.addEventListener('click', () => {
      pickerLevel = lv;
      pickerSearch = '';                       /* 切环阶时清空搜索 */
      const box = $('spell-modal-search');
      if (box) box.value = '';
      pickerIndex = 0;                          /* 换环阶回到序列开头 */
      pickerListDetailOpen = false;             /* 回到双栏名录 */
      wrap.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderPicker();
    });
    wrap.appendChild(btn);
  }
}

/* 从某个职业分区的「＋选择」打开：过滤到该职业，标签含 戏法 + 各环，戏法与环阶合并 */
function openPicker(cls) {
  pickerClass = cls;
  pickerTempAdd = false;
  pickerLevel = 0;               /* 默认落在「戏法」标签 */
  pickerSearch = '';
  pickerIndex = 0;
  pickerListDetailOpen = false;
  const box = $('spell-modal-search');
  if (box) box.value = '';
  $('spell-modal-title').textContent = '选择法术 · ' + cls;

  /* 全部标签都显示（戏法 + 1环…最高环），选中戏法 */
  $('spell-modal-tabs').querySelectorAll('.sp-tab').forEach(tab => {
    tab.style.display = '';
    tab.classList.toggle('active', parseInt(tab.dataset.lv) === pickerLevel);
  });

  renderPicker();
  $('spell-modal').classList.remove('hidden');
}

/* 添加临时法术：选择器进入"临时"模式——不限职业，列出全部法术；
   点某条 → 弹窗设次数/恢复方式 → 加入临时法术模块（不进已备/戏法）。*/
function openTempPicker() {
  pickerTempAdd = true;
  pickerClass = null;
  pickerLevel = 0;
  pickerSearch = '';
  pickerIndex = 0;
  pickerListDetailOpen = false;
  const box = $('spell-modal-search');
  if (box) box.value = '';
  $('spell-modal-title').textContent = '添加临时法术';
  $('spell-modal-tabs').querySelectorAll('.sp-tab').forEach(tab => {
    tab.style.display = '';
    tab.classList.toggle('active', parseInt(tab.dataset.lv) === pickerLevel);
  });
  renderPicker();
  $('spell-modal').classList.remove('hidden');
}

/* 选一条法术做临时法术时，弹窗设「次数 + 恢复方式」*/
function promptTempSpell(sp) {
  showDialog({
    icon: '✦', title: '添加临时法术',
    message:
      `<div class="temp-dialog-name cinzel">${sp.name}</div>` +
      `<div class="temp-dialog-row"><span>使用次数</span>` +
      `<input id="temp-uses-input" type="number" min="1" max="20" value="1"></div>` +
      `<div class="temp-dialog-row"><span>恢复方式</span>` +
      `<select id="temp-recharge-input"><option value="long">长休恢复</option><option value="short">短休恢复</option></select></div>`,
    confirmText: '添加', cancelText: '取消',
    onConfirm: () => {
      const usesEl = $('temp-uses-input');
      const rcEl = $('temp-recharge-input');
      const uses = Math.max(1, Math.min(20, parseInt(usesEl ? usesEl.value : '1', 10) || 1));
      const recharge = (rcEl && rcEl.value === 'short') ? 'short' : 'long';
      addTempSpell(sp.id, uses, recharge);
    },
  });
}

/* 计算当前翻阅序列：搜索时忽略环阶在整池匹配，否则取当前环阶。 */
function computePickerSpells() {
  const query = pickerSearch.trim().toLowerCase();
  pickerSearchActive = !!query;
  /* 临时法术模式不限职业（列出全部）；否则只在当前分区职业的法表内匹配 */
  const inClass = sp => pickerTempAdd ? true : (Array.isArray(sp.classes) && sp.classes.includes(pickerClass));
  if (query) {
    /* 搜索时忽略环阶，在该职业整份法表里按中/英名匹配（含戏法）*/
    return SPELL_DB.filter(sp => inClass(sp) &&
      ((sp.name && sp.name.toLowerCase().includes(query)) ||
       (sp.nameEn && sp.nameEn.toLowerCase().includes(query))));
  }
  return SPELL_DB.filter(sp => sp.level === pickerLevel && inClass(sp));
}

/* 主渲染：依据当前视图与详情开关，切换显示对应面板并渲染。 */
function renderPicker() {
  pickerSpells = computePickerSpells();
  if (pickerIndex >= pickerSpells.length) pickerIndex = Math.max(0, pickerSpells.length - 1);
  if (pickerIndex < 0) pickerIndex = 0;

  const showDetail = (pickerView === 'list' && pickerListDetailOpen);
  const showCards  = (pickerView === 'card');
  const showCols   = (pickerView === 'list' && !pickerListDetailOpen);

  $('spell-modal-tabs').classList.toggle('spm-hidden', showDetail);
  $('spell-modal-search-wrap').classList.toggle('spm-hidden', showDetail);
  $('spell-modal-list').classList.toggle('spm-hidden', !showCols);
  $('spell-modal-detail').classList.toggle('spm-hidden', !showDetail);
  $('spell-modal-cards').classList.toggle('spm-hidden', !showCards);

  const tbtn = $('spell-view-toggle');
  if (tbtn) tbtn.textContent = (pickerView === 'list') ? '▦ 卡片视图' : '▤ 列表视图';

  if (showCols)        renderPickerColumns();
  else if (showDetail) renderPickerDetail();
  else                 renderPickerCards();
}

/* 法术名/英文名/元信息（三视图共用）。搜索序列下附带环阶小标便于辨识。 */
function pickerTitlesHTML(sp) {
  const lvTag = pickerSearchActive ? `${sp.level === 0 ? '戏法' : sp.level + '环'} · ` : '';
  return `
    <span class="picker-spell-cn cinzel">${sp.name}</span>
    <span class="picker-spell-en">${sp.nameEn}</span>
    <span class="picker-spell-meta">${lvTag}${sp.school}${sp.conc ? ' · 专注' : ''} · ${sp.castTime}</span>`;
}

/* 生成“＋备法 / 已备 / 领域”按钮。三视图共用；改动后回调 onChange 刷新当前视图。 */
function buildAddBtn(sp, onChange) {
  /* 临时法术添加模式：任何法术都显示「＋临时」，点开设次数/恢复方式 */
  if (pickerTempAdd) {
    const b = document.createElement('button');
    b.className = 'picker-add-btn';
    b.textContent = '＋ 临时';
    b.addEventListener('click', e => { e.stopPropagation(); promptTempSpell(sp); });
    return b;
  }

  const isDomain = allDomainIds().includes(sp.id);
  const isAdded  = (sp.level === 0)
    ? state.cantripIds.includes(sp.id)
    : state.preparedIds.includes(sp.id);

  const btn = document.createElement('button');
  btn.className = 'picker-add-btn';
  if (isDomain) {
    btn.textContent = '领域';
    btn.disabled = true;
    return btn;
  }
  if (isAdded) {
    btn.textContent = '已备';
    btn.classList.add('picker-added-btn');
  } else {
    btn.textContent = (sp.level === 0) ? '＋ 戏法' : '＋ 备法';
  }
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (isAdded) {
      (sp.level === 0) ? removeCantrip(sp.id) : removeSpell(sp.id);
    } else {
      (sp.level === 0) ? addCantrip(sp.id) : addSpell(sp.id);
    }
    if (onChange) onChange();
  });
  return btn;
}

/* ──── 列表视图：双栏名录 ──── */
function renderPickerColumns() {
  const container = $('spell-modal-list');
  container.innerHTML = '';

  if (!pickerSpells.length) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = pickerSearchActive ? '没有匹配的法术。' : '该环阶暂无法术。';
    container.appendChild(empty);
    return;
  }

  const colL = document.createElement('div'); colL.className = 'picker-col';
  const colR = document.createElement('div'); colR.className = 'picker-col';
  container.appendChild(colL);
  container.appendChild(colR);

  pickerSpells.forEach((sp, i) => {
    const isDomain = allDomainIds().includes(sp.id);
    const isAdded  = (sp.level === 0) ? state.cantripIds.includes(sp.id) : state.preparedIds.includes(sp.id);

    const row = document.createElement('div');
    row.className = 'picker-row' + ((isDomain || isAdded) ? ' added' : '');

    const main = document.createElement('div');
    main.className = 'picker-row-main';

    const nameArea = document.createElement('div');
    nameArea.className = 'picker-name-area';
    nameArea.innerHTML = pickerTitlesHTML(sp);

    main.appendChild(nameArea);
    main.appendChild(buildAddBtn(sp, renderPicker));
    row.appendChild(main);

    /* 点名字区域 → 跳转整屏详情页（不再原地展开）*/
    main.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      pickerIndex = i;
      pickerListDetailOpen = true;
      renderPicker();
    });

    (i % 2 === 0 ? colL : colR).appendChild(row);
  });
}

/* ──── 列表视图：整屏详情页（返回 / 上一个 / 下一个 / 添加）──── */
function renderPickerDetail() {
  const cont = $('spell-modal-detail');
  cont.innerHTML = '';

  const nav = document.createElement('div');
  nav.className = 'spell-detail-nav';

  const back = document.createElement('button');
  back.className = 'spell-detail-back';
  back.textContent = '‹ 返回列表';
  back.addEventListener('click', () => { pickerListDetailOpen = false; renderPicker(); });
  nav.appendChild(back);

  if (pickerSpells.length) {
    const pager = document.createElement('div');
    pager.className = 'spell-detail-pager';

    const prev = document.createElement('button');
    prev.className = 'spell-detail-step';
    prev.textContent = '‹ 上一个';
    prev.disabled = pickerIndex <= 0;
    prev.addEventListener('click', () => { if (pickerIndex > 0) { pickerIndex--; renderPickerDetail(); } });

    const count = document.createElement('span');
    count.className = 'spell-detail-count';
    count.textContent = `${pickerIndex + 1} / ${pickerSpells.length}`;

    const next = document.createElement('button');
    next.className = 'spell-detail-step';
    next.textContent = '下一个 ›';
    next.disabled = pickerIndex >= pickerSpells.length - 1;
    next.addEventListener('click', () => { if (pickerIndex < pickerSpells.length - 1) { pickerIndex++; renderPickerDetail(); } });

    pager.appendChild(prev);
    pager.appendChild(count);
    pager.appendChild(next);
    nav.appendChild(pager);
  }
  cont.appendChild(nav);

  if (!pickerSpells.length) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = pickerSearchActive ? '没有匹配的法术。' : '该环阶暂无法术。';
    cont.appendChild(empty);
    return;
  }

  const sp = pickerSpells[pickerIndex];

  const body = document.createElement('div');
  body.className = 'spell-detail-body';

  const header = document.createElement('div');
  header.className = 'spell-card-header';
  const titles = document.createElement('div');
  titles.className = 'spell-detail-titles';
  titles.innerHTML = pickerTitlesHTML(sp);
  header.appendChild(titles);
  header.appendChild(buildAddBtn(sp, renderPicker));
  body.appendChild(header);

  const detail = document.createElement('div');
  detail.innerHTML = buildDetailHTML(sp);
  body.appendChild(detail);

  cont.appendChild(body);
}

/* ──── 卡片视图：扑克牌式堆叠，左右拨动切换 ──── */
function buildSpellCard(sp) {
  const card = document.createElement('div');
  card.className = 'spell-card';

  const header = document.createElement('div');
  header.className = 'spell-card-header';
  const titles = document.createElement('div');
  titles.className = 'spell-detail-titles';
  titles.innerHTML = pickerTitlesHTML(sp);
  header.appendChild(titles);
  header.appendChild(buildAddBtn(sp, renderPicker));
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'spell-card-body';
  body.innerHTML = buildDetailHTML(sp);
  card.appendChild(body);

  return card;
}

function renderPickerCards() {
  const cont = $('spell-modal-cards');
  cont.innerHTML = '';

  if (!pickerSpells.length) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = pickerSearchActive ? '没有匹配的法术。' : '该环阶暂无法术。';
    cont.appendChild(empty);
    return;
  }

  const stack = document.createElement('div');
  stack.className = 'card-stack';

  /* 后面几张露出边缘，营造“摞在一起”的观感（纯视觉，最多 2 张）*/
  const behind = Math.min(2, pickerSpells.length - 1 - pickerIndex);
  for (let d = behind; d >= 1; d--) {
    const bg = document.createElement('div');
    bg.className = 'spell-card card-bg card-bg-' + d;
    stack.appendChild(bg);
  }

  const front = buildSpellCard(pickerSpells[pickerIndex]);
  front.classList.add('card-front');
  attachCardSwipe(front);
  stack.appendChild(front);
  cont.appendChild(stack);

  /* 底部翻页（拨动之外也可点按翻阅）*/
  const pager = document.createElement('div');
  pager.className = 'card-pager';

  const prev = document.createElement('button');
  prev.className = 'spell-detail-step';
  prev.textContent = '‹';
  prev.disabled = pickerIndex <= 0;
  prev.addEventListener('click', () => { if (pickerIndex > 0) { pickerIndex--; renderPickerCards(); } });

  const count = document.createElement('span');
  count.className = 'spell-detail-count';
  count.textContent = `${pickerIndex + 1} / ${pickerSpells.length}`;

  const next = document.createElement('button');
  next.className = 'spell-detail-step';
  next.textContent = '›';
  next.disabled = pickerIndex >= pickerSpells.length - 1;
  next.addEventListener('click', () => { if (pickerIndex < pickerSpells.length - 1) { pickerIndex++; renderPickerCards(); } });

  pager.appendChild(prev);
  pager.appendChild(count);
  pager.appendChild(next);
  cont.appendChild(pager);
}

/* 卡片左右拨动手势：竖直方向让位给卡内滚动，水平方向达到阈值则翻卡。 */
function attachCardSwipe(el) {
  let startX = 0, startY = 0, dx = 0, decided = null, active = false, pid = null;
  const T = 55;   /* 触发翻卡的水平位移阈值 */

  el.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    active = true; decided = null; startX = e.clientX; startY = e.clientY; dx = 0; pid = e.pointerId;
    el.style.transition = 'none';
  });

  el.addEventListener('pointermove', e => {
    if (!active) return;
    const mx = e.clientX - startX, my = e.clientY - startY;
    if (decided === null) {
      if (Math.abs(mx) > 8 || Math.abs(my) > 8) {
        decided = (Math.abs(mx) > Math.abs(my)) ? 'h' : 'v';
        if (decided === 'h') { try { el.setPointerCapture(pid); } catch (_) {} }
        else { active = false; el.style.transition = ''; return; }   /* 竖直 → 交回浏览器滚动 */
      } else return;
    }
    if (decided === 'h') {
      if (e.cancelable) e.preventDefault();   /* 抑制横向拖动时的原生选字/滚动 */
      dx = mx;
      el.style.transform = `translateX(${dx}px) rotate(${dx * 0.03}deg)`;
      el.style.opacity = String(1 - Math.min(Math.abs(dx) / 320, 0.35));
    }
  });

  const end = e => {
    if (!active) return;
    active = false;
    try { el.releasePointerCapture(pid); } catch (_) {}
    if (decided !== 'h') { el.style.transition = ''; return; }
    el.style.transition = '';
    const canNext = pickerIndex < pickerSpells.length - 1;
    const canPrev = pickerIndex > 0;
    if (dx <= -T && canNext) {
      el.style.transform = 'translateX(-120%) rotate(-10deg)';
      el.style.opacity = '0';
      setTimeout(() => { pickerIndex++; renderPickerCards(); }, 170);
    } else if (dx >= T && canPrev) {
      el.style.transform = 'translateX(120%) rotate(10deg)';
      el.style.opacity = '0';
      setTimeout(() => { pickerIndex--; renderPickerCards(); }, 170);
    } else {
      el.style.transform = '';
      el.style.opacity = '';
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

/* ──── 动作：添加/移除 ──── */
function addSpell(id) {
  if (state.preparedIds.length >= CHAR.maxPrepared) {
    showDialog({
      icon: '✦',
      title: '携带已满',
      message: `已达到自选备法上限（${CHAR.maxPrepared} 个）。<br>先移除一个已备法术，再添加新的。`,
      confirmText: '知道了',
    });
    return;
  }
  if (!state.preparedIds.includes(id)) {
    state.preparedIds.push(id);
    save('preparedIds', state.preparedIds);
    renderPreparedList();
  }
}

function removeSpell(id) {
  state.preparedIds = state.preparedIds.filter(i => i !== id);
  save('preparedIds', state.preparedIds);
  if (state.concentration === id) {
    state.concentration = null;
    save('concentration', state.concentration);
    renderConcentration();
  }
  document.querySelectorAll('.srow-inline-detail').forEach(el => el.remove());
  renderPreparedList();
}

function addCantrip(id) {
  if (state.cantripIds.length >= CHAR.maxCantrips) {
    showDialog({
      icon: '✦',
      title: '戏法已满',
      message: `已达到戏法上限（${CHAR.maxCantrips} 个）。<br>先移除一个戏法，再添加新的。`,
      confirmText: '知道了',
    });
    return;
  }
  if (!state.cantripIds.includes(id)) {
    state.cantripIds.push(id);
    save('cantripIds', state.cantripIds);
    renderCantripList();
  }
}

function removeCantrip(id) {
  state.cantripIds = state.cantripIds.filter(i => i !== id);
  save('cantripIds', state.cantripIds);
  if (state.concentration === id) {
    state.concentration = null;
    save('concentration', state.concentration);
    renderConcentration();
  }
  document.querySelectorAll('.srow-inline-detail').forEach(el => el.remove());
  renderCantripList();
}

/* ──── Modal 事件绑定 ──── */
buildSpellTabs();   /* 依据 CHAR.spellSlots 生成法术选择器环阶标签（含点击绑定）*/

$('spell-modal-search').addEventListener('input', e => {
  pickerSearch = e.target.value;
  pickerIndex = 0;             /* 搜索结果变化 → 回到序列开头 */
  renderPicker();
});

/* 视图切换：列表 ↔ 卡片。切到列表时进入整屏详情页以保持当前位置（返回可回名录）。 */
$('spell-view-toggle').addEventListener('click', () => {
  pickerView = (pickerView === 'list') ? 'card' : 'list';
  save('pickerView', pickerView);
  if (pickerView === 'list' && pickerSpells.length) pickerListDetailOpen = true;
  renderPicker();
});

$('spell-modal-close').addEventListener('click', () => $('spell-modal').classList.add('hidden'));
$('spell-modal').addEventListener('click', e => {
  if (e.target === $('spell-modal')) $('spell-modal').classList.add('hidden');
});

/* 「＋选择」按钮现由 render.js 的 buildSpellClassBlock 动态生成并绑定 openPicker(职业) */

/* 临时法术：「＋ 添加临时法术」打开临时选择器 */
if ($('btn-add-temp')) $('btn-add-temp').addEventListener('click', openTempPicker);

/* ============================================================
   升环施法环阶选择对话框
   holdCast 触发后，若法术带"升环施法效应"且有多档可用法术位，
   弹出本对话框询问：用本环，还是升环（升到几环），
   随后消耗对应环阶的法术位。
   若法术可仪式施法则追加「📖 仪式」按钮，不消耗法术位。
============================================================ */
function showUpcastDialog(sp, levels, isRitual) {
  $('dialog-icon').textContent = '🪄';
  $('dialog-icon').style.display = '';
  $('dialog-title').textContent = '选择施法方式';

  let opts = levels.map(lv => {
    const isBase = lv === sp.level;
    const tag = isBase ? '本环' : `升 ${lv - sp.level} 环`;
    const free = slotsFreeAt(lv);
    return `
      <button class="upcast-opt${isBase ? ' upcast-opt-base' : ''}" data-lv="${lv}">
        <span class="upcast-opt-lv cinzel">${lv} 环</span>
        <span class="upcast-opt-tag">${tag}</span>
        <span class="upcast-opt-free">剩 ${free}</span>
      </button>`;
  }).join('');

  /* 可仪式施法时追加仪式按钮 */
  if (isRitual) {
    opts += `
      <button class="upcast-opt upcast-opt-ritual" data-lv="ritual">
        <span class="upcast-opt-lv cinzel">📖 仪式</span>
        <span class="upcast-opt-tag">不消耗法术位</span>
        <span class="upcast-opt-free">+10 分钟</span>
      </button>`;
  }

  $('dialog-message').innerHTML = `
    <div class="upcast-hint">${sp.name}（本环 ${sp.level} 环）<br>选择施法方式</div>
    <div class="upcast-opts">${opts}</div>`;

  /* 只保留取消按钮，隐藏确定按钮 */
  $('dialog-confirm').style.display = 'none';
  const cancelBtn = $('dialog-cancel');
  cancelBtn.textContent = '取消';
  cancelBtn.style.display = '';
  dialogOnConfirm = null;

  $('dialog-modal').classList.remove('hidden');

  /* 绑定按钮：环阶按钮 → castSpell，仪式按钮 → castRitual */
  $('dialog-message').querySelectorAll('.upcast-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const lv = btn.dataset.lv;
      closeDialog();
      if (lv === 'ritual') {
        castRitual(sp);
      } else {
        castSpell(sp, parseInt(lv, 10));
      }
    });
  });
}

/* ============================================================
   HP 变化联动：濒死 / 脱离濒死时自动重置死亡豁免（并结束专注，因昏迷）。
   在每个改变 state.hp 的入口调用 afterHpChange(变化前HP, 变化后HP, 本次伤害)。
============================================================ */
function afterHpChange(beforeHp, afterHp, damageTaken) {
  /* —— 倒地濒死：重置死亡豁免、结束专注（昏迷不能维持专注）—— */
  if (beforeHp > 0 && afterHp === 0) {
    state.deathSave = { success: [false, false, false], fail: [false, false, false] };
    save('deathSave', state.deathSave);
    if (typeof renderDeathSaves === 'function') renderDeathSaves();
    if (state.concentration) {
      state.concentration = null;
      save('concentration', null);
      if (typeof renderConcentration === 'function') renderConcentration();
      if (typeof renderSpellPanel === 'function') renderSpellPanel();
    }
    if (typeof logEvent === 'function') logEvent('hp', '💀', '生命值归 0 · 陷入濒死，开始死亡豁免');
    return;   /* 归 0 已昏迷，不再提示专注检定 */
  }
  /* —— 脱离濒死：清空死亡豁免 —— */
  if (beforeHp === 0 && afterHp > 0) {
    state.deathSave = { success: [false, false, false], fail: [false, false, false] };
    save('deathSave', state.deathSave);
    if (typeof renderDeathSaves === 'function') renderDeathSaves();
    if (typeof logEvent === 'function') logEvent('hp', '✨', '恢复生命 · 脱离濒死、重获意识');
    return;
  }
  /* —— 濒死中再受伤：提醒记死亡豁免失败 —— */
  if (beforeHp === 0 && afterHp === 0 && damageTaken > 0) {
    if (typeof logEvent === 'function') logEvent('hp', '💀', '濒死中受到伤害 · 记 1 次死亡豁免失败（若为重击记 2 次）');
  }
}

/* ============================================================
   交互：血量编辑
============================================================ */
function startHpEdit() {
  $('hp-current').style.display = 'none';
  $('hp-input').style.display = '';
  $('hp-input').value = state.hp;
  $('hp-input').focus();
  $('hp-input').select();
}

function commitHpEdit() {
  const before = state.hp;
  let v = parseInt($('hp-input').value, 10);
  if (isNaN(v)) v = state.hp;
  state.hp = Math.max(0, Math.min(state.maxHp, v));
  save('hp', state.hp);
  $('hp-current').style.display = '';
  $('hp-input').style.display = 'none';
  renderHp();
  logHpDelta(before, state.hp);
  afterHpChange(before, state.hp, before > state.hp ? before - state.hp : 0);
}

function startMaxHpEdit() {
  $('hp-max').style.display = 'none';
  $('hp-max-input').style.display = '';
  $('hp-max-input').value = state.maxHp;
  $('hp-max-input').focus();
  $('hp-max-input').select();
}

function commitMaxHpEdit() {
  let v = parseInt($('hp-max-input').value, 10);
  if (isNaN(v) || v < 1) v = state.maxHp;
  state.maxHp = v;
  state.hp = Math.min(state.hp, state.maxHp);
  save('maxHp', state.maxHp);
  save('hp', state.hp);
  $('hp-max').style.display = '';
  $('hp-max-input').style.display = 'none';
  renderHp();
}

$('hp-current').addEventListener('click', startHpEdit);
$('hp-input').addEventListener('blur', commitHpEdit);
$('hp-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitHpEdit(); });

$('hp-max').addEventListener('click', startMaxHpEdit);
$('hp-max-input').addEventListener('blur', commitMaxHpEdit);
$('hp-max-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitMaxHpEdit(); });

function applyDamage(dmg) {
  const before = state.hp;
  const absorbed = Math.min(state.tempHp, dmg);
  state.tempHp -= absorbed;
  state.hp = Math.max(0, state.hp - (dmg - absorbed));
  save('hp', state.hp);
  save('tempHp', state.tempHp);
  $('temp-hp-slider').value = state.tempHp;
  $('temp-hp-slider-val').textContent = state.tempHp;
  renderHp();
  if (typeof logEvent === 'function') {
    const tmp = absorbed > 0 ? `（临时HP吸收 ${absorbed}）` : '';
    logEvent('hp', '💔', `受到 ${dmg} 点伤害${tmp} · 剩 ${state.hp}/${state.maxHp}`);
  }
  afterHpChange(before, state.hp, dmg);   /* 专注 DC 按总伤害算（含被临时HP吸收部分）*/
}

function applyHeal(amt) {
  const before = state.hp;
  state.hp = Math.min(state.maxHp, state.hp + amt);
  save('hp', state.hp);
  renderHp();
  const healed = state.hp - before;
  if (healed > 0 && typeof logEvent === 'function') {
    logEvent('hp', '❤', `恢复 ${healed} 点生命 · ${state.hp}/${state.maxHp}`);
  }
  afterHpChange(before, state.hp, 0);   /* 治疗无伤害 */
}

$('hp-minus').addEventListener('click',  () => applyDamage(1));
$('hp-plus').addEventListener('click',   () => applyHeal(1));
$('hp-minus5').addEventListener('click', () => applyDamage(5));
$('hp-plus5').addEventListener('click',  () => applyHeal(5));

/* 血条拖拽 / 点击 */
function setHpFromBarX(clientX) {
  const track = $('hp-bar-track');
  const rect = track.getBoundingClientRect();
  const total = state.maxHp + state.tempHp;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  state.hp = Math.min(state.maxHp, Math.round(ratio * total));
  renderHp();   /* 拖拽过程只更新界面，不落盘；松手时统一保存+记日志（便于整体撤销）*/
}

let _draggingHpBar = false;
let _hpBeforeDrag = 0;

/* 直接设定血量（拖拽血条 / 手输数值）后，把净变化记进日志（避免过程中刷屏）*/
function logHpDelta(before, after) {
  const d = after - before;
  if (!d || typeof logEvent !== 'function') return;
  if (d < 0) logEvent('hp', '💔', `失去 ${-d} 点生命 · 剩 ${after}/${state.maxHp}`);
  else       logEvent('hp', '❤', `恢复 ${d} 点生命 · ${after}/${state.maxHp}`);
}

$('hp-bar-track').addEventListener('mousedown', e => {
  _draggingHpBar = true;
  _hpBeforeDrag = state.hp;
  setHpFromBarX(e.clientX);
  e.preventDefault();
});
document.addEventListener('mousemove', e => { if (_draggingHpBar) setHpFromBarX(e.clientX); });
document.addEventListener('mouseup',   () => { if (_draggingHpBar) { _draggingHpBar = false; save('hp', state.hp); logHpDelta(_hpBeforeDrag, state.hp); } });

$('hp-bar-track').addEventListener('touchstart', e => {
  _draggingHpBar = true;
  _hpBeforeDrag = state.hp;
  setHpFromBarX(e.touches[0].clientX);
  e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => { if (_draggingHpBar) setHpFromBarX(e.touches[0].clientX); }, { passive: false });
document.addEventListener('touchend',  () => { if (_draggingHpBar) { _draggingHpBar = false; save('hp', state.hp); logHpDelta(_hpBeforeDrag, state.hp); } });

/* 临时HP滑块 */
let _tempSliderOpen = false;

$('temp-hp-badge').addEventListener('click', e => {
  e.stopPropagation();
  _tempSliderOpen = !_tempSliderOpen;
  $('temp-hp-slider-wrap').classList.toggle('hidden', !_tempSliderOpen);
  if (_tempSliderOpen) {
    $('temp-hp-slider').value = state.tempHp;
    $('temp-hp-slider-val').textContent = state.tempHp;
  }
});

$('temp-hp-slider-wrap').addEventListener('click', e => e.stopPropagation());

document.addEventListener('click', () => {
  if (_tempSliderOpen) {
    _tempSliderOpen = false;
    $('temp-hp-slider-wrap').classList.add('hidden');
  }
});

$('temp-hp-slider').addEventListener('input', e => {
  state.tempHp = parseInt(e.target.value, 10);
  $('temp-hp-slider-val').textContent = state.tempHp;
  save('tempHp', state.tempHp);
  renderHp();
});

