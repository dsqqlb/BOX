/* ============================================================
   状态 / 增益库 (Buff & Condition Database)
   ------------------------------------------------------------
   像法术、物品一样：全部状态 / 增益 / 战术都列在这里，
   面板实际显示哪些由"＋ 选择"决定（保存在 state.buffPicks）。
   点击芯片切换"生效/未生效"高亮。

   字段说明：
   - id     唯一标识
   - name   名称
   - effect 效果说明（芯片悬停提示 & 选择器里显示）
   - cat    分类：'condition' 状态 | 'buff' 增益 | 'tactic' 战术
============================================================ */
const BUFF_DB = [

  /* ── 增益 (buff) ── */
  { id: 'bless',           name: '祝福术',   effect: '攻击检定与豁免 +1d4',              cat: 'buff' },
  { id: 'guidance',        name: '神导术',   effect: '单次属性检定 +1d4（戏法）',        cat: 'buff' },
  { id: 'shield_of_faith', name: '虔诚护盾', effect: 'AC +2',                            cat: 'buff' },
  { id: 'aid',             name: '援助术',   effect: '生命值上限 +5',                    cat: 'buff' },
  { id: 'resistance',      name: '提防',     effect: '单次豁免 +1d4（戏法）',            cat: 'buff' },
  { id: 'haste',           name: '加速术',   effect: 'AC +2、敏捷豁免优势、速度翻倍、额外动作', cat: 'buff' },
  { id: 'beacon_of_hope',  name: '希望信标', effect: '感知/死亡豁免优势，受治疗按最大值', cat: 'buff' },
  { id: 'death_ward',      name: '死亡结界', effect: '生命降至0时改为保留1点（一次）',    cat: 'buff' },
  { id: 'protection_eg',   name: '防护善恶', effect: '特定类型生物攻击你时劣势，且不被其魅惑/恐惧/夺舍', cat: 'buff' },

  /* ── 状态 (condition) —— D&D 5e 官方 15 种（力竭在卡内单独计数，此处不含）── */
  { id: 'prone',           name: '倒地',     effect: '近战攻其有优势、远程劣势；自身攻击劣势；移动需爬行', cat: 'condition' },
  { id: 'poisoned',        name: '中毒',     effect: '攻击检定与属性检定劣势',           cat: 'condition' },
  { id: 'blinded',         name: '目盲',     effect: '无法视物；攻击劣势、被攻击有优势', cat: 'condition' },
  { id: 'charmed',         name: '魅惑',     effect: '无法攻击魅惑者，其对你社交检定有优势', cat: 'condition' },
  { id: 'deafened',        name: '耳聋',     effect: '无法听见，相关属性检定自动失败',   cat: 'condition' },
  { id: 'frightened',      name: '恐惧',     effect: '恐惧源在视线内时攻击/检定劣势；无法主动靠近', cat: 'condition' },
  { id: 'grappled',        name: '擒抱',     effect: '速度归零',                         cat: 'condition' },
  { id: 'incapacitated',   name: '失能',     effect: '无法执行动作或反应',               cat: 'condition' },
  { id: 'invisible',       name: '隐形',     effect: '攻击有优势、被攻击有劣势',         cat: 'condition' },
  { id: 'paralyzed',       name: '麻痹',     effect: '失能，自动力量/敏捷豁免失败，5尺内被暴击', cat: 'condition' },
  { id: 'petrified',       name: '石化',     effect: '失能，对大多数伤害有抗性，免疫中毒与疾病', cat: 'condition' },
  { id: 'restrained',      name: '束缚',     effect: '速度归零；攻击劣势、被攻击优势、敏捷豁免劣势', cat: 'condition' },
  { id: 'stunned',         name: '震慑',     effect: '失能，自动力量/敏捷豁免失败，被攻击有优势', cat: 'condition' },
  { id: 'unconscious',     name: '昏迷',     effect: '失能且倒地，自动力量/敏捷豁免失败，5尺内被暴击', cat: 'condition' },

  /* ── 战术 (tactic) ── */
  { id: 'dodge',           name: '闪避',     effect: '被攻击劣势（须能看见）、敏捷豁免优势', cat: 'tactic' },
  { id: 'half_cover',      name: '半掩护',   effect: 'AC 与敏捷豁免 +2',                 cat: 'tactic' },
  { id: 'tq_cover',        name: '四分之三掩护', effect: 'AC 与敏捷豁免 +5',             cat: 'tactic' },
  { id: 'inspiration',     name: '激励',     effect: '单次 d20 检定获得激励骰加值',      cat: 'tactic' },
];

/* 面板默认显示的状态标签（即原有 6 个；其余通过"＋ 选择"添加/移除） */
const DEFAULT_BUFF_PICKS = ['bless', 'guidance', 'prone', 'poisoned', 'blinded', 'charmed'];
