/* ============================================================
   技能数据库 (Skill Database)
   字段: id, name, ability(属性key), abilityLabel(属性中文)
============================================================ */
const SKILL_DB = [
  /* ── 力量 Strength ── */
  { id: 'athletics',     name: '运动',   ability: 'str', abilityLabel: '力量' },

  /* ── 敏捷 Dexterity ── */
  { id: 'acrobatics',    name: '体操',   ability: 'dex', abilityLabel: '敏捷' },
  { id: 'sleight',       name: '巧手',   ability: 'dex', abilityLabel: '敏捷' },
  { id: 'stealth',       name: '隐匿',   ability: 'dex', abilityLabel: '敏捷' },

  /* ── 智力 Intelligence ── */
  { id: 'arcana',        name: '奥秘',   ability: 'int', abilityLabel: '智力' },
  { id: 'history',       name: '历史',   ability: 'int', abilityLabel: '智力' },
  { id: 'investigation', name: '调查',   ability: 'int', abilityLabel: '智力' },
  { id: 'nature',        name: '自然',   ability: 'int', abilityLabel: '智力' },
  { id: 'religion',      name: '宗教',   ability: 'int', abilityLabel: '智力' },

  /* ── 感知 Wisdom ── */
  { id: 'animal',        name: '驯兽',   ability: 'wis', abilityLabel: '感知' },
  { id: 'insight',       name: '洞悉',   ability: 'wis', abilityLabel: '感知' },
  { id: 'medicine',      name: '医药',   ability: 'wis', abilityLabel: '感知' },
  { id: 'perception',    name: '察觉',   ability: 'wis', abilityLabel: '感知' },
  { id: 'survival',      name: '求生',   ability: 'wis', abilityLabel: '感知' },

  /* ── 魅力 Charisma ── */
  { id: 'deception',     name: '欺瞒',   ability: 'cha', abilityLabel: '魅力' },
  { id: 'intimidation',  name: '威吓',   ability: 'cha', abilityLabel: '魅力' },
  { id: 'performance',   name: '表演',   ability: 'cha', abilityLabel: '魅力' },
  { id: 'persuasion',    name: '游说',   ability: 'cha', abilityLabel: '魅力' },
];

/* 按 skill id 查找 */
function getSkill(id) { return SKILL_DB.find(s => s.id === id); }

/* 按属性分组 */
function skillsByAbility() {
  const groups = [];
  const meta = { str: '力量', dex: '敏捷', int: '智力', wis: '感知', cha: '魅力' };
  ['str', 'dex', 'int', 'wis', 'cha'].forEach(key => {
    const list = SKILL_DB.filter(s => s.ability === key);
    if (list.length) groups.push({ abilityKey: key, abilityLabel: meta[key], skills: list });
  });
  return groups; 
}
