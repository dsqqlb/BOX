/* ============================================================
   模块显示开关（插件式架构）
   ------------------------------------------------------------
   卡面被拆成一个个「模块」。这里是引擎：把所有已注册模块列成勾选项
   放进「设置」弹窗，用户勾谁显示谁；选择存 dnd_modules（进备份）。
   系统本身不认识职业——只认识"模块开没开"。

   ★ 加新模块（比如给某职业做专属块）：
     1) 给该块的 DOM 加 data-module="你的id"（或用已有 id 选择器）；
     2) 往下面 MODULES 里登记一条 { id, label, group, sel }；
        整页模块用 { id, label, group, page:'page-xxx' }。
     登记后它会自动出现在设置的勾选列表里，无需改本文件其它逻辑。
     ★ 职业专属模块：登记时加 cls:'职业名'（如 cls:'牧师'）。它只在角色配置里
        选中该职业时才显示 / 才出现在勾选列表；换职业自动隐藏。
   ------------------------------------------------------------
   注：核心块（HP、六维、日志页本身）不做成可关，避免误关后找不回入口
       （设置齿轮就在日志页）。
============================================================ */
(function () {
  const MODULES = [
    /* —— 战斗页 —— */
    { id: 'lucky',      label: '幸运骰',            group: '战斗页', sel: '#lucky-dice-row' },
    { id: 'statuses',   label: '状态标签',          group: '战斗页', sel: '#buff-chips' },
    { id: 'corestats',  label: 'AC / 速度 / 先攻 / 熟练', group: '战斗页', sel: '#core-stats-row' },
    { id: 'deathsaves', label: '死亡豁免',          group: '战斗页', sel: '[data-module="deathsaves"]' },
    { id: 'exhaustion', label: '力竭计数',          group: '战斗页', sel: '[data-module="exhaustion"]' },
    { id: 'castcore',   label: '施法核心属性',      group: '战斗页', sel: '[data-module="castcore"]' },
    { id: 'hitdice',    label: '生命骰',            group: '战斗页', sel: '#hitdice-row' },

    /* —— 角色页（通用角色卡，与职业/种族无关）—— */
    { id: 'identity', label: '角色头衔',            group: '角色页', sel: '#class-char-header' },
    { id: 'abilities',label: '六维属性',            group: '角色页', sel: '#header-stats' },
    { id: 'saves',    label: '豁免检定',            group: '角色页', sel: '#saves-section' },
    { id: 'racialtraits', label: '种族特性',        group: '角色页', sel: '#races-container' },
    { id: 'feats',    label: '专长',                group: '角色页', sel: '#feats-container' },
    { id: 'charinfo', label: '角色信息',            group: '角色页', sel: '#panel-charinfo' },
    { id: 'skills',   label: '熟练技能',            group: '角色页', sel: '#panel-skills' },
    { id: 'xp',       label: '经验值',              group: '角色页', sel: '#panel-xp' },

    /* —— 职业页（职业专属资源；带 cls 者只在对应职业显示）—— */
    { id: 'channel',  label: '职业资源 · 引导神力', group: '职业页', sel: '#panel-class', cls: '牧师' },

    /* —— 法术页（法表按职业过滤见下方 buildToggles + state.js 的 spellClasses）—— */
    { id: 'tempspells', label: '临时法术', group: '法术页', sel: '#temp-spells-block' },

    /* —— 背包页（页/标签始终保留，只隐藏内容）—— */
    { id: 'equip',    label: '装备 / 笔记',         group: '背包页', sel: '[data-module="equip"]' },
    { id: 'weight',   label: '负重统计',            group: '背包页', sel: '#weight-summary' },
    { id: 'currency', label: '货币',                group: '背包页', sel: '#misc-currency' },
    { id: 'ledger',   label: '收支流水',            group: '背包页', sel: '#bag-ledger' },

    /* —— 日志页 —— */
    { id: 'lines', label: '台词 · 灵感',            group: '日志页', sel: '#panel-lines' },
    { id: 'quests', label: '任务 · 备忘',           group: '日志页', sel: '#panel-quests' },
  ];

  /* 可自动收起的容器：里面登记的模块全部隐藏时，整块（含边框/标题）一起藏起来，
     消灭"只剩标题的空盒子"。往面板加新模块时，同步更新这里的 modules 列表。*/
  const COLLAPSE = [
    { sel: '#panel-buff',      modules: ['lucky', 'statuses', 'corestats', 'deathsaves', 'exhaustion', 'castcore'] },
    { sel: '.death-saves-row', modules: ['deathsaves', 'exhaustion'] },   // 并排行：两半都关就收起
    { sel: '#panel-equip',     modules: ['equip', 'weight', 'currency', 'ledger'] },
  ];

  const prefs = () => load('modules', {});
  const isOn = (p, id) => p[id] !== false;   /* 缺省 = 显示 */

  /* 职业专属模块（带 cls）只在当前角色职业匹配时才存在——由角色配置里的
     「职业」下拉决定（= CHAR.className）。不匹配时：页面强制隐藏，且不出现在
     「模块显示」勾选列表里。做别的职业专属模块时，登记时带上 cls 即可。*/
  const curClass = () => (typeof CHAR !== 'undefined' && CHAR.className) || '';
  const classOK = m => !m || !m.cls || m.cls === curClass();
  const modById = {};
  MODULES.forEach(m => { modById[m.id] = m; });

  /* 法术面板：一个法表职业都没勾 → 整块收起（法术标签仍在）*/
  function applySpellPanelVisibility() {
    const panel = document.getElementById('panel-spell');
    if (panel) panel.style.display = (typeof spellClasses !== 'undefined' && spellClasses.length) ? '' : 'none';
  }

  /* 勾/取消某个法表职业：更新 spellClasses（state.js 的全局）→ 存盘 → 重渲染法术页/选择器 */
  function setSpellClass(cls, on) {
    if (typeof spellClasses === 'undefined') return;
    const i = spellClasses.indexOf(cls);
    if (on && i < 0) spellClasses.push(cls);
    else if (!on && i >= 0) spellClasses.splice(i, 1);
    save('spellClasses', spellClasses);
    if (typeof renderSpellPanel === 'function') renderSpellPanel();
    applySpellPanelVisibility();
    const sm = document.getElementById('spell-modal');
    if (sm && !sm.classList.contains('hidden') && typeof renderPicker === 'function') renderPicker();
  }

  /* 「法表（按职业）」一列：从 SPELL_DB 汇总的职业自动生成，勾选即过滤 */
  function appendSpellClassCol(wrap) {
    const classes = (typeof ALL_SPELL_CLASSES !== 'undefined') ? ALL_SPELL_CLASSES : [];
    if (!classes.length) return;
    const col = document.createElement('div');
    col.className = 'module-col';
    const hdr = document.createElement('div');
    hdr.className = 'module-group-hdr';
    hdr.textContent = '法表（按职业）';
    col.appendChild(hdr);
    classes.forEach(cls => {
      const lab = document.createElement('label');
      lab.className = 'module-check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = (typeof spellClasses !== 'undefined') && spellClasses.includes(cls);
      cb.addEventListener('change', () => setSpellClass(cls, cb.checked));
      lab.appendChild(cb);
      const sp = document.createElement('span');
      sp.textContent = cls + '法术';
      lab.appendChild(sp);
      col.appendChild(lab);
    });
    wrap.appendChild(col);
  }

  /* ──── 应用显隐 ──── */
  function apply() {
    const p = prefs();
    /* 有效显隐 = 用户勾选 且 职业匹配（职业专属模块不匹配当前职业则强制隐藏）*/
    const on = id => isOn(p, id) && classOK(modById[id]);

    /* 1) 单个模块显隐 */
    MODULES.forEach(m => {
      const vis = on(m.id);
      if (m.page) {
        const tab = document.querySelector('.tab-btn[data-page="' + m.page + '"]');
        if (tab) tab.style.display = vis ? '' : 'none';
        const pg = document.getElementById(m.page);
        if (!vis && pg && pg.classList.contains('active')) gotoCombat();
      } else if (m.sel) {
        document.querySelectorAll(m.sel).forEach(el => { el.style.display = vis ? '' : 'none'; });
      }
    });

    /* 2) 空容器自动收起（面板/并排行里模块全关 → 整块隐藏）*/
    COLLAPSE.forEach(c => {
      const el = document.querySelector(c.sel);
      if (el) el.style.display = c.modules.some(on) ? '' : 'none';
    });

    /* 法术面板：一个法表职业都没勾时整块收起（法术标签仍在）*/
    applySpellPanelVisibility();

    /* 角色页改为 CSS 两列自动流（见 css 的 #character-modules / #character-flow），
       隐藏模块会自动重新均衡填充，无需再手动塌栏。*/
  }

  /* 关掉的正好是当前页时，回落到战斗页 */
  function gotoCombat() {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const tab = document.querySelector('.tab-btn[data-page="page-combat"]');
    const pg  = document.getElementById('page-combat');
    if (tab) tab.classList.add('active');
    if (pg)  pg.classList.add('active');
    if (typeof save === 'function') save('active_page', 'page-combat');
  }

  /* ──── 大弹窗里的勾选列表（按 group 分成多列）──── */
  function buildToggles() {
    const wrap = $('module-toggles');
    if (!wrap) return;
    wrap.innerHTML = '';
    const p = prefs();

    /* 按 group 收拢成列，保持首次出现顺序；职业专属模块只在职业匹配时列出 */
    const cols = [];
    MODULES.forEach(m => {
      if (!classOK(m)) return;   /* 非当前职业的专属模块不出现在勾选列表里 */
      let g = cols.find(c => c.name === m.group);
      if (!g) { g = { name: m.group, items: [] }; cols.push(g); }
      g.items.push(m);
    });

    cols.forEach(g => {
      const col = document.createElement('div');
      col.className = 'module-col';

      const hdr = document.createElement('div');
      hdr.className = 'module-group-hdr';
      hdr.textContent = g.name;
      col.appendChild(hdr);

      g.items.forEach(m => {
        const lab = document.createElement('label');
        lab.className = 'module-check';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isOn(p, m.id);
        cb.addEventListener('change', () => {
          const cur = prefs();
          cur[m.id] = cb.checked;
          save('modules', cur);
          apply();
        });
        lab.appendChild(cb);
        const sp = document.createElement('span');
        sp.textContent = m.label;
        lab.appendChild(sp);
        col.appendChild(lab);
      });

      wrap.appendChild(col);
      if (g.name === '职业页') appendSpellClassCol(wrap);   /* 法表列排在职业页之后 */
    });

    /* 兜底：若没有职业页分组，仍追加法表列 */
    if (!cols.some(c => c.name === '职业页')) appendSpellClassCol(wrap);
  }

  /* ──── 大弹窗开关 ──── */
  const modal   = $('modules-modal');
  const openBtn = $('btn-open-modules');
  if (openBtn && modal) {
    openBtn.addEventListener('click', () => {
      buildToggles();
      const s = $('settings-modal');
      if (s) s.classList.add('hidden');     /* 从设置弹窗进入时先收起它 */
      modal.classList.remove('hidden');
    });
    /* 关闭后退回设置弹窗（本弹窗只从设置进入）*/
    const closeModules = () => {
      modal.classList.add('hidden');
      const s = $('settings-modal');
      if (s) s.classList.remove('hidden');
    };
    $('modules-close').addEventListener('click', closeModules);
    modal.addEventListener('click', e => { if (e.target === modal) closeModules(); });
  }

  buildToggles();
  apply();
})();
