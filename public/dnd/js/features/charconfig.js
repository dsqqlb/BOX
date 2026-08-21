
/* ============================================================
   角色配置在线编辑器
   ------------------------------------------------------------
   character.js 里的 CHAR 是「出厂默认值」。本编辑器把你改过的字段
   存进 dnd_charConfig 覆盖层（见 state.js 的 applyCharOverlay），
   保存后刷新页面即生效——等级/属性/AC/法术位等都能在 app 里改，
   iPad 上也不用碰代码。覆盖层走 dnd_ 前缀，自动进「全数据备份」。

   说明：「生命值上限（长休恢复到此值）」在此编辑，存 charConfig 覆盖层（= CHAR.maxHp），
   是长休恢复目标；它与战斗页点数字改的"当前上限"(dnd_maxHp) 解耦——改这里不影响
   战斗页当前值，长休时才恢复到此值。「当前 HP / 经验值」仍直接点卡面数字改（dnd_hp / dnd_xp）。
============================================================ */
(function () {

  const ABI = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };

  /* 字段规格：type = text | int | select | slots；key 支持 abilities.xxx 嵌套 */
  const GROUPS = [
    {
      title: '身份',
      items: [
        { key: 'name',      label: '角色名', type: 'text' },
        { key: 'race',      label: '种族',   type: 'raceselect' },
        { key: 'className', label: '职业',   type: 'classselect' },
        { key: 'subclass',  label: '子职',   type: 'subclassselect' },
        { key: 'level',     label: '等级',   type: 'int', min: 1, max: 20 },
        { key: 'alignment', label: '阵营',   type: 'text' },
        { key: 'languages', label: '语言',   type: 'text' },
      ],
    },
    {
      title: '六维属性',
      items: [
        { key: 'abilities.str', label: '力量', type: 'int', min: 1, max: 30 },
        { key: 'abilities.dex', label: '敏捷', type: 'int', min: 1, max: 30 },
        { key: 'abilities.con', label: '体质', type: 'int', min: 1, max: 30 },
        { key: 'abilities.int', label: '智力', type: 'int', min: 1, max: 30 },
        { key: 'abilities.wis', label: '感知', type: 'int', min: 1, max: 30 },
        { key: 'abilities.cha', label: '魅力', type: 'int', min: 1, max: 30 },
      ],
    },
    {
      title: '豁免熟练',
      items: [
        { key: 'saveProfs', label: '熟练的豁免', type: 'saves' },
      ],
    },
    {
      title: '施法 & 资源',
      items: [
        { key: 'spellAbility',        label: '施法关键属性', type: 'select',
          options: Object.keys(ABI).map(k => [k, ABI[k]]) },
        { key: 'maxCantrips',         label: '戏法上限',     type: 'int', min: 0, max: 20 },
        { key: 'maxPrepared',         label: '备法上限',     type: 'int', min: 0, max: 40 },
        { key: 'spellSlots',          label: '各环法术位（逗号分隔，从 0 环/戏法起）', type: 'slots' },
      ],
    },
    {
      title: '战斗',
      items: [
        /* 长休恢复目标 = CHAR.maxHp（存 charConfig 覆盖层）。与战斗页点数字改的
           "当前上限"(dnd_maxHp) 解耦：改这里不动战斗页当前值，长休时才恢复到此值。*/
        { key: 'maxHp',      label: '生命值上限（长休恢复到此值）', type: 'int', min: 1, max: 999 },
        { key: 'ac',         label: '防御等级 AC', type: 'int', min: 0, max: 40 },
        { key: 'speed',      label: '移动速度（尺）', type: 'int', min: 0, max: 120 },
        { key: 'tempHpMax',  label: '临时HP滑条上限', type: 'int', min: 0, max: 100 },
        { key: 'hitDiceMax', label: '生命骰个数', type: 'int', min: 0, max: 30 },
      ],
    },
    {
      title: '专长',
      items: [
        { key: 'feats', label: '拥有专长', type: 'feats' },
      ],
    },
  ];

  /* 职业专属配置：编辑器里用「职业」下拉选择显示哪一组，别的职业看不到。
     每做一个 bespoke 职业模块，就往 CLASS_GROUPS 里加它的专属字段（同样存进
     charConfig 覆盖层）。字段规格与 GROUPS 里的完全一致（int/select/slots…）。*/
  const CLASS_LIST = ['野蛮人', '吟游诗人', '牧师', '德鲁伊', '战士', '武僧', '圣武士', '游侠', '游荡者', '术士', '邪术师', '法师', '奇械师'];
  /* 「子职」是统称，各职业各有叫法（5e）：这栏标签随所选职业变。缺省回落「子职」*/
  const SUBCLASS_LABEL = {
    '野蛮人': '始源之路', '吟游诗人': '诗人学院', '牧师': '神圣领域', '德鲁伊': '德鲁伊结社',
    '战士': '武术原型',   '武僧': '修行传统',   '圣武士': '神圣誓约', '游侠': '游侠原型',
    '游荡者': '游荡者原型', '术士': '术源',      '邪术师': '邪术宗主', '法师': '秘法传统',
    '奇械师': '奇械专精',
  };
  const subclassLabel = cls => SUBCLASS_LABEL[cls] || '子职';

  /* 各职业的子职下拉选项（5e 标准中文名）。「子职」栏据当前职业显示对应这一组。
     ★ 增删子职：改下面对应职业的数组即可（纯展示/存储，不影响机制）。
       牧师的「领域」还会决定领域法术，见 js/classes/cleric.js 的 domains。
     若角色存档里的子职不在列表中（自定义名），下拉会自动把它插到最前，不会丢。*/
  /* 种族下拉选项（常见 PHB 种族含亚种）。种族特性数据在 js/data/races.js 的 RACE_DB。
     存档里若有列表外的自定义种族名，下拉会自动把它插到最前，不会丢。*/
  const RACE_LIST = [
    '丘陵矮人', '山地矮人', '高等精灵', '木精灵', '卓尔', '莱特弗精灵',
    '强壮半身人', '轻足半身人', '人类', '龙裔', '林地侏儒', '岩石侏儒',
    '半精灵', '半兽人', '提夫林',
  ];
  const CLASS_SUBCLASSES = {
    '牧师':   ['知识领域', '生命领域', '光明领域', '自然领域', '风暴领域', '诡术领域', '战争领域',
               '奥秘领域', '锻造领域', '坟墓领域', '秩序领域', '和平领域', '暮光领域', '死亡领域'],
    '野蛮人': ['狂战士之路', '图腾战士之路', '祖灵守护者之路', '狂野魔法之路', '热血斗士之路', '风暴使者之路'],
    '吟游诗人': ['博学之院', '勇气之院', '剑术之院', '谄媚之院', '传颂之院', '创造之院', '雄辩之院'],
    '德鲁伊': ['大地结社', '月亮结社', '梦境结社', '牧群结社', '星辰结社', '荒野结社', '毒素结社'],
    '战士':   ['战斗大师', '冠军', '秘法骑士', '军团指挥官', '武艺大师', '神秘射手', '心理战士', '符文骑士'],
    '武僧':   ['四象之道', '醉拳之道', '剑术之道', '影踪之道', '阳炎之道', '元素之道', '慈悲之道', '御风之道', '亡者之道'],
    '圣武士': ['奉献之誓', '荣耀之誓', '复仇之誓', '天国之誓', '征服之誓', '救赎之誓', '守望之誓', '背誓者'],
    '游侠':   ['猎手', '野兽宗师', '荒野行者', '怪物杀手', '迷雾行者', '鹰隼骑士', '织羽者'],
    '游荡者': ['刺客', '秘术诡术师', '盗贼', '刀客', '阴谋家', '侦察员', '灵巧手', '幻术师'],
    '术士':   ['龙脉血统', '狂野魔法', '神系魔法', '暴风术法', '影裔魔法', '时序法术', '变异体'],
    '邪术师': ['至福之主', '妖精宗主', '邪魔宗主', '古神宗主', '天界宗主', '命运编织者', '觊天者', '共生者'],
    '法师':   ['塑法学派', '死灵学派', '惑控学派', '咒法学派', '预言学派', '幻术学派', '塑能学派', '防护学派', '战争魔法', '血法术', '传送法师'],
    '奇械师': ['炼金术士', '神器师', '战斗铁匠', '军械师'],
  };
  /* 用当前职业的子职列表填充下拉；keepVal 命中列表则保留，否则回落首项（换职业时用）*/
  function fillSubclassSelect(sel, cls, keepVal) {
    const list = (CLASS_SUBCLASSES[cls] || []).slice();
    if (keepVal && !list.includes(keepVal)) list.unshift(keepVal);   /* 保留自定义子职 */
    sel.innerHTML = '';
    list.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = s;
      sel.appendChild(opt);
    });
    sel.value = (keepVal && list.includes(keepVal)) ? keepVal : (list[0] || '');
  }
  const CLASS_GROUPS = {
    '牧师': [
      { key: 'channelDivinity',     label: '引导神力次数', type: 'int', min: 0, max: 10 }
    ],
    /* 例（以后做野蛮人模块时）：
       '野蛮人': [ { key: 'rageMax', label: '狂暴次数', type: 'int', min: 0, max: 10 } ], */
  };
  /* 「职业专属」显示哪一组，由身份里的「职业」下拉驱动（= 角色 className）*/
  let cfgViewClass = CHAR.className || '牧师';

  const fieldId = key => 'cfg_' + key.replace('.', '_');

  function getCharVal(key) {
    if (key.indexOf('.') >= 0) {
      const [a, b] = key.split('.');
      return CHAR[a] ? CHAR[a][b] : undefined;
    }
    return CHAR[key];
  }

  function setOverlay(o, key, val) {
    if (key.indexOf('.') >= 0) {
      const [a, b] = key.split('.');
      o[a] = o[a] || {};
      o[a][b] = val;
    } else {
      o[key] = val;
    }
  }

  const clamp = (v, min, max) => {
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };

  /* 构建单个字段行（GROUPS 与 职业专属组 共用）*/
  function buildFieldRow(f) {
    /* feats/saves 是块状字段：用 div，避免 <label> 把点击转发给内部第一个按钮 */
    const isBlock = (f.type === 'feats' || f.type === 'saves');
    const row = document.createElement(isBlock ? 'div' : 'label');
    row.className = 'charcfg-row';

    const lbl = document.createElement('span');
    lbl.className = 'charcfg-label';
    if (f.key === 'subclass') {
      lbl.id = 'cfg-subclass-label';      /* 名称随职业变，见 classselect 的 change */
      lbl.textContent = subclassLabel(cfgViewClass);
    } else {
      lbl.textContent = f.label;
    }
    row.appendChild(lbl);

    let input;
    const cur = getCharVal(f.key);

    if (f.type === 'select') {
      input = document.createElement('select');
      f.options.forEach(([val, text]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = text;
        input.appendChild(opt);
      });
      input.value = cur;
    } else if (f.type === 'classselect') {
      /* 职业下拉：驱动下方「职业专属」组显示哪一组 */
      input = document.createElement('select');
      const list = CLASS_LIST.slice();
      if (cur && !list.includes(cur)) list.unshift(cur);   /* 保留自定义职业名 */
      list.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        input.appendChild(opt);
      });
      input.value = cur || '';
      input.addEventListener('change', () => {
        cfgViewClass = input.value;
        renderClassFields();
        const scLbl = document.getElementById('cfg-subclass-label');
        if (scLbl) scLbl.textContent = subclassLabel(cfgViewClass);   /* 子职栏名随职业更新 */
        const scSel = document.getElementById(fieldId('subclass'));
        if (scSel) fillSubclassSelect(scSel, cfgViewClass, null);      /* 子职选项换成新职业的，默认首项 */
      });
    } else if (f.type === 'subclassselect') {
      /* 子职下拉：选项 = 当前所选职业的子职列表（换职业时在 classselect 的 change 里重填）*/
      input = document.createElement('select');
      fillSubclassSelect(input, cfgViewClass, cur);
    } else if (f.type === 'raceselect') {
      /* 种族下拉：选项来自 RACE_LIST，保留自定义种族名 */
      input = document.createElement('select');
      const list = RACE_LIST.slice();
      if (cur && !list.includes(cur)) list.unshift(cur);
      list.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        input.appendChild(opt);
      });
      input.value = cur || '';
    } else if (f.type === 'slots') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = Array.isArray(cur) ? cur.join(', ') : '';
      input.placeholder = '0, 4, 3, 2';
    } else if (f.type === 'feats') {
      /* 专长：两列紧凑网格。整条不可点，只有 ▾(看详情) 和 添加/已拥有 按钮可点 */
      input = document.createElement('div');
      const have = Array.isArray(cur) ? cur : [];
      const db = (typeof FEAT_DB !== 'undefined') ? FEAT_DB : [];
      if (!db.length) input.textContent = '（暂无可选专长，去 js/data/feats.js 添加）';
      db.forEach(ft => {
        const frow = document.createElement('div');
        frow.className = 'cfg-feat-row' + (have.includes(ft.id) ? ' owned' : '');
        frow.dataset.featId = ft.id;

        const head = document.createElement('div');
        head.className = 'cfg-feat-head';

        const nm = document.createElement('span');
        nm.className = 'cfg-feat-name';
        nm.textContent = ft.name;
        head.appendChild(nm);

        const dbtn = document.createElement('button');
        dbtn.type = 'button';
        dbtn.className = 'cfg-feat-detail-btn';
        dbtn.textContent = '▾';
        head.appendChild(dbtn);

        const tog = document.createElement('button');
        tog.type = 'button';
        tog.className = 'cfg-feat-tog';   /* 文案(添加/已拥有)由 CSS 控制 */
        tog.addEventListener('click', () => frow.classList.toggle('owned'));
        head.appendChild(tog);

        const detail = document.createElement('div');
        detail.className = 'cfg-feat-detail';
        detail.style.display = 'none';
        let detailHtml = '';
        if (ft.nameEn) detailHtml += `<div class="cfg-feat-p"><b>${ft.nameEn}</b></div>`;
        if (ft.prereq) detailHtml += `<div class="cfg-feat-p">先决条件：${ft.prereq}</div>`;
        detailHtml += (ft.entries || []).map(e =>
          `<div class="cfg-feat-p">${e.trigger ? `<b>${e.trigger}</b> ` : ''}${e.text}</div>`).join('');
        detail.innerHTML = detailHtml;

        dbtn.addEventListener('click', () => {
          const show = detail.style.display === 'none';
          detail.style.display = show ? '' : 'none';
          dbtn.classList.toggle('open', show);
          frow.classList.toggle('expanded', show);
        });

        frow.appendChild(head);
        frow.appendChild(detail);
        input.appendChild(frow);
      });
    } else if (f.type === 'saves') {
      /* 豁免熟练：六个可点按钮块，点亮=熟练 */
      input = document.createElement('div');
      const have = Array.isArray(cur) ? cur : [];
      Object.keys(ABI).forEach(k => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cfg-save-btn' + (have.includes(k) ? ' on' : '');
        b.dataset.ab = k;
        b.textContent = ABI[k];
        b.addEventListener('click', () => b.classList.toggle('on'));
        input.appendChild(b);
      });
    } else {
      input = document.createElement('input');
      input.type = (f.type === 'int') ? 'number' : 'text';
      if (f.type === 'int') { if (f.min != null) input.min = f.min; if (f.max != null) input.max = f.max; }
      input.value = cur != null ? cur : '';
    }

    input.id = fieldId(f.key);
    if (f.type === 'feats') {
      input.className = 'cfg-feat-list';
      row.classList.add('charcfg-row-block');
    } else if (f.type === 'saves') {
      input.className = 'cfg-save-btns';
      row.classList.add('charcfg-row-block');
    } else {
      input.className = 'charcfg-input';
    }
    row.appendChild(input);
    return row;
  }

  /* ──── 构建表单 ──── */
  function buildForm() {
    const body = $('charcfg-body');
    body.innerHTML = '';

    GROUPS.forEach(g => {
      const sec = document.createElement('div');
      sec.className = 'charcfg-group';
      const hdr = document.createElement('div');
      hdr.className = 'charcfg-group-title cinzel';
      hdr.textContent = g.title;
      sec.appendChild(hdr);
      g.items.forEach(f => sec.appendChild(buildFieldRow(f)));
      body.appendChild(sec);

      /* 「职业专属」组紧跟在「身份」之后；职业下拉即身份里的「职业」字段 */
      if (g.title === '身份') {
        const csec = document.createElement('div');
        csec.className = 'charcfg-group';
        const chdr = document.createElement('div');
        chdr.className = 'charcfg-group-title cinzel';
        chdr.textContent = '职业专属';
        csec.appendChild(chdr);
        const wrap = document.createElement('div');
        wrap.id = 'charcfg-class-fields';
        csec.appendChild(wrap);
        body.appendChild(csec);
        renderClassFields();
      }
    });
  }

  /* 渲染当前所选职业的专属字段（换职业只重建这一块）*/
  function renderClassFields() {
    const wrap = $('charcfg-class-fields');
    if (!wrap) return;
    wrap.innerHTML = '';
    const fields = CLASS_GROUPS[cfgViewClass] || [];
    if (!fields.length) {
      const hint = document.createElement('div');
      hint.className = 'charcfg-hint';
      hint.textContent = '该职业暂无专属配置（做了对应职业模块后会出现在这里）。';
      wrap.appendChild(hint);
      return;
    }
    fields.forEach(f => wrap.appendChild(buildFieldRow(f)));
  }

  /* ──── 读取表单 → 覆盖层对象 ──── */
  function collectOverlay() {
    const overlay = {};
    let error = null;

    const collect = f => {
      if (error) return;
      const el = $(fieldId(f.key));
      if (!el) return;   /* 未渲染（非当前所选职业的专属字段）跳过 */
      let v;

      if (f.type === 'int') {
        v = parseInt(el.value, 10);
        if (isNaN(v)) v = getCharVal(f.key);
        v = clamp(v, f.min, f.max);
      } else if (f.type === 'slots') {
        const arr = el.value.split(/[,，\s]+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 0);
        if (!arr.length) { error = '「各环法术位」至少要填一个数字，例如 0, 4, 3, 2'; return; }
        arr[0] = 0;               /* 0 环（戏法）不占法术位，恒为 0 */
        v = arr;
      } else if (f.type === 'select' || f.type === 'classselect' || f.type === 'subclassselect' || f.type === 'raceselect') {
        v = el.value;
      } else if (f.type === 'feats') {
        v = Array.from(el.querySelectorAll('.cfg-feat-row.owned')).map(r => r.dataset.featId);
      } else if (f.type === 'saves') {
        v = Array.from(el.querySelectorAll('.cfg-save-btn.on')).map(b => b.dataset.ab);
      } else {
        v = el.value.trim();
        if (!v) v = getCharVal(f.key);   /* 文本留空则回退默认，避免空名字 */
      }

      setOverlay(overlay, f.key, v);
    };

    GROUPS.forEach(g => g.items.forEach(collect));
    (CLASS_GROUPS[cfgViewClass] || []).forEach(collect);   /* 当前所选职业的专属字段 */

    return { overlay, error };
  }

  /* ──── 打开 / 关闭 ──── */
  const modal = $('charcfg-modal');

  function openEditor() {
    buildForm();
    const settings = $('settings-modal');
    if (settings) settings.classList.add('hidden');   /* 从设置弹窗进入时先收起它 */
    modal.classList.remove('hidden');
  }
  function closeEditor() {
    modal.classList.add('hidden');
    const settings = $('settings-modal');
    if (settings) settings.classList.remove('hidden');   /* 关闭后退回设置弹窗 */
  }

  const openBtn = $('btn-open-charcfg');
  if (openBtn) openBtn.addEventListener('click', openEditor);
  $('charcfg-close').addEventListener('click', closeEditor);
  $('charcfg-cancel').addEventListener('click', closeEditor);
  modal.addEventListener('click', e => { if (e.target === modal) closeEditor(); });

  /* ──── 保存 ──── */
  $('charcfg-save').addEventListener('click', () => {
    const { overlay, error } = collectOverlay();
    if (error) {
      showDialog({ icon: '⚠', title: '填写有误', message: error, confirmText: '知道了' });
      return;
    }
    /* 合并到已有覆盖层：只覆盖本次渲染出的字段，保留其它职业的专属配置不被冲掉 */
    const existing = load('charConfig', {}) || {};
    save('charConfig', Object.assign({}, existing, overlay));
    /* 重载让 state 初始化 / reconcile / DERIVED / 全部渲染重新按新配置生效 */
    location.reload();
  });

  /* ──── 恢复默认（清除覆盖层）──── */
  $('charcfg-reset').addEventListener('click', () => {
    showDialog({
      icon: '↺', title: '恢复默认配置',
      message: '将清除你在 app 内做的角色配置修改，恢复到 character.js 的出厂默认值。<br>（不影响 HP / 经验 / 法术位使用等实时状态。）确定吗？',
      confirmText: '恢复默认', cancelText: '取消',
      onConfirm: () => {
        localStorage.removeItem('dnd_charConfig');
        location.reload();
      },
    });
  });

})();
