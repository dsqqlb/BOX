/* ============================================================
   localStorage 工具
   ------------------------------------------------------------
   save() 包了 try/catch：隐私模式下 localStorage 被禁用，或存储
   配额写满时，setItem 会抛异常——不处理的话会“静默丢数据”，你
   毫无察觉。这里改成：失败就弹一次提示，告诉你去导出备份 + 清理。
============================================================ */
let _saveWarned = false;   /* 同一会话内只提示一次，避免连续操作时反复打断 */

function save(key, val) {
  try {
    localStorage.setItem('dnd_' + key, JSON.stringify(val));
  } catch (err) {
    console.error('[save] 写入 localStorage 失败：', key, err);
    if (!_saveWarned) {
      _saveWarned = true;
      if (typeof showDialog === 'function') {
        showDialog({
          icon: '⚠', title: '存储失败',
          message: '数据未能保存到本地（可能是隐私模式，或存储空间已满）。<br>' +
                    '本次改动很可能<b>没有落盘</b>，建议尽快去「背包」页导出备份，并清理不需要的旧跑团日志。',
          confirmText: '知道了',
        });
      } else {
        alert('数据保存失败：存储空间可能已满或不可用，请尽快导出备份。');
      }
    }
  }
}
function load(key, def) {
  try {
    const v = localStorage.getItem('dnd_' + key);
    return v === null ? def : JSON.parse(v);
  } catch (err) {
    console.error('[load] 读取 localStorage 失败：', key, err);
    return def;
  }
}

/* ============================================================
   角色配置覆盖层 (Character Config Overlay)
   ------------------------------------------------------------
   character.js 里的 CHAR 只是「出厂默认值」。在 app 内的「编辑角色」
   里改过的配置存进 dnd_charConfig，这里在初始化状态之前把它合并到
   CHAR 上——于是后续 state 初始化、reconcileState、DERIVED、所有渲染
   都会用上你编辑后的值。iPad 上也能改，无需再动代码。
   （overlay 走 dnd_ 前缀，自动进「全数据备份」。）
============================================================ */
(function applyCharOverlay() {
  const ov = load('charConfig', null);
  if (ov && typeof ov === 'object') Object.assign(CHAR, ov);
})();

/* ============================================================
   初始化状态
============================================================ */
let state = {
  hp:            load('hp', CHAR.maxHp),
  maxHp:         load('maxHp', CHAR.maxHp),
  tempHp:        load('tempHp', 0),
  slots:         load('slots', []),   // 法术位使用状态；形状由 reconcileState() 按 CHAR.spellSlots 对齐
  cantripIds:    load('cantripIds',  []),   // 已知戏法 ID 列表
  preparedIds:   load('preparedIds', []),   // 自选备法 ID 列表（含环1-3，不超过 maxPrepared）
  deathSave:     load('deathSave', { success:[false,false,false], fail:[false,false,false] }),
  exhaustion:    load('exhaustion', new Array(6).fill(false)),   // 力竭 6 级（5e 规则）
  channel:       load('channel', new Array(CHAR.channelDivinity).fill(false)),
  hitDice:       load('hitDice', new Array(CHAR.hitDiceMax || 0).fill(false)),  // 生命骰：true=已用；长休按上限一半恢复
  tempSpells:    load('tempSpells', []),   // 临时法术：[{key,id,uses,used,recharge:'long'|'short'}]，不消耗法术位，按休整恢复
  buffs:         load('buffs', {}),
  buffDurations: load('buffDurations', {}),   // 状态剩余轮数：{ buffId: rounds }；战斗中每回合 −1，到 0 自动结束
  buffPicks:     load('buffPicks', DEFAULT_BUFF_PICKS.slice()),  // 面板上显示哪些状态标签
  concentration: load('concentration', null),  // 专注中的法术 ID，或 null
  luckyDice:     load('luckyDice', 0),
  xp:            load('xp', CHAR.xp || 0),
  xpToNextManual: load('xpToNextManual', null),
  skillProfs:    load('skillProfs', CHAR.skills.slice()),
  /* 冒险日志：以「一次跑团」为文件夹节点，可累积多次跑团。
     每个 session = { id, title, startedAt, endedAt, timer:{running,base,startedAt}, entries:[{id,t,cat,icon,text}] }
     日志数据独立导入导出，不随角色备份走。 */
  sessions:         load('sessions', []),
  currentSessionId: load('currentSessionId', null),  // 进行中的跑团 id，或 null
};

/* ============================================================
   存档对账 (Reconcile) —— 升级安全
   ------------------------------------------------------------
   当你在 character.js 里调整了 spellSlots（解锁更高环）或 channelDivinity，
   旧存档（localStorage）里的数组形状可能和新配置不一致。
   这里在每次载入时把 state.slots / state.channel 对齐到当前 CHAR 的形状：
   · 保留仍在范围内的“已使用”状态，不丢进度
   · 新增的环阶 / 次数自动补为“可用”
   · 超出的部分自动裁掉
   这样你只改配置就能即时生效，无需清缓存或改任何逻辑代码。
============================================================ */
function reconcileState() {
  /* 法术位：按 CHAR.spellSlots 逐环阶对齐（index 0 为戏法占位，恒为空数组）*/
  const prevSlots = Array.isArray(state.slots) ? state.slots : [];
  state.slots = CHAR.spellSlots.map((count, lv) => {
    const prev = Array.isArray(prevSlots[lv]) ? prevSlots[lv] : [];
    const arr = new Array(count).fill(false);
    for (let i = 0; i < count; i++) arr[i] = !!prev[i];   /* 保留已用/未用状态 */
    return arr;
  });
  save('slots', state.slots);

  /* 引导神力：按 CHAR.channelDivinity 对齐 */
  const prevChannel = Array.isArray(state.channel) ? state.channel : [];
  state.channel = new Array(CHAR.channelDivinity).fill(false)
    .map((_, i) => !!prevChannel[i]);
  save('channel', state.channel);

  /* 生命骰：按 CHAR.hitDiceMax 对齐（改配置解锁更多生命骰时自动跟随）*/
  const prevHitDice = Array.isArray(state.hitDice) ? state.hitDice : [];
  state.hitDice = new Array(CHAR.hitDiceMax || 0).fill(false)
    .map((_, i) => !!prevHitDice[i]);
  save('hitDice', state.hitDice);
}
reconcileState();

/* ============================================================
   辅助函数
============================================================ */
const $ = id => document.getElementById(id);

function getSpell(id) { return SPELL_DB.find(s => s.id === id); }

function allDomainIds() {
  return Object.values(CHAR.domainSpells).flat();
}

/* ============================================================
   法表职业过滤
   ------------------------------------------------------------
   从 SPELL_DB 的 classes 字段自动汇总出所有职业名；生效职业存
   dnd_spellClasses（默认只有牧师）。法术页列表与「＋选择」选择器
   都只显示 classes 命中生效职业的法术——一个都不勾则全部不显示。
   切换在「模块显示」弹窗的「法表（按职业）」一列里。
============================================================ */
const ALL_SPELL_CLASSES = (typeof SPELL_DB !== 'undefined')
  ? [...new Set(SPELL_DB.flatMap(s => Array.isArray(s.classes) ? s.classes : []))]
  : [];

let spellClasses = load('spellClasses', ['牧师']);   // 生效的法表职业

function spellInActiveClasses(sp) {
  return sp && Array.isArray(sp.classes) && sp.classes.some(c => spellClasses.includes(c));
}

function isPrepared(id) {
  return state.preparedIds.includes(id) || allDomainIds().includes(id) || state.cantripIds.includes(id);
}

/* ============================================================
   派生数值计算 (Derived Stats)
   ------------------------------------------------------------
   以下数值全部由 CHAR 按 D&D 5e 公式自动算出，配置里无需手填。
   升级时只改 character_config.js 的原始数字，这里会自动重算。
============================================================ */

/* 属性调整值 = ⌊(属性得分 − 10) / 2⌋ */
function abilityMod(score) { return Math.floor((score - 10) / 2); }

/* 熟练加值 = ⌈等级 / 4⌉ + 1
   （5e 规则：1–4级 +2，5–8级 +3，9–12级 +4，13–16级 +5，17–20级 +6） */
function profBonus(level) { return Math.ceil(level / 4) + 1; }

/* 把数值格式化为带正负号的字符串：3 → "+3"，-2 → "-2"，0 → "+0" */
function signed(n) { return (n >= 0 ? '+' : '') + n; }

/* 六大属性的中文名与展示顺序 */
const ABILITY_META = [
  { key: 'str', label: '力量' },
  { key: 'dex', label: '敏捷' },
  { key: 'con', label: '体质' },
  { key: 'int', label: '智力' },
  { key: 'wis', label: '感知' },
  { key: 'cha', label: '魅力' },
];
const ABILITY_LABEL = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };

/* 统一派生值：页面上所有“算出来的数字”都从这里取 */
/* D&D 5e 标准经验值进度表（从 1 级起，累计经验门槛）*/
const XP_THRESHOLDS = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000,
  64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000
];

/* 查询第 N 级的累计经验门槛 */
function xpForLevel(lv) {
  if (lv >= XP_THRESHOLDS.length) return Infinity;
  return XP_THRESHOLDS[lv] || 0;
}

const DERIVED = {
  get prof()     { return profBonus(CHAR.level); },                          // 熟练加值
  get spellMod() { return abilityMod(CHAR.abilities[CHAR.spellAbility]); },  // 施法属性调整值
  get initiative() { return abilityMod(CHAR.abilities.dex); },              // 先攻 = 敏捷调整值
  get spellSaveDC() {                                                        // 法术豁免 DC
    // 有手动覆盖则用覆盖值，否则走公式：8 + 熟练加值 + 施法属性调整值
    return CHAR.spellSaveDC != null ? CHAR.spellSaveDC : 8 + this.prof + this.spellMod;
  },
  get spellAttack() { return this.prof + this.spellMod; },                   // 法术攻击加成 = 熟练加值 + 施法属性调整值
  get xpToNext()  {
    return state.xpToNextManual != null ? state.xpToNextManual : xpForLevel(CHAR.level + 1);
  },
};

