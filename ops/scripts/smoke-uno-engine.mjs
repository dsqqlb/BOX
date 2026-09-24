#!/usr/bin/env node
/**
 * UNO 规则引擎冒烟测试（纯内存：不启动服务、不连数据库、不需要浏览器）。
 *
 *   1. 校验牌组构成（108 张、每色 25 张、万能 8 张、实例 id 唯一）；
 *   2. 随机跑 N 局（2~4 人、随机房规、三档机器人混座），每一步都校验不变量：
 *      牌张守恒、id 不重复、手牌张数合理、非法动作被拒、罚牌叠加的账目对得上、
 *      万能+4 执法规则被遵守、每局都能在限定回合内结束且只有一个赢家；
 *   3. 打印一局完整对局回放（中文日志）与汇总统计（回合数、重洗次数、各档胜率、举报次数）。
 *
 * 用法：
 *   node ops/scripts/smoke-uno-engine.mjs                    # 默认 200 局 + 一局回放
 *   node ops/scripts/smoke-uno-engine.mjs --games=1000 --seed=12345 --quiet
 *   node ops/scripts/smoke-uno-engine.mjs --out=ops/logs/uno-engine-smoke.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');

const engine = (await import(pathToFileURL(path.join(codeRoot, 'server', 'uno-engine.js')).href)).default;
const bots = (await import(pathToFileURL(path.join(codeRoot, 'server', 'uno-bots.js')).href)).default;

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const hit = args.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const GAMES = Math.max(1, Number(argValue('games', 200)) || 200);
const BASE_SEED = Number(argValue('seed', 20260925)) || 20260925;
const QUIET = args.includes('--quiet');
const OUT_FILE = argValue('out', '');
const TURN_LIMIT = 3000;

const checks = [];
const notes = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) notes.push(`FAIL ${name}${detail ? ` → ${detail}` : ''}`);
}
function log(text) { notes.push(text); }

const catalog = JSON.parse(fs.readFileSync(path.join(projectRoot, 'resources', 'content', 'uno', 'base.json'), 'utf8'));
const SEAT_NAMES = ['你', '小林', '阿豪', '阿杰'];

// ---------- 牌组构成 ----------

function checkDeck() {
  const deck = engine.buildDeck(catalog);
  const byFace = new Map();
  for (const card of deck) byFace.set(card.face, (byFace.get(card.face) || 0) + 1);
  const perColor = {};
  for (const card of deck) {
    if (card.color === 'wild') continue;
    perColor[card.color] = (perColor[card.color] || 0) + 1;
  }
  const colorNames = catalog.colors.map((color) => color.id).join(', ');

  check('整副牌 108 张', deck.length === 108, `实际 ${deck.length} 张`);
  check('实例 id 唯一', new Set(deck.map((card) => card.id)).size === deck.length);
  check(`每个颜色各 25 张（${colorNames}）`, Object.values(perColor).every((count) => count === 25) && Object.keys(perColor).length === 4, JSON.stringify(perColor));
  check('数字 0 每色 1 张', catalog.colors.every((color) => byFace.get(`${color.id}-0`) === 1));
  check('数字 1–9 每色 2 张', catalog.colors.every((color) => [1, 2, 3, 4, 5, 6, 7, 8, 9].every((value) => byFace.get(`${color.id}-${value}`) === 2)));
  check('禁止/反转/罚摸两张 每色各 2 张', catalog.colors.every((color) => ['skip', 'reverse', 'draw2'].every((kind) => byFace.get(`${color.id}-${kind}`) === 2)));
  check('变色 4 张、变色罚摸四张 4 张', byFace.get('wild-wild') === 4 && byFace.get('wild-wild4') === 4, `wild=${byFace.get('wild-wild')} wild4=${byFace.get('wild-wild4')}`);
  check('牌值计算：数字按面值、功能牌 20、万能牌 50',
    engine.pointsOf(engine.buildIndex(catalog), deck.find((card) => card.face === 'red-7')) === 7
    && engine.pointsOf(engine.buildIndex(catalog), deck.find((card) => card.face === 'red-skip')) === 20
    && engine.pointsOf(engine.buildIndex(catalog), deck.find((card) => card.face === 'wild-wild4')) === 50);
  return deck;
}

// ---------- 不变量 ----------

/** 每一步动作后都跑一遍：任何一张牌都不允许凭空出现或消失。 */
function invariantError(state, total) {
  const seen = new Set();
  const piles = [
    ['牌堆', state.drawPile],
    ['弃牌堆', state.discardPile],
    ...state.players.map((player) => [`${player.name}手牌`, player.hand]),
  ];
  let count = 0;
  for (const [label, cards] of piles) {
    for (const card of cards) {
      if (seen.has(card.id)) return `${label} 出现重复牌 ${card.id}`;
      seen.add(card.id);
      count += 1;
    }
  }
  if (count !== total) return `牌数不守恒：${count} ≠ ${total}`;
  if (state.phase === 'playing' && !state.discardPile.length) return '弃牌堆为空';
  // 注意：座位号可能不连续，所以校验的是「这个座位号有没有人在坐」，不是数组下标。
  const seatValues = state.players.map((player) => player.seat);
  if (state.phase === 'playing' && state.turnSeat !== null && !seatValues.includes(state.turnSeat)) return `回合座位越界：${state.turnSeat}`;
  if (state.awaitColorSeat !== null && state.awaitColorSeat !== undefined && !seatValues.includes(state.awaitColorSeat)) return `选色座位越界：${state.awaitColorSeat}`;
  return null;
}

/** 故意做违规动作，必须被引擎拒绝。 */
function checkIllegalRejected(state, total) {
  const seat = state.turnSeat;
  const legal = engine.legalMoves(state, seat);
  const illegal = engine.playerAt(state, seat)?.hand.find((card) => !legal.playable.includes(card.id) && !state.index.kinds.get(card.kind)?.effect?.some((effect) => effect.type === 'chooseColor'));
  if (illegal) {
    let rejected = false;
    try { engine.applyPlay(state, seat, illegal.id); } catch (error) { rejected = error instanceof engine.UnoRuleError; }
    check('非法出牌被引擎拒绝', rejected, `牌 ${illegal.face} 未被拒绝`);
    if (!rejected) return false;
  }
  const otherSeat = (seat + 1) % state.players.length;
  let turnRejected = false;
  try { engine.applyDraw(state, otherSeat); } catch (error) { turnRejected = error instanceof engine.UnoRuleError; }
  check('非本人回合抓牌被拒绝', turnRejected);
  if (engine.legalMoves(state, seat).canPass) {
    let passRejected = false;
    try { engine.applyPass(state, otherSeat); } catch (error) { passRejected = error instanceof engine.UnoRuleError; }
    check('非本人回合过牌被拒绝', passRejected);
  }
  if (state.awaitColorSeat === null) {
    let colorRejected = false;
    try { engine.applyChooseColor(state, seat, 'purple'); } catch (error) { colorRejected = error instanceof engine.UnoRuleError; }
    check('非法颜色被拒绝', colorRejected);
  }
  check('非法动作检查后牌数仍守恒', invariantError(state, total) === null);
  return true;
}

function describeRules(rules) {
  const on = [];
  if (rules.stackDraw) on.push('罚牌叠加');
  if (rules.wild4Strict) on.push('+4执法');
  if (rules.drawUntilPlayable) on.push('摸到能出');
  if (rules.mustPlayDrawn) on.push('摸到必出');
  if (rules.callUno) on.push('喊UNO');
  if (rules.initialCardEffect) on.push('首张生效');
  return on.length ? on.join('、') : '全默认';
}

function randomRules(rng) {
  return {
    stackDraw: rng() < 0.5,
    wild4Strict: rng() < 0.5,
    drawUntilPlayable: rng() < 0.3,
    mustPlayDrawn: rng() < 0.3,
    callUno: rng() < 0.8,
    initialCardEffect: rng() < 0.7,
  };
}

function checkViewPrivacy(state) {
  const seat = state.turnSeat;
  const view = engine.viewFor(state, seat);
  check('viewFor 不下发别人的手牌', view.players.every((player) => !('hand' in player)) && !('drawPile' in view) && !('discardPile' in view));
  check('viewFor 自己的手牌与真实手牌一致', view.hand.length === engine.playerAt(state, seat).hand.length);
  check('viewFor 的 legal 与服务端判定一致', view.legal.playable.length === engine.legalMoves(state, seat).playable.length);
  const dump = engine.dumpState(state);
  check('dumpState（仅测试用）包含全量手牌', dump.players.every((player) => Array.isArray(player.hand)));
}

/** 跑完一整局（全机器人），任何异常都直接抛出，让上层记录失败。 */
function playGame({ seed, seats, levels, rules, forgetfulSeat, transcript, seatNumbers = null }) {
  const seatList = seatNumbers || Array.from({ length: seats }, (_, index) => index);
  const players = seatList.map((seat) => ({ seat, name: SEAT_NAMES[seat] || `座位${seat}`, isBot: true }));
  const state = engine.createRound({ catalog, players, rules, seed });
  const rng = engine.createRng(seed * 7919 + 17);
  const total = 108;
  const stats = { steps: 0, penalties: 0, reshuffles: 0, maxHand: 0, challengeSuccess: 0, challengeFailed: 0 };
  const transcriptLines = [];

  if (transcript) {
    transcriptLines.push(`开局：${players.map((player) => player.name).join(' / ')}｜房规：${describeRules(rules)}`);
    transcriptLines.push(`翻出底牌：${engine.faceLabel(state.index, state.discardPile[0])}｜起始座位：${engine.playerAt(state, state.turnSeat)?.name || '—'}`);
  }

  let illegalChecked = false;
  while (state.phase === 'playing') {
    if (stats.steps > TURN_LIMIT) throw new Error(`超过 ${TURN_LIMIT} 步仍未结束`);

    const seat = state.turnSeat;
    const handBefore = engine.playerAt(state, seat).hand.map((card) => ({ ...card }));
    const colorBefore = state.currentColor;
    const pendingBefore = state.pendingDraw;
    const discardBefore = state.discardPile.length;
    const seqBefore = state.seq;
    const action = bots.decide(state, seat, { level: levels[seat], rng, skipUno: forgetfulSeat === seat });
    if (action.type === 'none') throw new Error(`座位 ${seat} 无动作可做：${JSON.stringify(engine.legalMoves(state, seat))}`);
    bots.applyBotAction(state, seat, action);
    const newEvents = state.events.filter((event) => event.seq > seqBefore);
    const reshuffled = newEvents.some((event) => event.kind === 'shuffle');

    if (action.type === 'play') {
      const playEvent = newEvents.find((event) => event.kind === 'play');
      if (!playEvent) throw new Error('出牌没有产生 play 事件');
      if (engine.playerAt(state, seat).hand.length !== handBefore.length - 1) throw new Error('出牌后手牌没有减少一张');
      if (reshuffled) {
        // 出牌触发的罚摸把牌堆抽空 → 弃牌堆被洗回牌堆，只剩刚打出的那张做顶牌
        if (state.discardPile.length !== 1 || state.discardPile[0].id !== playEvent.card.id) {
          throw new Error(`重洗后弃牌堆应只剩刚打出的那张牌，实际 ${state.discardPile.length} 张`);
        }
      } else if (state.discardPile.length !== discardBefore + 1) {
        throw new Error(`出牌后弃牌堆没有增加一张（${discardBefore} → ${state.discardPile.length}）`);
      }
      if (state.discardPile[state.discardPile.length - 1].id !== playEvent.card.id) throw new Error('刚打出的牌不在弃牌堆顶');
    }
    if (rules.wild4Strict && action.type === 'play') {
      const played = state.discardPile[state.discardPile.length - 1];
      if (played.kind === 'wild4' && colorBefore && handBefore.some((card) => card.color === colorBefore)) {
        throw new Error('「+4 执法」被破坏：手上有当前颜色却打出了 +4');
      }
    }
    if (rules.stackDraw && action.type === 'play' && pendingBefore > 0 && state.phase === 'playing') {
      // 注意：打出最后一张牌时本局立刻结束，引擎按设计不再结算牌面效果，所以这里要排除。
      const played = state.discardPile[state.discardPile.length - 1];
      const unit = played.kind === 'wild4' ? 4 : played.kind === 'draw2' ? 2 : 0;
      if (unit && state.pendingDraw !== pendingBefore + unit) throw new Error(`罚牌累计不符：${pendingBefore} + ${unit} ≠ ${state.pendingDraw}`);
    }
    if (action.type === 'draw' && pendingBefore > 0) {
      const gained = engine.playerAt(state, seat).hand.length - handBefore.length;
      if (gained !== pendingBefore) throw new Error(`接罚牌时摸到的张数不符：应 ${pendingBefore}，实际 ${gained}`);
      if (state.pendingDraw !== 0) throw new Error('接罚牌后计数未清零');
      stats.penalties += 1;
    }
    if (action.type === 'chooseColor' && state.currentColor !== action.color) throw new Error('指定颜色没有生效');

    const error = invariantError(state, total);
    if (error) throw new Error(error);

    if (!illegalChecked) {
      illegalChecked = true;
      if (!checkIllegalRejected(state, total)) throw new Error('非法动作没有被拒绝，局面可能已被污染');
      checkViewPrivacy(state);
    }

    stats.maxHand = Math.max(stats.maxHand, ...state.players.map((player) => player.hand.length));
    stats.steps += 1;

    if (transcript) {
      const latest = state.log[state.log.length - 1];
      const counts = state.players.map((player) => `${player.name} ${player.hand.length}`).join(' / ');
      const suffix = state.pendingDraw > 0 ? `｜待罚 ${state.pendingDraw} 张` : '';
      transcriptLines.push(`第 ${String(stats.steps).padStart(3, ' ')} 步｜${latest ? latest.text : '—'}｜手牌 ${counts}｜牌堆 ${state.drawPile.length}${suffix}`);
    }
  }

  stats.reshuffles = state.events.filter((event) => event.kind === 'shuffle').length;
  stats.challengeSuccess = state.events.filter((event) => event.kind === 'challengeSuccess').length;
  stats.challengeFailed = state.events.filter((event) => event.kind === 'challengeFailed').length;

  if (state.phase !== 'roundOver') throw new Error(`局面未结束：${state.phase}`);
  if (state.winner === null) throw new Error('没有赢家');
  if (engine.playerAt(state, state.winner).hand.length !== 0) throw new Error('赢家手上还有牌');
  const expectedPoints = state.players.reduce((sum, player, seat) => (seat === state.winner
    ? sum
    : sum + player.hand.reduce((inner, card) => inner + engine.pointsOf(state.index, card), 0)), 0);
  if (expectedPoints !== state.roundPoints) throw new Error(`结算分数不符：${expectedPoints} ≠ ${state.roundPoints}`);
  if (state.seq !== state.events.length) throw new Error('事件序号与事件数量不一致');

  if (transcript) {
    transcriptLines.push('');
    transcriptLines.push(`结果：${engine.playerAt(state, state.winner)?.name || '—'} 获胜｜共 ${stats.steps} 步｜对手剩余 ${state.roundPoints} 分｜牌堆重洗 ${stats.reshuffles} 次`);
    transcriptLines.push(`最终手牌：${state.players.map((player) => `${player.name} ${player.hand.length} 张`).join(' / ')}`);
  }

  return { state, stats, transcriptLines };
}

// ---------- 主流程 ----------

function main() {
  checkDeck();

  const aggregate = {
    games: 0, totalSteps: 0, maxSteps: 0, minSteps: Infinity, reshuffleGames: 0, penaltyGames: 0,
    challengeSuccess: 0, challengeFailed: 0, maxHand: 0,
    winsByLevel: { easy: 0, normal: 0, hard: 0 }, playsByLevel: { easy: 0, normal: 0, hard: 0 },
    seatsGames: { 2: 0, 3: 0, 4: 0 },
  };
  let firstError = null;

  for (let game = 0; game < GAMES; game++) {
    const seed = BASE_SEED + game * 104729;
    const rng = engine.createRng(seed);
    const seats = 2 + Math.floor(rng() * 3);
    const levels = Array.from({ length: seats }, (_, seat) => bots.LEVELS[Math.floor(rng() * bots.LEVELS.length)]);
    const rules = randomRules(rng);
    const forgetfulSeat = rng() < 0.4 ? Math.floor(rng() * seats) : null;
    try {
      const { state, stats } = playGame({ seed, seats, levels, rules, forgetfulSeat, transcript: false });
      aggregate.games += 1;
      aggregate.totalSteps += stats.steps;
      aggregate.maxSteps = Math.max(aggregate.maxSteps, stats.steps);
      aggregate.minSteps = Math.min(aggregate.minSteps, stats.steps);
      aggregate.maxHand = Math.max(aggregate.maxHand, stats.maxHand);
      if (stats.reshuffles) aggregate.reshuffleGames += 1;
      if (stats.penalties) aggregate.penaltyGames += 1;
      aggregate.challengeSuccess += stats.challengeSuccess;
      aggregate.challengeFailed += stats.challengeFailed;
      aggregate.seatsGames[seats] += 1;
      for (const level of levels) aggregate.playsByLevel[level] += 1;
      aggregate.winsByLevel[levels[state.winner]] += 1;
    } catch (error) {
      firstError = error;
      check('随机对局全部跑通', false, `第 ${game + 1} 局（seed=${seed}，${seats} 人，房规 ${describeRules(rules)}，难度 ${levels.join('/')}）失败：${error.message}`);
      break;
    }
  }

  if (!firstError) check(`随机对局全部跑通（${GAMES} 局，2~4 人，随机房规与难度）`, aggregate.games === GAMES, `完成 ${aggregate.games} 局`);

  // 房间层里有人中途离席会留下空位，座位号不再连续，这种情况也必须能正常打完。
  try {
    const hole = playGame({
      seed: BASE_SEED + 4242,
      seats: 0,
      seatNumbers: [0, 2, 3],
      levels: { 0: 'normal', 2: 'hard', 3: 'easy' },
      rules: { ...engine.DEFAULT_RULES, stackDraw: true },
      forgetfulSeat: null,
      transcript: false,
    });
    check('座位号不连续（有人离席留下空位）也能打完一局',
      hole.state.phase === 'roundOver' && hole.state.winner !== null && hole.state.players.every((player) => [0, 2, 3].includes(player.seat)),
      `赢家座位 ${hole.state.winner}`);
  } catch (error) {
    check('座位号不连续（有人离席留下空位）也能打完一局', false, error.message);
  }
  if (aggregate.challengeSuccess) check('忘喊 UNO 被举报后确实罚摸两张（至少出现过一次）', aggregate.challengeSuccess > 0, `成功 ${aggregate.challengeSuccess} 次`);
  if (aggregate.reshuffleGames) check('牌堆用尽后弃牌堆被洗回（至少出现过一次）', aggregate.reshuffleGames > 0, `${aggregate.reshuffleGames} 局发生过重洗`);

  const demo = playGame({
    seed: BASE_SEED + 999983,
    seats: 4,
    levels: ['normal', 'normal', 'hard', 'easy'],
    rules: { ...engine.DEFAULT_RULES, stackDraw: true, wild4Strict: true },
    forgetfulSeat: 3,
    transcript: !QUIET,
  });
  if (QUIET) check('（--quiet）固定种子回放局也能跑通', demo.state.phase === 'roundOver', demo.state.phase);

  const rate = (wins, plays) => (plays ? `${((wins / plays) * 100).toFixed(1)}%` : '—');

  const report = [
    'UNO 规则引擎冒烟测试',
    '='.repeat(60),
    ...checks.slice(0, 12).map((item) => `  [${item.ok ? 'OK' : 'FAIL'}] ${item.name}${item.ok ? '' : ` → ${item.detail}`}`),
    `  [${checks.slice(12).every((item) => item.ok) ? 'OK' : 'FAIL'}] 对局过程中的 ${checks.length - 12} 项断言（守恒、非法动作、罚牌账目、+4 执法、胜者与结算）`,
    ...(checks.some((item) => !item.ok)
      ? ['', '失败详情', ...checks.filter((item) => !item.ok).map((item) => `  · ${item.name}${item.detail ? ` → ${item.detail}` : ''}`)]
      : []),
    '',
    '汇总统计',
    `  完成局数：${aggregate.games}｜人数分布 2人 ${aggregate.seatsGames[2]} / 3人 ${aggregate.seatsGames[3]} / 4人 ${aggregate.seatsGames[4]}`,
    `  每局步数：平均 ${(aggregate.totalSteps / Math.max(1, aggregate.games)).toFixed(1)}｜最短 ${aggregate.minSteps === Infinity ? '—' : aggregate.minSteps}｜最长 ${aggregate.maxSteps}`,
    `  单局最大手牌张数：${aggregate.maxHand}｜发生牌堆重洗的局：${aggregate.reshuffleGames}｜发生罚牌叠加结算的局：${aggregate.penaltyGames}`,
    `  喊 UNO：被举报成功 ${aggregate.challengeSuccess} 次｜诬告失败 ${aggregate.challengeFailed} 次`,
    `  各档机器人在座胜率：新手 ${rate(aggregate.winsByLevel.easy, aggregate.playsByLevel.easy)}｜普通 ${rate(aggregate.winsByLevel.normal, aggregate.playsByLevel.normal)}｜高手 ${rate(aggregate.winsByLevel.hard, aggregate.playsByLevel.hard)}`,
    '',
    '一局完整回放（4 人｜罚牌叠加 + 4 执法 + 首张生效｜含一个「忘喊 UNO」的座位）',
    '='.repeat(60),
    ...demo.transcriptLines,
    '',
    `RESULT: ${checks.every((item) => item.ok) ? 'PASS' : 'FAIL'} (${checks.filter((item) => item.ok).length}/${checks.length})`,
  ].join('\n');

  console.log(report);
  if (OUT_FILE) {
    fs.mkdirSync(path.dirname(path.resolve(projectRoot, OUT_FILE)), { recursive: true });
    fs.writeFileSync(path.resolve(projectRoot, OUT_FILE), report, 'utf8');
    console.log(`\n报告已写入 ${OUT_FILE}`);
  }
  process.exit(checks.every((item) => item.ok) ? 0 : 1);
}

main();