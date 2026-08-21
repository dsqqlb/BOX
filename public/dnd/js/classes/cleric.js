/* ============================================================
   牧师 · 职业专属模块（bespoke，数据 + 逻辑同文件）
   ------------------------------------------------------------
   面板不写死在 index.html：这里按职业动态生成。只有角色配置里
   「职业 = 牧师」时，才生成 #panel-class 并追加到「职业页」的职业资源挂载点
   #class-resource-mount。换成别的职业则完全不生成这块。
   结构：
     · channel.base   —— 所有牧师通用的引导神力能力（摧毁不死生物）
     · domains[领域]   —— 各神圣领域的专属内容；显示哪个由 CHAR.subclass（配置里
                          「神圣领域」下拉）决定：
         · abilities   —— 该领域的专属能力说明（引导神力面板里显示）
         · spells      —— 该领域的「领域法术」：常驻备法、不占备法上限、不可移除
   pip（引导神力次数）个数取 CHAR.channelDivinity；desc 里的 {DC} 替换为
   DERIVED.spellSaveDC（引导豁免 DC）。领域标签由领域名自动加，无需写在每条里。

   ★ 领域法术怎么补充（当前只填了「生命领域」，其余领域先留空）：
     1) 找到对应领域，在其对象里加 spells 字段，key = 法术环阶，value = 法术 id 列表：
          '战争领域': {
            abilities: [ { name:'战争祭司', desc:'…' } ],
            spells: { 1:['divine_favor','shield_of_faith'], 2:['magic_weapon','spiritual_weapon'],
                      3:['crusaders_mantle','spirit_guardians'] },
          },
        （5e 里领域法术在牧师 1/3/5/7/9 级解锁，对应 1/2/3/4/5 环，这里按“法术环阶”存。）
     2) ★ 重点：领域法术可以是牧师法表之外的法术（如光明/战争领域给「火球术」fireball）。
        本模块已让领域法术无视法术的 classes 字段照常显示/施放，所以放心填非牧师法术。
     3) 前提：这些 id 必须存在于 js/data/spells.js（getSpell 找得到）。库里没有的法术，
        要先去 spells.js 补一条法术数据（火球术 fireball 已存在，可直接用）。
     4) 换领域：角色配置里把「神圣领域」下拉切到该领域即可，领域法术会自动跟着换。

   ★ 加新领域（只有能力、暂无领域法术也行）：往 domains 里加一条 { abilities:[…] }。
   ★ 做别的职业：仿本文件在 js/classes/<职业>.js 里再写一份（数据+IIFE），
     并在 index.html 加一行 <script>。
============================================================ */
const CLERIC = {
  className: '牧师',
  panelTitle: '职业 · 专属资源',
  channel: {
    label: '引导神力',
    restore: '短休恢复',
    /* 通用：所有牧师都有 */
    base: [
      {
        name: '摧毁不死生物',
        desc: '消耗引导神力，展示圣徽。30尺内所有不死生物须通过<b>感知豁免（DC {DC}）</b>，失败则被<b>摧毁</b> 1分钟；每轮结束时可重新豁免，成功则摧毁终止。被摧毁的不死生物必须在其回合内远离你，且不能主动靠近。',
      },
    ],
  },
  /* 各神圣领域专属内容（显示哪个由 CHAR.subclass 决定）。
     其余 13 个领域（知识/光明/自然/风暴/诡术/战争/奥秘/锻造/坟墓/秩序/和平/暮光/死亡）
     先留空——在配置里可选，玩到哪个照上面注释补 abilities / spells 即可。*/
  domains: {
    '生命领域': {
      abilities: [
        {
          name: '生命维持',
          desc: '消耗引导神力，对30尺内<b>感知调整值</b>数量的当前生命值低于其上限一半的生物每个目标恢复到生命值其上限的一半。对亡灵生物和构装体无效。',
        },
        {
          name: '生命门徒',
          desc: '你消耗法术位施展法术的回合中，当该法术恢复生物的生命值时，额外恢复 <b>牧师等级 + 消耗法术位环阶</b> 生命值。',
        },
        {
          name: '神佑医者',
          desc: '第6级起，你施展的治疗法术也会治疗你自身。你对其他生物施展1环或更高环阶法术恢复其生命时，可对自身恢复2＋法术环阶数值的生命值。',
        },

      ],
      /* 领域法术（key = 法术环阶）。5e 生命领域：1级 祝福术/治疗真言、3级 次级复原术/
         灵体武器、5级 希望信标/活化术。升到 7/9 级再补 4/5 环（需 spells.js 里有对应 id）。*/
      spells: {
        1: ['bless', 'cure_wounds'],
        2: ['lesser_restoration', 'spiritual_weapon'],
        3: ['beacon_of_hope', 'revivify'],
      },
    },
    '光明领域': {
      abilities: [
        {
          name: '额外戏法',
          desc: '你习得 <b>光亮术</b> 戏法（若尚未习得）；它不计入你已知的戏法数量。',
        },
        {
          name: '守护耀焰',
          desc: '当30尺内你能看见（且未失能）的生物向你发起一次攻击，你可以用<b>反应</b>迸发神圣光芒，使该次攻击掷骰带<b>劣势</b>。使用次数 = <b>感知调整值</b>（至少 1 次），长休恢复。',
        },
        {
          name: '拂晓光辉',
          desc: '消耗引导神力，驱散30尺内所有由法术产生的魔法黑暗；范围内每个你选择的敌对生物须进行<b>体质豁免（DC {DC}）</b>，失败受到 <b>2d10 + 牧师等级</b> 点光耀伤害，成功减半。',
        },
      ],
      /* 领域法术（key = 法术环阶）。5e 光明领域：1级 燃烧之手/妖火、3级 烈焰法球/灼热射线、
         5级 昼明术/火球术、7级 火焰墙/信仰卫士、9级 烈焰打击/探知术。
         下面只填了 spells.js 里【已存在】的：3环 昼明术(daylight) + 火球术(fireball)。
         其余待补——先在 js/data/spells.js 加对应法术，再按建议 id 填进来：
           1: ['burning_hands', 'faerie_fire'],
           2: ['flaming_sphere', 'scorching_ray'],
           4: ['wall_of_fire', 'guardian_of_faith'],
           5: ['flame_strike', 'scrying'],
         注：火球术(fireball) 的 classes 不含牧师，属牧师法表外法术，本模块已支持照常显示/施放。*/
      spells: {
        1: ['burning_hands','faerie_fire'],
        3: ['daylight', 'fireball'],
      },
    },
    '战争领域': {
      abilities: [
        {
          name: '战争祭司',
          desc: '战斗中，当你执行「攻击」动作时，可以用一个<b>附赠动作</b>额外进行一次武器攻击。使用次数 = <b>感知调整值</b>（至少 1 次），短休或长休后恢复全部次数。',
        },
        {
          name: '引导神力：战之律令',
          desc: '当你进行一次攻击检定时，你可以消耗引导神力为该次攻击检定获得 <b>+10</b> 加值。你可以在掷骰之后、但在得知命中与否之前使用。',
        },
        {
          name: '神圣打击',
          desc: '第8级起，你每回合一次在以武器命中一个生物时，可使该次攻击额外造成 <b>1d8</b> 点你所选类型（力场/你神祇相关）的伤害（14级起为 2d8）。',
        },
      ],
      /* 领域法术（key = 法术环阶）。5e 战争领域：1级 神恩/虔诚护盾、3级 魔化武器/灵体武器、
         5级 十字军披风/灵体卫士、7级 行动自如/石肤术、9级 焰击术/定身怪物。id 均已存在于 spells.js。*/
      spells: {
        1: ['divine_favor', 'shield_of_faith'],
        2: ['magic_weapon', 'spiritual_weapon'],
        3: ['crusaders_mantle', 'spirit_guardians'],
        4: ['freedom_of_movement', 'stoneskin'],
        5: ['flame_strike', 'hold_monster'],
      },
    },
    /* 模板（复制改名即可）：
       'XX领域': {
         abilities: [ { name: '能力名', desc: '说明，可含 <b>加粗</b>；消耗引导神力的能力可写"消耗引导神力…"，DC 用 {DC} 占位' } ],
         spells: { 1: ['spellid_a', 'spellid_b'], 2: [...], 3: [...] },  // key=法术环阶，id 须存在于 spells.js
       }, */
  },
};

(function () {
  if (typeof CHAR === 'undefined' || CHAR.className !== CLERIC.className) return;

  /* 当前神圣领域（= CHAR.subclass）*/
  const domainName = CHAR.subclass || '';
  const domain = CLERIC.domains[domainName];

  /* 领域法术接入全局：把 CHAR.domainSpells 设为当前领域的法术（覆盖 character.js 的默认
     空表）。render.js / state.js 的 allDomainIds / isPrepared 都读这个，于是领域法术
     自动常驻备法、不占上限；领域没数据时为空表。*/
  CHAR.domainSpells = (domain && domain.spells) ? domain.spells : {};

  const mount = document.getElementById('class-resource-mount');
  if (!mount) return;

  /* 追加到「职业页」的职业资源挂载点 */
  const dc = (typeof DERIVED !== 'undefined' && DERIVED.spellSaveDC != null) ? DERIVED.spellSaveDC : '';
  const fillDc = s => String(s).replace('{DC}', `<span id="cd-turn-dc">${dc}</span>`);

  /* 单条能力 → HTML；domainName 有值时右上角挂领域标签 */
  const abilityHtml = (a, dn) =>
    `<div class="channel-ability">
       <div class="channel-ability-name cinzel">${a.name}${dn ? `<span class="channel-domain-tag">${dn}</span>` : ''}</div>
       <div class="channel-ability-desc">${fillDc(a.desc)}</div>
     </div>`;

  /* 通用能力 */
  let abilitiesHtml = (CLERIC.channel.base || []).map(a => abilityHtml(a, '')).join('');

  /* 当前领域的专属能力 */
  if (domain) {
    abilitiesHtml += (domain.abilities || []).map(a => abilityHtml(a, domainName)).join('');
  } else if (domainName) {
    abilitiesHtml += `<div class="channel-ability"><div class="channel-ability-desc charcfg-hint">当前领域「${domainName}」暂无专属资源数据（在 js/classes/cleric.js 的 domains 里补充）。</div></div>`;
  }

  const panel = document.createElement('div');
  panel.id = 'panel-class';
  panel.className = 'panel';
  panel.innerHTML =
    `<div class="panel-title">${CLERIC.panelTitle}</div>
     <div class="resource-row">
       <span class="resource-lbl">${CLERIC.channel.label}</span>
       <span class="resource-restore">${CLERIC.channel.restore}</span>
       <div class="resource-pips" id="channel-pips"></div>
     </div>
     ${abilitiesHtml}`;
  mount.appendChild(panel);
})();
