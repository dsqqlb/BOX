/* ============================================================
   渲染：角色卡静态信息（全部由 CHAR 配置驱动）
============================================================ */
function renderCharSheet() {
  /* 身份：名字 + 副标题 */
  $('char-name').textContent = CHAR.name;
  $('char-subtitle').textContent =
    `${CHAR.subclass} · ${CHAR.className} · ${CHAR.level}级 · ${CHAR.race}`;

  /* 六维属性：得分 + 自动计算的调整值 */
  $('header-stats').innerHTML = ABILITY_META.map(a => {
    const score = CHAR.abilities[a.key];
    return `
      <div class="cast-stat-box">
        <div class="cast-stat-lbl">${a.label}</div>
        <div class="cast-stat-num cinzel">${score}</div>
        <div class="ability-mod cinzel">${signed(abilityMod(score))}</div>
      </div>`;
  }).join('');

  /* 核心状态行：AC / 移动速度 / 先攻 / 熟练加值 */
  $('core-stats-row').innerHTML = `
    <div class="stat-box"><div class="stat-num cinzel">${CHAR.ac}</div><div class="stat-lbl">防御等级 AC</div></div>
    <div class="stat-box"><div class="stat-num cinzel">${CHAR.speed}</div><div class="stat-lbl">移动速度 ft</div></div>
    <div class="stat-box"><div class="stat-num cinzel">${signed(DERIVED.initiative)}</div><div class="stat-lbl">先攻</div></div>
    <div class="stat-box"><div class="stat-num cinzel">${signed(DERIVED.prof)}</div><div class="stat-lbl">熟练加值</div></div>`;

  /* 施法核心属性：法术豁免DC / 法术攻击加成 / 施法属性调整值 */
  $('cast-core-stats').innerHTML = `
    <div class="cast-stat-box"><div class="cast-stat-num cinzel">${DERIVED.spellSaveDC}</div><div class="cast-stat-lbl">法术豁免 DC</div></div>
    <div class="cast-stat-box"><div class="cast-stat-num cinzel">${signed(DERIVED.spellAttack)}</div><div class="cast-stat-lbl">法术攻击加成</div></div>
    <div class="cast-stat-box"><div class="cast-stat-num cinzel">${signed(DERIVED.spellMod)}</div><div class="cast-stat-lbl">${ABILITY_LABEL[CHAR.spellAbility]}调整值</div></div>`;

  /* 职业特性文字里的随等级变化数值 */
  const turnDc = $('cd-turn-dc');     if (turnDc)   turnDc.textContent   = DERIVED.spellSaveDC;
  const lifeHeal = $('cd-life-heal'); if (lifeHeal) lifeHeal.textContent = DERIVED.channelHeal;

  /* 角色信息：阵营 / 语言 */
  $('info-alignment').textContent = CHAR.alignment;
  $('info-languages').textContent = CHAR.languages;

  /* 临时HP滑条上限 */
  const slider = $('temp-hp-slider');
  if (slider) slider.max = CHAR.tempHpMax;

  renderSaves();
}

/* ============================================================
   渲染：属性豁免（熟练项 = 属性调整值 + 熟练加值）
============================================================ */
function renderSaves() {
  const container = $('saving-throws');
  if (!container) return;
  const profs = Array.isArray(CHAR.saveProfs) ? CHAR.saveProfs : [];
  container.innerHTML = ABILITY_META.map(a => {
    const prof = profs.includes(a.key);
    const mod = abilityMod(CHAR.abilities[a.key]) + (prof ? DERIVED.prof : 0);
    return `
      <div class="save-box${prof ? ' save-prof' : ''}" title="${a.label}豁免${prof ? '（熟练）' : ''}">
        <span class="save-dot"></span>
        <span class="save-lbl">${a.label}</span>
        <span class="save-mod cinzel">${signed(mod)}</span>
      </div>`;
  }).join('');
}

/* ============================================================
   渲染：血量
============================================================ */
function hpColor(pct) {
  /* hue: 0=红 120=绿 线性值 */
  const hue = Math.round(pct * 120);
  return `hsl(${hue}, 65%, 38%)`;
}

function renderHp() {
  $('hp-current').textContent = state.hp;
  $('hp-max').textContent = state.maxHp;
  const total = state.maxHp + state.tempHp;
  const hpPct   = (state.hp       / total) * 100;
  const tempPct = (state.tempHp   / total) * 100;
  const colorPct = Math.max(0, Math.min(1, state.hp / state.maxHp));
  $('hp-bar-fill').style.width = hpPct + '%';
  $('hp-bar-fill').style.background = hpColor(colorPct);
  $('hp-bar-temp').style.width = tempPct + '%';
  $('temp-hp-val').textContent = state.tempHp;
  $('temp-hp-badge').classList.toggle('has-temp', state.tempHp > 0);
  /* 濒死态：HP=0 时给 body 挂 .is-dying → CSS 强制显示并高亮死亡豁免 */
  document.body.classList.toggle('is-dying', state.hp === 0);
}

/* ============================================================
   渲染：法术位
============================================================ */
function renderSlots() { renderSpellPanel(); }

/* ============================================================
   渲染：法术面板（统一入口）
============================================================ */
function renderSpellPanel() {
  const container = $('spell-classes');
  if (!container) return;

  /* 清理已不在 DB 中的遗留 ID */
  const cleanedC = state.cantripIds.filter(id => getSpell(id));
  if (cleanedC.length !== state.cantripIds.length) { state.cantripIds = cleanedC; save('cantripIds', state.cantripIds); }
  const cleanedP = state.preparedIds.filter(id => getSpell(id));
  if (cleanedP.length !== state.preparedIds.length) { state.preparedIds = cleanedP; save('preparedIds', state.preparedIds); }

  container.innerHTML = '';

  /* 每个生效法表职业一个分区（按 ALL_SPELL_CLASSES 顺序稳定排列）*/
  const active = (typeof spellClasses !== 'undefined') ? spellClasses : [];
  const ordered = (typeof ALL_SPELL_CLASSES !== 'undefined')
    ? ALL_SPELL_CLASSES.filter(c => active.includes(c))
    : active.slice();
  ordered.forEach(cls => container.appendChild(buildSpellClassBlock(cls)));
}

/* 单个职业的法表分区：标题 + ＋选择 + 按环阶分组（戏法在前）*/
function buildSpellClassBlock(cls) {
  const inClass = sp => Array.isArray(sp.classes) && sp.classes.includes(cls);
  const block = document.createElement('div');
  block.className = 'spell-class-block';

  /* 收集该职业的戏法 / 各环法术 */
  const cantrips = state.cantripIds.map(getSpell).filter(sp => sp && sp.level === 0 && inClass(sp));
  const maxLv = CHAR.spellSlots.length - 1;
  /* 领域法术只归属角色本职业的分区，且【不按 classes 过滤】——领域可授予牧师法表之外
     的法术（如火球术），它们照样常驻显示/施放。见 js/classes/cleric.js。*/
  const isOwnClass = (cls === CHAR.className);
  const leveled = [];   // { lv, items:[{sp,isDomain}] }
  let chosenCount = 0;  // 玩家自选备法数 —— 只有它计入 maxPrepared
  let domainCount = 0;  // 领域法术数 —— 常驻备法，不计入上限（5e）
  for (let lv = 1; lv <= maxLv; lv++) {
    const domain = isOwnClass ? (CHAR.domainSpells[lv] || []).map(getSpell).filter(Boolean) : [];
    const chosen = state.preparedIds.map(getSpell).filter(sp => sp && sp.level === lv && inClass(sp));
    if (!domain.length && !chosen.length) continue;
    chosenCount += chosen.length;
    domainCount += domain.length;
    leveled.push({
      lv,
      items: [
        ...domain.map(sp => ({ sp, isDomain: true })),
        ...chosen.map(sp => ({ sp, isDomain: false })),
      ],
    });
  }

  /* 头部：职业名 · 法表 + 计数 + ＋选择 */
  const head = document.createElement('div');
  head.className = 'spell-class-head';
  /* 计数：戏法计入 maxCantrips，备法（自选）计入 maxPrepared；领域法术单独标、不计上限。
     max 只在角色本职业分区显示（maxCantrips/maxPrepared 是本职业的上限）。超限标红。*/
  let countHtml;
  if (isOwnClass) {
    const cOver = cantrips.length > CHAR.maxCantrips;
    const pOver = chosenCount   > CHAR.maxPrepared;
    countHtml =
      `<span class="cnt-part${cOver ? ' over' : ''}">戏法 ${cantrips.length}/${CHAR.maxCantrips}</span>` +
      `<span class="cnt-sep"> ｜ </span>` +
      `<span class="cnt-part${pOver ? ' over' : ''}">备法 ${chosenCount}/${CHAR.maxPrepared}</span>` +
      (domainCount ? `<span class="cnt-domain"> ｜ 领域 ${domainCount}</span>` : '');
  } else {
    countHtml = `<span class="cnt-part">戏法 ${cantrips.length}</span><span class="cnt-sep"> ｜ </span><span class="cnt-part">备法 ${chosenCount}</span>`;
  }
  head.innerHTML =
    `<span class="cinzel spell-class-name">${cls} · 法表</span>` +
    `<span class="spell-class-count">${countHtml}</span>`;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-spell-add';
  addBtn.textContent = '＋ 选择';
  addBtn.addEventListener('click', () => openPicker(cls));
  head.appendChild(addBtn);
  block.appendChild(head);

  /* 戏法组（level 0，无法术位）*/
  if (cantrips.length) {
    block.appendChild(buildSpellLvGroup('戏法', 0, cantrips.map(sp => ({ sp, isDomain: false, isCantrip: true }))));
  }
  /* 各环组（带法术位宝石）*/
  leveled.forEach(g => {
    block.appendChild(buildSpellLvGroup(g.lv + '环', g.lv, g.items.map(x => ({ sp: x.sp, isDomain: x.isDomain, isCantrip: false }))));
  });

  if (!cantrips.length && !leveled.length) {
    const empty = document.createElement('div');
    empty.className = 'spell-class-empty';
    empty.textContent = '尚无该职业的已学法术，点「＋ 选择」添加。';
    block.appendChild(empty);
  }
  return block;
}

/* 环阶分组：标题（≥1环带法术位宝石）+ 双栏法术行 */
function buildSpellLvGroup(label, lv, items) {
  const group = document.createElement('div');
  group.className = 'spell-lv-group';

  const hdr = document.createElement('div');
  hdr.className = 'srow-lv-group-hdr';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  hdr.appendChild(lbl);

  if (lv >= 1) {
    const slotCount = CHAR.spellSlots[lv] || 0;
    if (slotCount > 0) {
      const gems = document.createElement('div');
      gems.className = 'slot-gems';
      for (let i = 0; i < slotCount; i++) {
        const gem = document.createElement('div');
        gem.className = 'slot-gem' + (state.slots[lv][i] ? ' used' : '');
        gem.title = lv + '环法术位 ' + (i + 1);
        gem.addEventListener('click', () => {
          state.slots[lv][i] = !state.slots[lv][i];
          save('slots', state.slots);
          renderSpellPanel();
        });
        gems.appendChild(gem);
      }
      hdr.appendChild(gems);
    }
  }
  group.appendChild(hdr);

  const colL = document.createElement('div'); colL.className = 'srow-col';
  const colR = document.createElement('div'); colR.className = 'srow-col';
  const wrap = document.createElement('div'); wrap.className = 'srow-2col';
  wrap.appendChild(colL); wrap.appendChild(colR);
  group.appendChild(wrap);
  items.forEach(({ sp, isDomain, isCantrip }, i) => {
    (i % 2 === 0 ? colL : colR).appendChild(buildSpellRow(sp, isDomain, isCantrip));
  });
  return group;
}

/* ============================================================
   渲染：临时法术（独立次数、不消耗法术位、按休整恢复）
============================================================ */
function renderTempSpells() {
  const list = $('temp-spells-list');
  if (!list) return;
  /* 清理法术库里已不存在的条目 */
  const cleaned = (state.tempSpells || []).filter(t => getSpell(t.id));
  if (cleaned.length !== (state.tempSpells || []).length) {
    state.tempSpells = cleaned;
    save('tempSpells', state.tempSpells);
  }

  list.innerHTML = '';
  if (!state.tempSpells.length) {
    const empty = document.createElement('div');
    empty.className = 'temp-empty';
    empty.textContent = '暂无临时法术。点「＋ 添加临时法术」，选个法术并设置次数与恢复方式。';
    list.appendChild(empty);
    return;
  }

  /* 与普通已备法术相同的双栏行布局；每行用 buildSpellRow（带 tempKey）*/
  const colL = document.createElement('div'); colL.className = 'srow-col';
  const colR = document.createElement('div'); colR.className = 'srow-col';
  const wrap = document.createElement('div'); wrap.className = 'srow-2col';
  wrap.appendChild(colL); wrap.appendChild(colR);
  list.appendChild(wrap);

  let n = 0;
  state.tempSpells.forEach(t => {
    const sp = getSpell(t.id);
    if (!sp) return;
    const row = buildSpellRow(sp, false, sp.level === 0, t.key);
    (n % 2 === 0 ? colL : colR).appendChild(row);
    n++;
  });
}

function addTempSpell(id, uses, recharge) {
  state.tempSpells = state.tempSpells || [];
  state.tempSpells.push({
    key: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
    id,
    uses: Math.max(1, uses),
    used: 0,
    recharge: (recharge === 'short') ? 'short' : 'long',
  });
  save('tempSpells', state.tempSpells);
  renderTempSpells();
  if (typeof logEvent === 'function') {
    const sp = getSpell(id);
    logEvent('cast', '✦', `添加临时法术 ${sp ? sp.name : id}（${uses} 次 / ${recharge === 'short' ? '短休' : '长休'}恢复）`);
  }
}

function removeTempSpell(key) {
  state.tempSpells = (state.tempSpells || []).filter(t => t.key !== key);
  save('tempSpells', state.tempSpells);
  renderTempSpells();
}

function setTempUsed(key, newUsed) {
  const t = (state.tempSpells || []).find(x => x.key === key);
  if (!t) return;
  const before = t.used;
  t.used = Math.max(0, Math.min(t.uses, newUsed));
  if (t.used === before) return;
  save('tempSpells', state.tempSpells);
  renderTempSpells();
  if (typeof logEvent === 'function') {
    const sp = getSpell(t.id);
    const nm = sp ? sp.name : t.id;
    logEvent('cast', '✦', (t.used > before ? '施放临时法术 ' : '恢复临时法术 ') + nm + `（剩 ${t.uses - t.used}/${t.uses}）`);
  }
}

/* ──── 查找可用法术位：从指定环阶起向上找第一个未使用的（支持自动升环）──── */
function findCastableSlot(minLevel) {
  const maxLv = CHAR.spellSlots.length - 1;
  for (let lv = minLevel; lv <= maxLv; lv++) {
    const count = CHAR.spellSlots[lv] || 0;
    for (let i = 0; i < count; i++) {
      if (!(state.slots[lv] && state.slots[lv][i])) return { lv, i };
    }
  }
  return null;   /* 该环阶及以上都没有空余法术位 */
}

/* ──── 指定环阶的空闲法术位数量 ──── */
function slotsFreeAt(lv) {
  const count = CHAR.spellSlots[lv] || 0;
  let free = 0;
  for (let i = 0; i < count; i++) {
    if (!(state.slots[lv] && state.slots[lv][i])) free++;
  }
  return free;
}

/* ──── 从 minLevel 起、所有拥有空闲法术位的环阶（升序）──── */
function availableSlotLevels(minLevel) {
  const maxLv = CHAR.spellSlots.length - 1;
  const levels = [];
  for (let lv = minLevel; lv <= maxLv; lv++) {
    if (slotsFreeAt(lv) > 0) levels.push(lv);
  }
  return levels;
}

/* ──── 该法术是否带有"升环施法效应" ──── */
function hasUpcast(sp) {
  return sp.level > 0 && /升环施法效应/.test(sp.description || '');
}

/* ──── 该法术是否可仪式施法 ──── */
function hasRitual(sp) {
  return sp.level > 0 && Array.isArray(sp.classes) && sp.classes.includes('仪式');
}

/* 设置专注（自动替换旧专注，符合 5e，静默）*/
function setConcentration(sp) {
  state.concentration = sp.id;
  save('concentration', state.concentration);
  if (typeof renderConcentration === 'function') renderConcentration();
}

/* ──── 仪式施法：不消耗法术位，照常处理专注 + 日志 + 特效 ──── */
function castRitual(sp) {
  if (sp.conc) setConcentration(sp);
  if (typeof logEvent === 'function') {
    logEvent('cast', '📖', `仪式施放 ${sp.name}（${sp.level} 环，不耗法术位）${sp.conc ? ' · 专注' : ''}`);
  }
  if (typeof playCastFx === 'function') playCastFx(sp, false);
  if (typeof playSpellAudio === 'function') playSpellAudio(sp);
  renderSpellPanel();
}

/* ──── 长按触发入口：有升环/仪式选项时弹窗询问，否则直接施放 ──── */
function promptCast(sp) {
  const levels = availableSlotLevels(sp.level);
  const isRitual = hasRitual(sp);

  /* 无可用法术位，也不能仪式施法 → 无法施放 */
  if (!levels.length && !isRitual) return;

  /* 没有升环效应、也没有仪式、且仅有一档环阶 → 直接施放 */
  if (!hasUpcast(sp) && !isRitual && levels.length === 1) {
    castSpell(sp, levels[0]);
    return;
  }

  /* 有升环多档可选，或可仪式施法 → 弹窗让用户选 */
  showUpcastDialog(sp, levels, isRitual);
}

/* ──── 施放法术：扣除指定环阶（或自动最低可用）法术位 + 记录专注 ──── */
function castSpell(sp, castLevel) {
  /* 未指定环阶时从法术本环起自动查找（兼容旧调用）*/
  const startLevel = (castLevel != null) ? castLevel : sp.level;
  const slot = findCastableSlot(startLevel);
  if (!slot) return;   /* 无可用法术位 */

  /* 扣除法术位 */
  state.slots[slot.lv][slot.i] = true;
  save('slots', state.slots);

  /* 需要专注的法术：记录专注（自动替换旧专注，符合 5e 规则；切换时提醒）*/
  if (sp.conc) setConcentration(sp);

  /* 写入冒险日志（升环时标注实际环阶）*/
  if (typeof logEvent === 'function') {
    const up = slot.lv > sp.level ? `（升至 ${slot.lv} 环）` : (sp.level > 0 ? `（${slot.lv} 环）` : '');
    logEvent('cast', '🪄', `施放 ${sp.name}${up}${sp.conc ? ' · 专注' : ''}`);
  }

  if (typeof playCastFx === 'function') playCastFx(sp, false);   /* 全屏施法特效（按学派，可关闭）*/
  if (typeof playSpellAudio === 'function') playSpellAudio(sp);   /* 法术音效（按 spellId 找 audios/<id>.mp3）*/
  renderSpellPanel();   /* 刷新法术位宝石与整行状态 */
}

/* ──── 施放戏法：不消耗法术位，直接记录（专注类戏法同样处理专注）──── */
function castCantrip(sp) {
  if (sp.conc) { setConcentration(sp); renderSpellPanel(); }   /* 刷新专注按钮高亮状态 */
  if (typeof logEvent === 'function') {
    logEvent('cast', '🪄', `施放 ${sp.name}（戏法）${sp.conc ? ' · 专注' : ''}`);
  }
  if (typeof playCastFx === 'function') playCastFx(sp, true);    /* 戏法用缩小版特效 */
  if (typeof playSpellAudio === 'function') playSpellAudio(sp);   /* 法术音效（按 spellId 找 audios/<id>.mp3）*/
}

/* ──── 临时法术是否还有剩余次数 ──── */
function tempHasUses(key) {
  const t = (state.tempSpells || []).find(x => x.key === key);
  return !!t && t.used < t.uses;
}

/* ──── 施放临时法术：消耗自身 1 次（不动法术位），处理专注/日志/特效 ──── */
function castTempSpell(key) {
  const t = (state.tempSpells || []).find(x => x.key === key);
  if (!t || t.used >= t.uses) return;
  t.used++;
  save('tempSpells', state.tempSpells);
  const sp = getSpell(t.id);
  if (sp && sp.conc) setConcentration(sp);
  if (typeof logEvent === 'function') {
    logEvent('cast', '✦', `施放 ${sp ? sp.name : t.id}（临时 · 剩 ${t.uses - t.used}/${t.uses}）${sp && sp.conc ? ' · 专注' : ''}`);
  }
  if (typeof playCastFx === 'function' && sp) playCastFx(sp, sp.level === 0);
  if (typeof playSpellAudio === 'function' && sp) playSpellAudio(sp);   /* 法术音效（按 spellId 找 audios/<id>.mp3）*/
  renderTempSpells();
  renderSpellPanel();   /* 刷新其它位置的专注高亮 */
}

/* ──── 整行长按施法交互：按住约 0.70s 施法；轻触则展开详情
        戏法（sp.level === 0）不耗法术位，永远可按住施放 ──── */
function attachRowCast(row, sp, tempKey) {
  const HOLD_MS = 700;   /* 需与 CSS .srow-casting 的填充过渡时长一致 */
  let holdTimer = null;
  let pressed = false;
  let didCast = false;

  const onDown = e => {
    if (e.target.closest('button')) return;   /* 专注/移除按钮自行处理，不触发施法 */
    e.preventDefault();                        /* 阻止浏览器长按默认行为（文字选择/系统菜单）*/
    pressed = true;
    didCast = false;
    /* 临时法术：还有剩余次数即可施放；否则同普通规则（戏法恒可，1环+需可用法术位或仪式）*/
    const castable = tempKey
      ? tempHasUses(tempKey)
      : ((sp.level === 0) || (findCastableSlot(sp.level) != null) || hasRitual(sp));
    if (castable) {
      row.classList.add('srow-casting');
      holdTimer = setTimeout(() => {
        holdTimer = null;
        didCast = true;
        pressed = false;
        row.classList.remove('srow-casting');
        if (tempKey) castTempSpell(tempKey);     /* 临时法术：消耗 1 次 */
        else if (sp.level === 0) castCantrip(sp);
        else promptCast(sp);      /* 带升环效应先询问环阶，否则直接施放 */
      }, HOLD_MS);
    }
  };

  const onUp = () => {
    if (!pressed) return;
    pressed = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    row.classList.remove('srow-casting');
    didCast = false;
    /* 轻触不再展开详情——详情改由独立的 ▾ 按钮触发，避免和按住施法用同一热区抢触发时机 */
  };

  const onCancel = () => {
    pressed = false;
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    row.classList.remove('srow-casting');
  };

  row.addEventListener('pointerdown', onDown);
  row.addEventListener('pointerup', onUp);
  row.addEventListener('pointercancel', onCancel);   /* 滚动等系统手势打断 → 取消 */
  row.addEventListener('pointerleave', onCancel);
  row.addEventListener('contextmenu', e => e.preventDefault());
}

/* ──── 构建单行法术卡片 ──── */
function buildSpellRow(sp, isDomain, isCantrip, tempKey) {
  const row = document.createElement('div');
  row.className = 'srow' + (isDomain ? ' srow-domain' : '') + (tempKey ? ' srow-temp' : '');

  /* 长按施法的金色填充层（戏法与 1 环以上法术都可按住施放）*/
  const fill = document.createElement('span');
  fill.className = 'srow-cast-fill';
  row.appendChild(fill);

  /* 环阶徽章 */
  if (!isCantrip) {
    const badge = document.createElement('span');
    badge.className = 'srow-lv-badge';
    badge.textContent = sp.level + '环';
    row.appendChild(badge);
  }

  /* 领域旗标：纯提示（常驻备法、无法移除），放在环阶徽章与名称之间，不是可点按钮 */
  if (isDomain) {
    const lock = document.createElement('span');
    lock.className = 'srow-domain-lock';
    lock.textContent = '⚑';
    lock.title = '领域法术，常驻备法';
    row.appendChild(lock);
  }

  /* 名称区域 */
  const nameWrap = document.createElement('div');
  nameWrap.className = 'srow-name';
  nameWrap.innerHTML = `<span class="srow-cn cinzel">${sp.name}</span><span class="srow-en">${sp.nameEn}</span>`;
  nameWrap.title = '按住施法';
  row.appendChild(nameWrap);
  
  /* 施法时间图标 + 专注标识，放在名称右侧 */
  const indicators = document.createElement('span');
  indicators.className = 'srow-indicators';
  
  const ct = sp.castTime || '';
  if (ct.includes('附赠动作')) {
    const ti = document.createElement('span');
    ti.className = 'cast-icon cast-icon-bonus';
    ti.title = '附赠动作';
    indicators.appendChild(ti);
  } else if (ct.includes('动作')) {
    const ti = document.createElement('span');
    ti.className = 'cast-icon cast-icon-action';
    ti.title = '动作';
    indicators.appendChild(ti);
  } else if (ct) {
    /* 非动作/附赠的施法时间直接显示文字（如 1分钟、10分钟）*/
    const ti = document.createElement('span');
    ti.className = 'srow-time-text';
    ti.textContent = ct;
    ti.title = ct;
    indicators.appendChild(ti);
  }
  
  if (sp.conc) {
    const ci = document.createElement('span');
    ci.className = 'srow-conc-badge';
    ci.textContent = '专';
    ci.title = '专注';
    indicators.appendChild(ci);
  }
  
  /* 临时法术：恢复方式标记 + 剩余次数（点击恢复1次）+ 移除，并入名字右侧的指示区。
     长按整行 = 施放并消耗1次（见 attachRowCast），这几个按钮点击不触发施法。*/
  if (tempKey) {
    const t = (state.tempSpells || []).find(x => x.key === tempKey);
    const remaining = t ? (t.uses - t.used) : 0;

    const rcTag = document.createElement('span');
    rcTag.className = 'srow-temp-recharge';
    rcTag.textContent = (t && t.recharge === 'short') ? '短' : '长';
    rcTag.title = (t && t.recharge === 'short') ? '短休恢复' : '长休恢复';
    indicators.appendChild(rcTag);

    const usesBtn = document.createElement('button');
    usesBtn.className = 'srow-temp-uses' + (remaining <= 0 ? ' depleted' : '');
    usesBtn.textContent = remaining + '/' + (t ? t.uses : 0);
    usesBtn.title = '临时法术剩余次数 · 点击恢复 1 次';
    usesBtn.addEventListener('click', e => { e.stopPropagation(); if (t) setTempUsed(tempKey, t.used - 1); });
    indicators.appendChild(usesBtn);

    const rmBtn = document.createElement('button');
    rmBtn.className = 'srow-temp-remove';
    rmBtn.textContent = '✕';
    rmBtn.title = '移除此临时法术';
    rmBtn.addEventListener('click', e => { e.stopPropagation(); removeTempSpell(tempKey); });
    indicators.appendChild(rmBtn);
  }

  if (indicators.children.length) row.appendChild(indicators);
  
  /* 详情展开按钮：贴满行高的竖条，固定在最右侧 */
  const detailBtn = document.createElement('button');
  detailBtn.className = 'srow-detail-btn';
  detailBtn.title = '查看详情';
  const detailArrow = document.createElement('span');
  detailArrow.className = 'srow-detail-arrow';
  detailArrow.textContent = '▾';
  detailBtn.appendChild(detailArrow);
  detailBtn.addEventListener('click', e => {
    e.stopPropagation();
    showInlineDetail(sp, row);
    detailBtn.classList.toggle('open');
  });
  row.appendChild(detailBtn);

  /* 挂载整行长按施法交互（临时法术消耗自身次数，其余同普通法术）*/
  row.style.cursor = 'pointer';
  attachRowCast(row, sp, tempKey);

  return row;
}

/* ──── 行内详情展开 ──── */
function showInlineDetail(sp, row) {
  /* 若已展开同一行则收起 */
  const existing = row.nextElementSibling;
  if (existing && existing.classList.contains('srow-inline-detail')) {
    const parent = row.parentNode;
    if (parent.classList.contains('srow-glow-wrap')) {
      parent.parentNode.insertBefore(row, parent);
      parent.remove();
    } else {
      existing.remove();
      row.classList.remove('srow-active');
    }
    return;
  }
  /* 创建流光包装容器 */
  const wrap = document.createElement('div');
  wrap.className = 'srow-glow-wrap';
  row.parentNode.insertBefore(wrap, row);
  wrap.appendChild(row);
  const detail = document.createElement('div');
  detail.className = 'srow-inline-detail';
  detail.innerHTML = buildDetailHTML(sp);
  wrap.appendChild(detail);
}

function formatCastTime(t) {
  if (t.includes('附赠动作')) return `<span class="cast-icon cast-icon-bonus"></span>${t}`;
  if (t.includes('动作'))   return `<span class="cast-icon cast-icon-action"></span>${t}`;
  return t;
}

function buildDetailHTML(sp) {
  return `
    <div class="detail-meta-grid">
      <div class="detail-meta-box">
        <div class="detail-meta-lbl">施法时间</div>
        <div class="detail-meta-val">${formatCastTime(sp.castTime)}</div>
      </div>
      <div class="detail-meta-box">
        <div class="detail-meta-lbl">施法距离</div>
        <div class="detail-meta-val">${sp.range}</div>
      </div>
      <div class="detail-meta-box">
        <div class="detail-meta-lbl">法术成分</div>
        <div class="detail-meta-val">${sp.components}</div>
      </div>
      <div class="detail-meta-box">
        <div class="detail-meta-lbl">持续时间</div>
        <div class="detail-meta-val">${sp.duration}</div>
      </div>
    </div>
    <div class="detail-minor">${sp.level === 0 ? '戏法' : sp.level + '环'} · ${sp.school}&emsp;${sp.classes.join('、')}</div>
    <div class="detail-desc">${sp.description.replace(/\n/g, '<br>')}</div>
  `;
}

/* ──── 兼容别名：旧代码里调用的 renderCantripList / renderPreparedList
   统一走 renderSpellPanel（按职业分区渲染，戏法+环阶合并）──── */
function renderCantripList() { renderSpellPanel(); }

function renderPreparedList() { renderSpellPanel(); }

/* ──── 领域法术列表（已合并到 renderPreparedList） ──── */
function renderDomainList() {}  /* 保留空实现以兼容其他可能调用 */

/* ============================================================
   渲染：专注横条
============================================================ */
function renderConcentration() {
  const banner = $('concentration-banner');
  if (state.concentration) {
    const sp = getSpell(state.concentration);
    $('conc-spell-name').textContent = sp ? sp.name : state.concentration;
    banner.classList.add('active');
  } else {
    banner.classList.remove('active');
  }
}

function toggleConc(spellId) {
  const started = state.concentration !== spellId;
  state.concentration = started ? spellId : null;
  save('concentration', state.concentration);
  renderConcentration();
  renderSpellPanel();  /* 刷新专注按钮高亮状态 */
  if (typeof logEvent === 'function') {
    const nm = (getSpell(spellId) || {}).name || spellId;
    logEvent('cast', '🎯', started ? `开始专注 ${nm}` : `结束专注 ${nm}`);
  }
}

/* ============================================================
   渲染：死亡豁免
============================================================ */
function renderExhaustion() {
  document.querySelectorAll('.exhaust-pip').forEach((pip, i) => {
    pip.classList.toggle('active', state.exhaustion[i]);
  });
}

function renderDeathSaves() {
  ['success', 'fail'].forEach(type => {
    document.querySelectorAll(`#death-${type} .save-circle`).forEach((c, i) => {
      c.classList.toggle(type, state.deathSave[type][i]);
    });
  });
}

/* ============================================================
   渲染：引导神力
============================================================ */
function renderChannel() {
  const container = $('channel-pips');
  if (!container) return;   /* 非牧师职业：面板未生成，直接跳过 */
  container.innerHTML = '';
  for (let i = 0; i < CHAR.channelDivinity; i++) {
    const pip = document.createElement('div');
    pip.className = 'resource-pip' + (state.channel[i] ? ' spent' : '');
    pip.addEventListener('click', () => {
      state.channel[i] = !state.channel[i];
      save('channel', state.channel);
      renderChannel();
      if (typeof logEvent === 'function') {
        const left = CHAR.channelDivinity - state.channel.filter(Boolean).length;
        logEvent('combat', '⚡', (state.channel[i] ? '消耗引导神力' : '恢复引导神力') + `（剩 ${left}/${CHAR.channelDivinity}）`);
      }
    });
    container.appendChild(pip);
  }
}

/* ============================================================
   渲染：生命骰（点击切换 已用/可用，只记个数不模拟投骰；长休自动恢复）
============================================================ */
function renderHitDice() {
  const container = $('hitdice-pips');
  if (!container) return;
  const max = CHAR.hitDiceMax || 0;
  if (!Array.isArray(state.hitDice)) state.hitDice = new Array(max).fill(false);
  container.innerHTML = '';

  for (let i = 0; i < max; i++) {
    const pip = document.createElement('div');
    pip.className = 'hitdice-pip' + (state.hitDice[i] ? ' spent' : '');
    pip.title = '生命骰 ' + (i + 1) + (state.hitDice[i] ? '（已用）' : '（可用）');
    pip.addEventListener('click', () => {
      state.hitDice[i] = !state.hitDice[i];
      save('hitDice', state.hitDice);
      renderHitDice();
      if (typeof logEvent === 'function') {
        const left = max - state.hitDice.filter(Boolean).length;
        logEvent('rest', '🎲', (state.hitDice[i] ? '消耗生命骰' : '恢复生命骰') + `（剩 ${left}/${max}）`);
      }
    });
    container.appendChild(pip);
  }

  const cnt = $('hitdice-count');
  if (cnt) {
    const left = max - state.hitDice.filter(Boolean).length;
    cnt.textContent = max ? `剩 ${left} / ${max}` : '—';
  }
}

/* ============================================================
   渲染：增益状态
============================================================ */
function renderBuffs() {
  const container = $('buff-chips');
  container.innerHTML = '';
  /* 只显示已选（buffPicks）的状态标签 */
  state.buffPicks.forEach(id => {
    const b = BUFF_DB.find(x => x.id === id);
    if (!b) return;   /* 跳过库中已不存在的遗留 id */
    const lit = !!state.buffs[id];
    const chip = document.createElement('div');
    chip.className = 'buff-chip' + (lit ? ' lit' : '');
    chip.title = b.effect;   /* 悬停显示效果说明 */

    /* 名称：点击切换点亮/熄灭 */
    const label = document.createElement('span');
    label.className = 'buff-chip-label';
    label.textContent = b.name;
    label.addEventListener('click', () => {
      state.buffs[id] = !state.buffs[id];
      if (!state.buffs[id]) delete state.buffDurations[id];   /* 熄灭时清除计时 */
      save('buffs', state.buffs);
      save('buffDurations', state.buffDurations);
      renderBuffs();
      if (typeof logEvent === 'function') {
        logEvent('buff', '🏷️', (state.buffs[id] ? '获得状态 ' : '解除状态 ') + b.name);
      }
    });
    chip.appendChild(label);

    /* 已点亮的状态：显示可编辑的“剩余轮数”徽标（战斗中每回合 −1）*/
    if (lit) {
      const rounds = state.buffDurations[id];
      const timer = document.createElement('span');
      timer.className = 'buff-chip-timer' + (rounds > 0 ? ' active' : '');
      timer.textContent = rounds > 0 ? `⏱${rounds}` : '⏱';
      timer.title = '设置持续轮数：战斗中每推进一回合 −1，到 0 自动结束（留空=不计时）';
      timer.addEventListener('click', e => {
        e.stopPropagation();
        editBuffRounds(id, timer);
      });
      chip.appendChild(timer);
    }

    container.appendChild(chip);
  });
  /* 末尾“＋ 选择”芯片：打开状态选择器 */
  const add = document.createElement('button');
  add.className = 'buff-chip buff-chip-add';
  add.textContent = '＋ 选择';
  add.title = '选择要显示的状态标签';
  add.addEventListener('click', openBuffPicker);
  container.appendChild(add);
}

/* ──── 编辑某个状态的剩余轮数（内联输入，回车/失焦提交）──── */
function editBuffRounds(id, timerEl) {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.max = 999;
  input.className = 'buff-chip-timer-input';
  input.value = state.buffDurations[id] || '';
  timerEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const v = parseInt(input.value, 10);
    if (isNaN(v) || v <= 0) delete state.buffDurations[id];   /* 留空/0 = 不计时 */
    else state.buffDurations[id] = v;
    save('buffDurations', state.buffDurations);
    renderBuffs();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commit();
    if (e.key === 'Escape') renderBuffs();
  });
}

/* ──── 回合推进：所有带计时的状态 −1 轮，到 0 自动结束 ──── */
function tickBuffDurations() {
  const dur = state.buffDurations || {};
  const expired = [];
  let changed = false;
  Object.keys(dur).forEach(id => {
    if (!state.buffs[id]) { delete dur[id]; changed = true; return; }   /* 已熄灭的清理掉 */
    if (dur[id] > 0) {
      dur[id]--;
      changed = true;
      if (dur[id] <= 0) {
        delete dur[id];
        state.buffs[id] = false;   /* 到时自动熄灭 */
        expired.push(id);
      }
    }
  });
  if (changed) {
    save('buffDurations', state.buffDurations);
    save('buffs', state.buffs);
    renderBuffs();
  }
  expired.forEach(id => {
    const b = BUFF_DB.find(x => x.id === id);
    if (b && typeof logEvent === 'function') logEvent('buff', '⌛', `${b.name} 到时结束`);
  });
}

/* ============================================================
   渲染：经验值进度条
============================================================ */
function renderXp() {
  const cur = state.xp || 0;
  const next = DERIVED.xpToNext;
  const pct = next > 0 ? Math.min(100, Math.round((cur / next) * 100)) : 0;

  $('xp-current').textContent = cur.toLocaleString();
  $('xp-next').textContent   = next === Infinity ? '—' : next.toLocaleString();
  $('xp-bar-fill').style.width = pct + '%';
  $('xp-bar-pct').textContent  = pct + '%';
}

/* ──── 编辑当前经验值 ──── */
function editXpCurrent() {
  const span = $('xp-current');
  const inp  = $('xp-input');
  span.style.display = 'none';
  inp.style.display  = '';
  inp.value = state.xp;
  inp.focus();
  inp.select();
}

function commitXpCurrent() {
  const span = $('xp-current');
  const inp  = $('xp-input');
  const before = state.xp;
  const val = parseInt(inp.value, 10);
  const after = isNaN(val) || val < 0 ? before : Math.floor(val);
  inp.style.display = 'none';
  span.style.display = '';
  if (after === before) return;
  state.xp = after;
  save('xp', state.xp);
  renderXp();
  const d = after - before;
  if (typeof logEvent === 'function') {
    logEvent('xp', '⭐', d > 0
      ? `获得 ${d} 经验值 · ${after.toLocaleString()} / ${DERIVED.xpToNext.toLocaleString()}`
      : `失去 ${-d} 经验值 · ${after.toLocaleString()} / ${DERIVED.xpToNext.toLocaleString()}`);
  }
}

/* ──── 编辑升级所需经验值 ──── */
function editXpNext() {
  const span = $('xp-next');
  const inp  = $('xp-next-input');
  span.style.display = 'none';
  inp.style.display  = '';
  inp.value = state.xpToNextManual != null ? state.xpToNextManual : DERIVED.xpToNext;
  inp.focus();
  inp.select();
}

function commitXpNext() {
  const span = $('xp-next');
  const inp  = $('xp-next-input');
  const val = parseInt(inp.value, 10);
  inp.style.display = 'none';
  span.style.display = '';
  /* 清空或无效 → 恢复为自动值 */
  const after = (isNaN(val) || val <= 0) ? null : Math.floor(val);
  state.xpToNextManual = after;
  save('xpToNextManual', state.xpToNextManual);
  renderXp();
  if (typeof logEvent === 'function') {
    const display = after != null ? after.toLocaleString() : xpForLevel(CHAR.level + 1).toLocaleString();
    logEvent('xp', '✎', `升级所需经验值设为 ${display}`);
  }
}

/* ──── 绑定 XP 交互 ──── */
$('xp-current').addEventListener('click', editXpCurrent);
$('xp-input').addEventListener('blur', commitXpCurrent);
$('xp-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitXpCurrent(); });
$('xp-next').addEventListener('click', editXpNext);
$('xp-next-input').addEventListener('blur', commitXpNext);
$('xp-next-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitXpNext(); });

/* ──── 获得经验值弹窗 ──── */
(function () {
  const modal   = $('xp-gain-modal');
  const inp     = $('xp-gain-input');
  const preview = $('xp-gain-preview');

  function updatePreview() {
    const gained = parseFloat(inp.value);
    if (isNaN(gained) || gained < 0) {
      preview.textContent = '';
      preview.className = 'xp-gain-preview';
      return;
    }
    const cur   = state.xp || 0;
    const after = cur + gained;
    const max   = DERIVED.xpToNext;
    if (max !== Infinity && after > max) {
      preview.textContent =
        `${cur.toLocaleString()} ＋ ${gained.toLocaleString()} ＝ ${after.toLocaleString()}（超过升级门槛 ${max.toLocaleString()}）`;
      preview.className = 'xp-gain-preview xp-warn';
    } else {
      preview.textContent =
        `${cur.toLocaleString()} ＋ ${gained.toLocaleString()} ＝ ${after.toLocaleString()}`;
      preview.className = 'xp-gain-preview';
    }
  }

  function openXpGainModal() {
    inp.value = '';
    preview.textContent = '';
    preview.className = '';
    modal.classList.remove('hidden');
    setTimeout(() => inp.focus(), 50);
  }

  function closeXpGainModal() {
    modal.classList.add('hidden');
  }

  function confirmXpGain() {
    const gained = parseFloat(inp.value);
    if (isNaN(gained) || gained < 0) { closeXpGainModal(); return; }
    const cur   = state.xp || 0;
    const after = cur + gained;
    const max   = DERIVED.xpToNext;
    const overLimit = max !== Infinity && after > max;
    state.xp = after;
    save('xp', state.xp);
    renderXp();
    if (typeof logEvent === 'function') {
      const note = overLimit ? `（已超过升级门槛 ${max.toLocaleString()}）` : '';
      logEvent('xp', '⭐', `获得 ${gained.toLocaleString()} 经验值 · ${after.toLocaleString()} / ${max === Infinity ? '—' : max.toLocaleString()}${note}`);
    }
    closeXpGainModal();
    if (overLimit) {
      /* 稍作延迟，让弹窗先关闭再提示 */
      setTimeout(() => {
        alert(`已超过升级所需经验值（${max.toLocaleString()}）！\n当前经验值：${after.toLocaleString()}`);
      }, 100);
    }
  }

  $('btn-xp-gain').addEventListener('click', openXpGainModal);
  $('xp-gain-close').addEventListener('click', closeXpGainModal);
  $('xp-gain-cancel').addEventListener('click', closeXpGainModal);
  $('xp-gain-confirm').addEventListener('click', confirmXpGain);
  modal.addEventListener('click', e => { if (e.target === modal) closeXpGainModal(); });
  inp.addEventListener('input', updatePreview);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') confirmXpGain(); });
}());

/* ============================================================
   渲染：熟练技能面板
============================================================ */
function renderSkills() {
  const container = $('skills-list');
  if (!container) return;
  const groups = skillsByAbility();
  container.innerHTML = '';

  groups.forEach(g => {
    const mod = abilityMod(CHAR.abilities[g.abilityKey]);

    const groupEl = document.createElement('div');
    groupEl.className = 'skills-ability-group';

    const hdr = document.createElement('div');
    hdr.className = 'skills-ability-hdr';
    hdr.innerHTML = `
      <span class="skills-ability-lbl">${g.abilityLabel}</span>
      <span class="skills-ability-mod">[${signed(mod)}]</span>`;
    groupEl.appendChild(hdr);

    const row = document.createElement('div');
    row.className = 'skills-row';

    g.skills.forEach(sk => {
      const prof = state.skillProfs.includes(sk.id);
      const total = mod + (prof ? DERIVED.prof : 0);

      const item = document.createElement('span');
      item.className = 'skill-item';
      item.dataset.id = sk.id;
      item.title = prof ? '点击取消熟练' : '点击获得熟练';

      const dot = document.createElement('span');
      dot.className = 'skill-dot' + (prof ? ' prof' : '');
      item.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'skill-name';
      name.textContent = sk.name;
      item.appendChild(name);

      const bonus = document.createElement('span');
      bonus.className = 'skill-bonus';
      bonus.textContent = signed(total);
      item.appendChild(bonus);

      item.addEventListener('click', () => toggleSkill(sk.id));

      row.appendChild(item);
    });

    groupEl.appendChild(row);
    container.appendChild(groupEl);
  });
}

function toggleSkill(id) {
  const idx = state.skillProfs.indexOf(id);
  const sk = getSkill(id);
  if (!sk) return;
  if (idx >= 0) {
    state.skillProfs.splice(idx, 1);
  } else {
    state.skillProfs.push(id);
  }
  save('skillProfs', state.skillProfs);
  renderSkills();
  if (typeof logEvent === 'function') {
    logEvent('skill', '🎓', idx >= 0
      ? `取消「${sk.name}」熟练（${sk.abilityLabel}）`
      : `获得「${sk.name}」熟练（${sk.abilityLabel}）`);
  }
}

/* ============================================================
   渲染：种族特性面板（依据 CHAR.race + RACE_DB 动态生成，一块）
   数据驱动，属性/速度/HP 等仅作展示说明，不叠加到数值上。
============================================================ */
function renderRaces() {
  const container = $('races-container');
  if (!container) return;
  container.innerHTML = '';
  const db = (typeof RACE_DB !== 'undefined') ? RACE_DB : {};
  const race = db[CHAR.race];

  const panel = document.createElement('div');
  panel.className = 'panel';

  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '种族 · ' + (CHAR.race || '') + (race && race.nameEn ? ' · ' + race.nameEn : '');
  panel.appendChild(title);

  if (!race) {
    const hint = document.createElement('div');
    hint.className = 'feat-prereq';
    hint.textContent = '当前种族「' + (CHAR.race || '未设置') + '」暂无特性数据（在 js/data/races.js 的 RACE_DB 里补充）。';
    panel.appendChild(hint);
    container.appendChild(panel);
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'feat-list';
  (race.traits || []).forEach(t => {
    const li = document.createElement('li');
    /* 复用专长条目样式；文本含 <b>，数据来自本地 RACE_DB，可信 */
    li.innerHTML = `<span class="feat-trigger cinzel">${t.name}</span>` + (t.desc || '');
    ul.appendChild(li);
  });
  panel.appendChild(ul);
  container.appendChild(panel);
}

/* ============================================================
   渲染：专长面板（依据 CHAR.feats + FEAT_DB 动态生成，每个专长一块）
============================================================ */
function renderFeats() {
  const container = $('feats-container');
  if (!container) return;
  container.innerHTML = '';
  const ids = Array.isArray(CHAR.feats) ? CHAR.feats : [];
  const db = (typeof FEAT_DB !== 'undefined') ? FEAT_DB : [];

  ids.forEach(id => {
    const ft = db.find(f => f.id === id);
    if (!ft) return;

    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = '专长 · ' + ft.name + (ft.nameEn ? ' · ' + ft.nameEn : '');
    panel.appendChild(title);

    if (ft.prereq) {
      const pr = document.createElement('div');
      pr.className = 'feat-prereq';
      pr.textContent = '先决条件：' + ft.prereq;
      panel.appendChild(pr);
    }

    const ul = document.createElement('ul');
    ul.className = 'feat-list';
    (ft.entries || []).forEach(e => {
      const li = document.createElement('li');
      /* 文本可能含 <b> 加粗，用 innerHTML；数据来自本地 FEAT_DB，可信 */
      li.innerHTML = (e.trigger ? `<span class="feat-trigger cinzel">${e.trigger}</span>` : '') + (e.text || '');
      ul.appendChild(li);
    });
    panel.appendChild(ul);

    container.appendChild(panel);
  });
}
