'use strict';

/**
 * 刮刮乐：票面生成与中奖判定（服务端唯一权威）。
 *
 * 设计要点：
 *   1. 结果在「买票」那一刻就用随机种子定死并存进 ScratchTicket.resultJson，客户端只负责把涂层刮开；
 *      未刮开的票，DTO 里既没有 seed 也没有结果，所以改前端刷不出奖。
 *   2. 随机数 = crypto 摘要 + xorshift128：同一个 seed 永远生成同一张票（可复现、可审计、可回放）。
 *   3. 票种、价格、奖池权重、格子布局全部来自 resources/content/scratch/tickets.json，
 *      加一种玩法 = 改 JSON 加一条 + 在下面加一个生成器函数。
 *   4. 「金额」的单位就是德州扑克那份娱乐筹码（见 docs/scratch-cards.md）。
 */

const crypto = require('crypto');

const RULES = new Set(['three-match', 'lucky-symbol', 'high-low', 'find-word', 'line-connect', 'jackpot']);
const MONEY_UNIT = '币';

/* ── 可复现随机数 ── */

function createRng(seed) {
  const digest = crypto.createHash('sha256').update(`scratch:${seed}`).digest();
  let x = digest.readUInt32LE(0) >>> 0;
  let y = digest.readUInt32LE(4) >>> 0;
  let z = digest.readUInt32LE(8) >>> 0;
  let w = digest.readUInt32LE(12) >>> 0;
  // 全零状态会让 xorshift 永远输出 0，兜一个常量种子。
  if ((x | y | z | w) === 0) x = 0x9e3779b9;
  return function nextUint32() {
    const t = (x ^ (x << 11)) >>> 0;
    x = y; y = z; z = w;
    w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };
}

function rngFloat(rng) {
  return rng() / 4294967296;
}

function rngInt(rng, min, max) {
  if (max <= min) return min;
  return min + Math.floor(rngFloat(rng) * (max - min + 1));
}

/** 按权重抽一个元素；权重表长度必须与元素表一致。 */
function pickWeighted(rng, items, weights) {
  if (!items.length) throw new Error('权重抽样：候选列表为空。');
  const total = weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
  if (total <= 0) return items[0];
  let roll = rngFloat(rng) * total;
  for (let index = 0; index < items.length; index += 1) {
    roll -= Math.max(0, Number(weights[index]) || 0);
    if (roll < 0) return items[index];
  }
  return items[items.length - 1];
}

function shuffle(rng, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rngInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ── 配置校验与期望回收率 ── */

function money(value) {
  return `${value}${MONEY_UNIT}`;
}

function gridSize(ticket) {
  const rows = Math.trunc(Number(ticket.grid?.rows) || 0);
  const cols = Math.trunc(Number(ticket.grid?.cols) || 0);
  return { rows, cols, cells: rows * cols };
}

/** 返回配置问题列表（空数组 = 可以用）。目录接口会把它原样下发，配置写错时看得见原因而不是 500。 */
function validateTicket(ticket) {
  const problems = [];
  if (!ticket || typeof ticket !== 'object') return ['票种不是对象。'];
  if (!ticket.key) problems.push('缺少 key。');
  if (!RULES.has(ticket.rules)) problems.push(`未知玩法 ${ticket.rules}。`);
  if (!(Number(ticket.price) > 0)) problems.push('price 必须是正数。');
  const chance = Number(ticket.winChance);
  if (!(chance >= 0 && chance <= 1)) problems.push('winChance 必须在 0~1 之间。');
  if (!(Number(ticket.scratch?.threshold) > 0 && Number(ticket.scratch?.threshold) <= 1)) problems.push('scratch.threshold 必须在 0~1 之间（不含 0）。');
  const { cells } = gridSize(ticket);
  if (cells < 2) problems.push('grid 至少要 2 格。');

  if (ticket.rules === 'three-match') {
    if (!Array.isArray(ticket.prize?.values) || !Array.isArray(ticket.prize?.weights)) problems.push('three-match 需要 prize.values 与 prize.weights。');
    else if (ticket.prize.values.length !== ticket.prize.weights.length) problems.push('three-match 的 values 与 weights 长度必须一致。');
    else if (ticket.prize.values.length < cells - 2) problems.push(`three-match 需要至少 ${cells - 2} 个不同金额，才能凑出不中奖的票面。`);
  }
  if (ticket.rules === 'lucky-symbol') {
    if (!Array.isArray(ticket.symbols) || ticket.symbols.length < 3) problems.push('lucky-symbol 需要至少 3 个符号。');
    if (!Array.isArray(ticket.prize?.values) || !Array.isArray(ticket.prize?.weights)) problems.push('lucky-symbol 需要 prize.values 与 prize.weights。');
  }
  if (ticket.rules === 'high-low') {
    const range = ticket.numberRange;
    if (!Array.isArray(range) || range.length !== 2 || !(Number(range[1]) - Number(range[0]) >= 2)) problems.push('high-low 需要 numberRange（至少跨 3 个数，生成时才能避开平局）。');
    if (!Array.isArray(ticket.prize?.table)) problems.push('high-low 需要 prize.table。');
  }
  if (ticket.rules === 'find-word') {
    if (!Array.isArray(ticket.prize?.table)) problems.push('find-word 需要 prize.table。');
    if (cells < 3) problems.push('find-word 至少需要 3 格。');
  }
  if (ticket.rules === 'line-connect') {
    if (cells !== 9) problems.push('line-connect 必须是 3×3（9 格），否则「连线」判定不成立。');
    if (!Array.isArray(ticket.symbols) || ticket.symbols.length < 3) problems.push('line-connect 需要至少 3 个符号。');
    if (!Array.isArray(ticket.prize?.values) || !Array.isArray(ticket.prize?.weights)) problems.push('line-connect 需要 prize.values 与 prize.weights。');
  }
  if (ticket.rules === 'jackpot') {
    if (cells < 4) problems.push('jackpot 至少需要 4 格。');
    if (!Array.isArray(ticket.prize?.values) || !Array.isArray(ticket.prize?.weights)) problems.push('jackpot 需要 prize.values 与 prize.weights。');
  }
  return problems;
}

/** 条件于「中奖」时的平均奖金 E[prize | 中奖]。 */
function averagePrize(ticket) {
  const prize = ticket.prize || {};
  if (Array.isArray(prize.values) && Array.isArray(prize.weights)) {
    const total = prize.weights.reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
    if (total <= 0) return 0;
    return prize.values.reduce((sum, value, index) => sum + Number(value) * Math.max(0, Number(prize.weights[index]) || 0), 0) / total;
  }
  if (Array.isArray(prize.table)) {
    const total = prize.table.reduce((sum, entry) => sum + Math.max(0, Number(entry.weight) || 0), 0);
    if (total <= 0) return 0;
    return prize.table.reduce((sum, entry) => sum + Number(entry.value) * Math.max(0, Number(entry.weight) || 0), 0) / total;
  }
  return 0;
}

/** 长期回收率 = 中奖概率 × 平均奖金 ÷ 票价。调数值时看这一个数就够（< 1 时玩家长期是亏的）。 */
function expectedReturn(ticket) {
  const price = Number(ticket?.price) || 0;
  if (price <= 0) return 0;
  return (Number(ticket?.winChance) || 0) * averagePrize(ticket) / price;
}

/** 每张票碎掉能产出多少纸屑：需求规定「一张票 = 1 单位纸屑」，与票价无关；升级加成在结算时另算。 */
function shredScraps(ticket) {
  return Math.max(1, Math.trunc(Number(ticket?.shredScraps) || 1));
}

/* ── 四种玩法的生成器 ── */

/** 三连金：中奖 = 三个相同金额；不中奖时每个金额最多出现两次（避免“看起来还有一组三连”）。 */
function generateThreeMatch(rng, ticket) {
  const { cells: cellCount } = gridSize(ticket);
  const values = ticket.prize.values;
  const won = rngFloat(rng) < Number(ticket.winChance);

  if (won) {
    const target = pickWeighted(rng, values, ticket.prize.weights);
    const decoys = shuffle(rng, values.filter((value) => value !== target)).slice(0, cellCount - 3);
    const filled = [...decoys, target, target, target];
    const cells = shuffle(rng, filled).map((value, id) => ({ id, label: money(value), value, tag: value === target ? 'prize' : 'blank' }));
    return { won: true, prize: target, headline: `三个 ${target} 币！`, cells, detail: { target, matched: 3 } };
  }

  const distinct = shuffle(rng, values).slice(0, Math.ceil(cellCount / 2));
  const filled = [...distinct, ...distinct].slice(0, cellCount);
  const cells = shuffle(rng, filled).map((value, id) => ({ id, label: money(value), value, tag: 'blank' }));
  return { won: false, prize: 0, headline: '谢谢参与', cells, detail: { target: null, matched: 0 } };
}

/** 好运符号：票面先公布中奖符号，刮出三个即中奖；其它符号最多两个，杜绝“另一个符号三连”的误判。 */
function generateLuckySymbol(rng, ticket) {
  const { cells: cellCount } = gridSize(ticket);
  const symbols = ticket.symbols;
  const winningSymbol = symbols[rngInt(rng, 0, symbols.length - 1)];
  const others = symbols.filter((symbol) => symbol !== winningSymbol);
  const won = rngFloat(rng) < Number(ticket.winChance);
  const prize = won ? pickWeighted(rng, ticket.prize.values, ticket.prize.weights) : 0;
  const matches = won ? 3 : rngInt(rng, 0, 2);

  const filled = [];
  for (let index = 0; index < matches; index += 1) filled.push({ label: winningSymbol, symbol: winningSymbol, tag: won ? 'prize' : 'blank' });
  const counts = new Map();
  while (filled.length < cellCount) {
    const candidates = others.filter((symbol) => (counts.get(symbol) || 0) < 2);
    const pool = candidates.length ? candidates : others;
    const picked = pool[rngInt(rng, 0, pool.length - 1)];
    counts.set(picked, (counts.get(picked) || 0) + 1);
    filled.push({ label: picked, symbol: picked, tag: 'blank' });
  }

  const cells = shuffle(rng, filled).map((cell, id) => ({ ...cell, id }));
  // 「中奖符号」是印在票面上、刮开前就公开的信息：服务端把它放在 legend 里，
  // 客户端会印在票面上（print.legend）。它只说明本张票的中奖符号，不含任何输赢信息。
  const legend = { label: '中奖符号', symbol: winningSymbol, note: '三个即中奖' };
  return {
    won,
    prize,
    headline: won ? `三个 ${winningSymbol}，中 ${prize} 币！` : '谢谢参与',
    cells,
    legend,
    detail: { winningSymbol, matches },
  };
}

/** 比大小：3 组「你 vs 庄家」，赢 2 组与赢 3 组对应不同奖金；生成时直接避开平局。 */
function generateHighLow(rng, ticket) {
  const [minNumber, maxNumber] = ticket.numberRange.map((value) => Math.trunc(Number(value)));
  const table = ticket.prize.table;
  const won = rngFloat(rng) < Number(ticket.winChance);
  const wins = won
    ? pickWeighted(rng, table.map((entry) => Math.trunc(Number(entry.wins))), table.map((entry) => entry.weight))
    : rngInt(rng, 0, 1);

  const pattern = shuffle(rng, [true, true, true].map((_, index) => index < wins));
  const cells = [];
  pattern.forEach((playerWins, pair) => {
    let you;
    let dealer;
    if (playerWins) {
      you = rngInt(rng, minNumber + 1, maxNumber);
      dealer = rngInt(rng, minNumber, you - 1);
    } else {
      you = rngInt(rng, minNumber, maxNumber - 1);
      dealer = rngInt(rng, you + 1, maxNumber);
    }
    cells.push({ id: cells.length, label: `你 ${you}`, value: you, role: 'you', pair, tag: playerWins ? 'prize' : 'blank' });
    cells.push({ id: cells.length, label: `庄家 ${dealer}`, value: dealer, role: 'dealer', pair, tag: 'blank' });
  });

  const matched = table.find((entry) => Math.trunc(Number(entry.wins)) === wins);
  const prize = won && matched ? Number(matched.value) : 0;
  return {
    won: Boolean(won) && prize > 0,
    prize,
    headline: prize > 0 ? `赢 ${wins} 组，中 ${prize} 币！` : `赢 ${wins} 组，谢谢参与`,
    cells,
    detail: { wins },
  };
}

/** 找中奖：整张票里藏 0~2 个「中奖」，刮到就中。 */
function generateFindWord(rng, ticket) {
  const { cells: cellCount } = gridSize(ticket);
  const table = ticket.prize.table;
  const won = rngFloat(rng) < Number(ticket.winChance);
  const hits = won ? pickWeighted(rng, table.map((entry) => Math.trunc(Number(entry.hits))), table.map((entry) => entry.weight)) : 0;

  const filled = [];
  for (let index = 0; index < hits; index += 1) filled.push({ label: '中奖', tag: 'prize' });
  while (filled.length < cellCount) filled.push({ label: '谢谢参与', tag: 'blank' });
  const cells = shuffle(rng, filled).map((cell, id) => ({ ...cell, id }));
  const matched = table.find((entry) => Math.trunc(Number(entry.hits)) === hits);
  const prize = hits > 0 && matched ? Number(matched.value) : 0;
  return {
    won: prize > 0,
    prize,
    headline: prize > 0 ? `找到 ${hits} 个「中奖」，中 ${prize} 币！` : '谢谢参与',
    cells,
    detail: { hits },
  };
}

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // 三行
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // 三列
  [0, 4, 8], [2, 4, 6],              // 两条对角线
];

/** 3×3 里三格全相同的线。 */
function identicalLines(grid) {
  return LINES.filter((line) => grid[line[0]] === grid[line[1]] && grid[line[1]] === grid[line[2]]);
}

/**
 * 连线：任意一行/一列/一条对角线出现三个相同符号即中奖。
 * 随机撒 9 格再检查「恰好几条线三连」，命中就采纳；实在不命中时用两组已验证的确定性布局兜底，
 * 所以不会出现「看来连成线却不中奖」的歧义票面。
 */
function generateLineConnect(rng, ticket) {
  const symbols = ticket.symbols;
  const won = rngFloat(rng) < Number(ticket.winChance);
  let grid = null;
  for (let attempt = 0; attempt < 300 && !grid; attempt += 1) {
    const candidate = Array.from({ length: 9 }, () => symbols[rngInt(rng, 0, symbols.length - 1)]);
    if (identicalLines(candidate).length === (won ? 1 : 0)) grid = candidate;
  }
  if (!grid) {
    // 兜底布局（已验证：任一行/列/对角都不会三连；中奖版只有第一行三连），再随机镜像与换符号保持新鲜感
    const base = won ? [0, 0, 0, 0, 1, 1, 2, 1, 0] : [0, 0, 1, 0, 1, 1, 2, 1, 0];
    const picked = shuffle(rng, symbols).slice(0, 3);
    const flipRows = rngFloat(rng) < 0.5;
    const flipCols = rngFloat(rng) < 0.5;
    grid = base.map((_, index) => {
      const row = Math.floor(index / 3);
      const col = index % 3;
      const source = (flipRows ? 2 - row : row) * 3 + (flipCols ? 2 - col : col);
      return picked[base[source]];
    });
  }

  const lines = identicalLines(grid);
  const prizeLine = lines[0] || [];
  const prize = won ? pickWeighted(rng, ticket.prize.values, ticket.prize.weights) : 0;
  const cells = grid.map((symbol, index) => ({
    id: index,
    label: symbol,
    tag: won && prizeLine.includes(index) ? 'prize' : 'blank',
  }));
  return {
    won: Boolean(won) && prize > 0,
    prize,
    headline: prize > 0 ? `连成一线，中 ${prize} 币！` : '谢谢参与',
    cells,
    detail: { lines: lines.length },
  };
}

/** 头奖轮：6 格，只要出现一格「头奖」就拿走大奖（概率很低，所以是「头奖」）。 */
function generateJackpot(rng, ticket) {
  const { cells: cellCount } = gridSize(ticket);
  const won = rngFloat(rng) < Number(ticket.winChance);
  const prize = won ? pickWeighted(rng, ticket.prize.values, ticket.prize.weights) : 0;
  const filled = Array.from({ length: cellCount }, () => ({ label: '✕', tag: 'blank' }));
  if (won) filled[rngInt(rng, 0, cellCount - 1)] = { label: '头奖', tag: 'prize' };
  const cells = shuffle(rng, filled).map((cell, id) => ({ ...cell, id }));
  return {
    won: Boolean(won) && prize > 0,
    prize,
    headline: prize > 0 ? `头奖！中 ${prize} 币` : '谢谢参与',
    cells,
    detail: { jackpot: Boolean(won) },
  };
}

const GENERATORS = {
  'three-match': generateThreeMatch,
  'lucky-symbol': generateLuckySymbol,
  'high-low': generateHighLow,
  'find-word': generateFindWord,
  'line-connect': generateLineConnect,
  jackpot: generateJackpot,
};

/**
 * 生成一张票的结果（返回值里没有 seed，seed 只留在数据库里）。
 * 同一个 seed + 同一份配置 → 完全相同的 result，所以可以复现、可以让冒烟测试断言。
 *
 * options.winChance：覆盖本张票的中奖概率（「幸运护符」升级用），只覆盖这一个字段，
 * 不改缓存的配置对象，所以对其他票没有影响。生成器里用到的 winChance 都从这里读。
 */
function generateResult(ticket, seed, options = {}) {
  const generate = GENERATORS[ticket.rules];
  if (!generate) throw new Error(`未知的刮刮乐玩法：${ticket.rules}`);
  const override = Number(options.winChance);
  const effective = Number.isFinite(override)
    ? { ...ticket, winChance: Math.min(1, Math.max(0, override)) }
    : ticket;
  const generated = generate(createRng(seed), effective);
  return {
    version: 1,
    kind: ticket.key,
    rules: ticket.rules,
    grid: { rows: Math.trunc(Number(ticket.grid.rows)), cols: Math.trunc(Number(ticket.grid.cols)) },
    shredScraps: shredScraps(ticket),
    ...generated,
  };
}

module.exports = {
  RULES,
  MONEY_UNIT,
  createRng,
  rngFloat,
  rngInt,
  pickWeighted,
  shuffle,
  validateTicket,
  averagePrize,
  expectedReturn,
  shredScraps,
  generateResult,
};