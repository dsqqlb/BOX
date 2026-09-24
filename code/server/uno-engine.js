'use strict';

/**
 * UNO 规则引擎（服务端权威）。
 *
 * 设计原则：
 *   1. 引擎是纯函数式的一局状态机：输入「当前局面 + 一个动作」，输出「新局面 + 一串事件」。
 *      它不认识 WebSocket、不认识网络，因此可以直接在脚本里跑几百局自测（见 ops/scripts/smoke-uno-engine.mjs）。
 *   2. 牌组与效果全部来自 resources/content/uno/*.json 的描述（数据驱动）：
 *      牌的种类、张数、出牌后的效果指令（skip / reverse / draw / chooseColor / extraTurn）都由 JSON 决定，
 *      拓展包只要往同一份结构里加牌就能生效，不需要改这个文件。
 *   3. 别人的手牌永远不下发：viewFor() 只把「自己视角」的快照交出去，别人只有张数。
 *
 * 牌的表示：{ id, face, color, kind, value }
 *   id   本局唯一实例号，例如 "red-7#2"
 *   face 牌面编号，例如 "red-7"、"red-skip"、"wild-wild4"
 *   color 'red' | 'yellow' | 'green' | 'blue' | 'wild'
 */

const HAND_SIZE = 7;
const MAX_DRAW_LOOP = 200; // 防止「摸到能出为止」在极端牌局里死循环

const DEFAULT_RULES = {
  stackDraw: false,
  wild4Strict: false,
  drawUntilPlayable: false,
  mustPlayDrawn: false,
  callUno: true,
  initialCardEffect: true,
};

class UnoRuleError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnoRuleError';
  }
}

/** mulberry32：同一个 seed 必定复现同一局，方便自测与复现问题。 */
function createRng(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = list[i];
    list[i] = list[j];
    list[j] = swap;
  }
  return list;
}

/** 把 JSON 目录整理成引擎内部好用的索引，避免每次出牌都线性查找。 */
function buildIndex(catalog) {
  const kinds = new Map();
  for (const kind of catalog.kinds || []) kinds.set(kind.id, kind);
  const colors = new Map();
  for (const color of catalog.colors || []) colors.set(color.id, color);
  const wildColor = catalog.wildColor || { id: 'wild', name: '万能', hex: '#1f2430', deep: '#0b0e16', ink: '#fff7f2' };
  colors.set(wildColor.id, wildColor);
  return {
    catalog,
    kinds,
    colors,
    categories: catalog.categories || [],
    houseRules: catalog.houseRules || [],
    wildColorId: wildColor.id,
  };
}

function range(from, to) {
  const list = [];
  for (let value = from; value <= to; value++) list.push(value);
  return list;
}

/** 按 JSON 描述生成整副牌（不洗牌）。 */
function buildDeck(catalog) {
  const cards = [];
  for (const kind of catalog.kinds || []) {
    const colorIds = kind.colorMode === 'wild' ? ['wild'] : (catalog.colors || []).map((color) => color.id);
    for (const colorId of colorIds) {
      for (const spec of kind.deck || []) {
        const values = spec.value !== undefined
          ? [spec.value]
          : (spec.valueFrom !== undefined ? range(spec.valueFrom, spec.valueTo) : [null]);
        for (const value of values) {
          for (let copy = 1; copy <= spec.count; copy++) {
            const face = kind.id === 'number' ? `${colorId}-${value}` : `${colorId}-${kind.id}`;
            cards.push({ id: `${face}#${copy}`, face, color: colorId, kind: kind.id, value: value === null ? null : value });
          }
        }
      }
    }
  }
  return cards;
}

/** 结算用的牌值：数字牌按面值，功能牌 20，万能牌 50（可由 JSON 的 points 覆盖）。 */
function pointsOf(index, card) {
  const kind = index.kinds.get(card.kind);
  if (!kind) return 0;
  if (kind.points === '按面值') return card.value || 0;
  return typeof kind.points === 'number' ? kind.points : 0;
}

function colorName(index, colorId) {
  return index.colors.get(colorId)?.name || colorId;
}

function faceLabel(index, card) {
  const kind = index.kinds.get(card.kind);
  const kindName = kind?.name || card.kind;
  if (card.kind === 'number') return `${colorName(index, card.color)} ${card.value}`;
  return `${colorName(index, card.color)} ${kindName}`;
}

// ---------- 局面 ----------

function pushEvent(state, event, text) {
  state.seq += 1;
  state.events.push({ seq: state.seq, ...event });
  if (text) {
    state.log.push({ seq: state.seq, text });
    if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
  }
}

function topCard(state) {
  return state.discardPile[state.discardPile.length - 1] || null;
}

/** 从牌堆抽牌；牌堆空了就把弃牌堆（留下顶牌）洗回去。 */
function drawCards(state, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!state.drawPile.length) {
      if (state.discardPile.length <= 1) break;
      const top = state.discardPile.pop();
      state.drawPile = shuffle(state.discardPile, state.rng);
      state.discardPile = [top];
      pushEvent(state, { kind: 'shuffle' }, '牌堆用尽，弃牌堆洗回牌堆');
    }
    drawn.push(state.drawPile.pop());
  }
  return drawn;
}

function createRound({ catalog, players, rules = {}, seed = Date.now() }) {
  const index = buildIndex(catalog);
  const rng = createRng(seed);
  const state = {
    index,
    rng,
    seed,
    rules: { ...DEFAULT_RULES, ...rules },
    players: players.map((player, position) => ({
      seat: player.seat !== undefined ? player.seat : position,
      name: player.name || `座位${position + 1}`,
      isBot: Boolean(player.isBot),
      hand: [],
      saidUno: false,
      unoPending: false,
    })),
    drawPile: shuffle(buildDeck(catalog), rng),
    discardPile: [],
    currentColor: null,
    direction: 1,
    turnSeat: 0,
    pendingDraw: 0,
    pendingDrawKind: null,
    awaitColorSeat: null,
    awaitAdvance: 1,
    drawnThisTurn: false,
    drawnCardId: null,
    phase: 'playing',
    winner: null,
    roundPoints: 0,
    turnCount: 0,
    seq: 0,
    events: [],
    log: [],
  };
  state.turnSeat = state.players.length ? state.players[0].seat : 0;
  dealRound(state);
  return state;
}

function dealRound(state) {
  for (let round = 0; round < HAND_SIZE; round++) {
    for (const player of state.players) player.hand.push(...drawCards(state, 1));
  }
  // 翻出的第一张牌不能是万能牌：变色牌开局需要立刻指定颜色，太绕，直接继续翻。
  let top = drawCards(state, 1)[0];
  let redrawn = 0;
  while (top && top.color === state.index.wildColorId) {
    state.drawPile.unshift(top);
    shuffle(state.drawPile, state.rng);
    top = drawCards(state, 1)[0];
    redrawn += 1;
    if (redrawn > 60) break;
  }
  if (!top) throw new UnoRuleError('牌堆不足，无法发牌。');
  state.discardPile.push(top);
  state.currentColor = top.color;
  pushEvent(state, {
    kind: 'deal',
    handSize: HAND_SIZE,
    players: state.players.map((player) => ({ seat: player.seat, name: player.name, handCount: player.hand.length })),
    top: { ...top },
  }, `开局发牌：每人 ${HAND_SIZE} 张，翻出 ${faceLabel(state.index, top)}`);
  if (state.rules.initialCardEffect) applyInitialEffect(state, top);
}

/** 首张功能牌按官方规则直接作用在第一位玩家身上。 */
function applyInitialEffect(state, top) {
  const first = playerAt(state, state.turnSeat);
  if (!first) return;
  if (top.kind === 'skip') {
    pushEvent(state, { kind: 'skip', seat: first.seat, source: 'initial' }, `首张牌是禁止牌：${first.name} 被跳过`);
    advanceTurn(state, 1);
    return;
  }
  if (top.kind === 'reverse') {
    if (state.players.length === 2) {
      pushEvent(state, { kind: 'reverse', direction: -1, source: 'initial' }, `首张牌是反转牌：双人局里等同禁止牌，${first.name} 继续出牌`);
      return;
    }
    state.direction *= -1;
    pushEvent(state, { kind: 'reverse', direction: state.direction, source: 'initial' }, `首张牌是反转牌：方向变为${state.direction === 1 ? '顺时针' : '逆时针'}`);
    advanceTurn(state, 1);
    return;
  }
  if (top.kind === 'draw2' || top.kind === 'wild4') {
    const count = top.kind === 'draw2' ? 2 : 4;
    const drawn = drawCards(state, count);
    first.hand.push(...drawn);
    pushEvent(state, { kind: 'draw', seat: first.seat, count: drawn.length, penalty: true, source: 'initial' }, `首张牌是${faceLabel(state.index, top)}：${first.name} 先摸 ${drawn.length} 张`);
    advanceTurn(state, 1);
  }
}

function nextSeat(state, from, steps) {
  // 座位号可能不连续（有人中途离席会留下空位），所以按「实际坐着的人」排序后绕圈，
  // 不能直接用 座位号 % 人数。
  const order = state.players.map((player) => player.seat).sort((left, right) => left - right);
  const count = order.length;
  if (!count) return from;
  const current = order.indexOf(from) === -1 ? 0 : order.indexOf(from);
  const target = ((current + state.direction * steps) % count + count) % count;
  return order[target];
}

/** 按座位号取玩家：座位号不连续时也不能用下标取。 */
function playerAt(state, seat) {
  if (seat === null || seat === undefined) return null;
  return state.players.find((player) => player.seat === seat) || null;
}

function advanceTurn(state, steps) {
  state.turnSeat = nextSeat(state, state.turnSeat, steps);
  state.drawnThisTurn = false;
  state.drawnCardId = null;
  state.turnCount += 1;
}

// ---------- 合法性 ----------

function matchesTop(state, card) {
  const top = topCard(state);
  if (!top) return true;
  if (card.color === state.index.wildColorId) return true;
  if (state.currentColor && card.color === state.currentColor) return true;
  if (card.kind === 'number' && top.kind === 'number' && card.value === top.value) return true;
  return false;
}

function continuesDrawChain(state, card) {
  if (state.pendingDrawKind === 'draw2') return card.kind === 'draw2';
  if (state.pendingDrawKind === 'wild4') return card.kind === 'wild4';
  return false;
}

function handHasColor(state, seat, colorId) {
  const player = playerAt(state, seat);
  return Boolean(player) && player.hand.some((card) => card.color === colorId);
}

/**
 * 轮到自己时能做什么：
 *   playable 可出的牌；canDraw 可以抓牌；canPass 可以过牌；mustDraw 必须抓牌（接不住罚牌）；
 *   needsColor 需要先指定颜色；reason 不能操作时的原因（直接给界面显示）。
 */
function legalMoves(state, seat) {
  const base = {
    seat,
    playable: [],
    canDraw: false,
    canPass: false,
    mustDraw: false,
    needsColor: false,
    pendingDraw: state.pendingDraw,
    drawnThisTurn: state.drawnThisTurn,
    reason: '',
  };
  if (state.phase !== 'playing') return { ...base, reason: '本局已结束。' };
  if (state.turnSeat !== seat) return { ...base, reason: '还没轮到你。' };
  if (state.awaitColorSeat !== null) {
    return {
      ...base,
      needsColor: state.awaitColorSeat === seat,
      reason: state.awaitColorSeat === seat ? '请先指定颜色。' : '正在等待上一位玩家指定颜色。',
    };
  }

  let playable = (playerAt(state, seat)?.hand || []).filter((card) => matchesTop(state, card));

  if (state.pendingDraw > 0) {
    playable = state.rules.stackDraw ? playable.filter((card) => continuesDrawChain(state, card)) : [];
  }
  if (state.rules.wild4Strict && state.currentColor) {
    playable = playable.filter((card) => card.kind !== 'wild4' || !handHasColor(state, seat, state.currentColor));
  }

  if (state.drawnThisTurn) {
    // 抓完牌之后这一轮只能打「刚抓到的那张」，否则必须过牌。
    const drawnPlayable = playable.filter((card) => card.id === state.drawnCardId);
    if (state.rules.mustPlayDrawn && drawnPlayable.length) {
      return { ...base, playable: drawnPlayable.map((card) => card.id), canPass: false, reason: '摸到能出的牌，必须打出。' };
    }
    return { ...base, playable: drawnPlayable.map((card) => card.id), canPass: true };
  }

  return {
    ...base,
    playable: playable.map((card) => card.id),
    canDraw: true,
    mustDraw: state.pendingDraw > 0 && !state.rules.stackDraw,
    canPass: false,
  };
}

function assertMyTurn(state, seat) {
  if (state.phase !== 'playing') throw new UnoRuleError('本局已结束。');
  if (state.turnSeat !== seat) throw new UnoRuleError('还没轮到你。');
  if (state.awaitColorSeat !== null) throw new UnoRuleError('请先指定颜色。');
}

function normalizeColor(state, colorId) {
  if (colorId === state.index.wildColorId) throw new UnoRuleError('万能色不能作为指定颜色。');
  if (!state.index.colors.has(colorId)) throw new UnoRuleError('颜色无效。');
  return colorId;
}

// ---------- 动作 ----------

/** 出牌：牌堆顶牌、应用效果、推进回合（需要选色时先挂起）。 */
function applyPlay(state, seat, cardId, options = {}) {
  const legal = legalMoves(state, seat);
  if (!legal.playable.includes(cardId)) throw new UnoRuleError(legal.reason || '这张牌现在不能出。');

  const player = playerAt(state, seat);
  if (!player) throw new UnoRuleError('座位不存在。');
  const position = player.hand.findIndex((card) => card.id === cardId);
  const [card] = player.hand.splice(position, 1);
  state.discardPile.push(card);
  state.drawnThisTurn = false;
  state.drawnCardId = null;
  state.turnCount += 1;

  const kind = state.index.kinds.get(card.kind);
  const wantsColor = (kind?.effect || []).some((effect) => effect.type === 'chooseColor');
  pushEvent(state, {
    kind: 'play',
    seat,
    card: { ...card },
    pendingDraw: state.pendingDraw,
  }, `${player.name} 打出 ${faceLabel(state.index, card)}`);

  if (!player.hand.length) {
    finishRound(state, seat);
    return;
  }

  // 喊牌状态：手牌降到 1 张时要喊 UNO，超过 1 张则重置
  if (player.hand.length === 1) {
    player.unoPending = state.rules.callUno && !player.saidUno;
  } else {
    player.saidUno = false;
    player.unoPending = false;
  }

  const advanceBy = applyEffects(state, seat, card);
  if (wantsColor) {
    state.awaitColorSeat = seat;
    state.awaitAdvance = advanceBy;
    state.currentColor = null;
    return;
  }
  state.currentColor = card.color;
  advanceTurn(state, advanceBy);
}

/**
 * 执行卡片的效果指令，返回「接下来回合该推进多少步」。
 *
 * 「罚摸 N 张」有两种处理：
 *   未开启叠加 — 下一位玩家立刻摸走并失去这一轮（JSON 里的 skip 步数负责跳过）；
 *   开启叠加   — 记成待处理的罚牌（pendingDraw），轮到下一位时他要么用同类牌接住，要么一次性摸走。
 */
function applyEffects(state, seat, card) {
  const kind = state.index.kinds.get(card.kind);
  const effects = kind?.effect || [];
  const player = playerAt(state, seat);
  if (!player) return 1;
  let skipSteps = 0;
  let selfDraw = 0;
  let nextDraw = null;
  let extraTurn = false;

  for (const effect of effects) {
    if (effect.type === 'reverse') {
      if (state.players.length === 2) skipSteps += 1;
      else {
        state.direction *= -1;
        pushEvent(state, { kind: 'reverse', direction: state.direction }, `出牌方向变为${state.direction === 1 ? '顺时针' : '逆时针'}`);
      }
      continue;
    }
    if (effect.type === 'skip') {
      skipSteps += effect.steps || 1;
      continue;
    }
    if (effect.type === 'draw') {
      const count = effect.count || 1;
      if (effect.target === 'self') selfDraw += count;
      else if (effect.target === 'next') nextDraw = { count, soft: Boolean(effect.playable) };
      continue;
    }
    if (effect.type === 'extraTurn') extraTurn = true;
  }

  if (selfDraw > 0) {
    const drawn = drawCards(state, selfDraw);
    player.hand.push(...drawn);
    pushEvent(state, { kind: 'draw', seat, count: drawn.length, penalty: true, self: true }, `${player.name} 因 ${faceLabel(state.index, card)} 摸了 ${drawn.length} 张`);
  }

  if (nextDraw && state.rules.stackDraw && !nextDraw.soft) {
    state.pendingDraw += nextDraw.count;
    state.pendingDrawKind = card.kind === 'wild4' ? 'wild4' : 'draw2';
    skipSteps = 0; // 叠加模式下由「接不接得住」决定谁摸牌，不再跳过下家
    pushEvent(state, { kind: 'pendingDraw', seat, count: state.pendingDraw, pendingKind: state.pendingDrawKind }, `罚牌累计到 ${state.pendingDraw} 张，等下一个接不住的人摸走`);
  } else if (nextDraw) {
    const victimSeat = nextSeat(state, seat, 1);
    const victim = playerAt(state, victimSeat);
    if (victim) {
      const drawn = drawCards(state, nextDraw.count);
      victim.hand.push(...drawn);
      pushEvent(state, { kind: 'draw', seat: victimSeat, count: drawn.length, penalty: true }, `${victim.name} 被罚摸 ${drawn.length} 张`);
    }
  }

  for (let step = 0; step < skipSteps; step++) {
    const skipped = playerAt(state, nextSeat(state, seat, 1 + step));
    if (skipped) pushEvent(state, { kind: 'skip', seat: skipped.seat }, `${skipped.name} 被跳过一轮`);
  }

  return 1 + skipSteps + (extraTurn ? -1 : 0);
}

/** 抓牌：接不住罚牌时一次性摸走；否则摸一张（或按规则摸到能出为止）。 */
function applyDraw(state, seat) {
  assertMyTurn(state, seat);
  const player = playerAt(state, seat);
  if (!player) throw new UnoRuleError('座位不存在。');

  if (state.pendingDraw > 0) {
    const count = state.pendingDraw;
    const drawn = drawCards(state, count);
    player.hand.push(...drawn);
    state.pendingDraw = 0;
    state.pendingDrawKind = null;
    player.saidUno = false;
    player.unoPending = false;
    pushEvent(state, { kind: 'draw', seat, count: drawn.length, penalty: true }, `${player.name} 接不住罚牌，摸了 ${drawn.length} 张`);
    advanceTurn(state, 1);
    return;
  }

  if (state.drawnThisTurn) throw new UnoRuleError('这一轮已经抓过牌了。');

  const drawn = [];
  let playableDrawn = false;
  const limit = state.rules.drawUntilPlayable ? MAX_DRAW_LOOP : 1;
  for (let i = 0; i < limit; i++) {
    const [card] = drawCards(state, 1);
    if (!card) break;
    drawn.push(card);
    player.hand.push(card);
    if (matchesTop(state, card)) {
      playableDrawn = true;
      break;
    }
  }
  player.saidUno = false;
  player.unoPending = false;
  state.drawnThisTurn = true;
  state.drawnCardId = drawn.length ? drawn[drawn.length - 1].id : null;
  pushEvent(state, {
    kind: 'draw',
    seat,
    count: drawn.length,
    playable: playableDrawn,
    self: true,
  }, `${player.name} 摸了 ${drawn.length} 张牌${playableDrawn ? '（其中一张能出）' : ''}`);
}

/** 过牌：只在抓过牌或规则要求时必须过牌的情况下可用。 */
function applyPass(state, seat) {
  assertMyTurn(state, seat);
  const legal = legalMoves(state, seat);
  if (!legal.canPass) throw new UnoRuleError(legal.reason || '现在不能过牌。');
  pushEvent(state, { kind: 'pass', seat }, `${playerAt(state, seat)?.name || `座位${seat}`} 选择过牌`);
  advanceTurn(state, 1);
}

/** 万能牌打出后指定颜色，颜色定下来才把回合交给下一位。 */
function applyChooseColor(state, seat, colorId) {
  if (state.phase !== 'playing') throw new UnoRuleError('本局已结束。');
  if (state.awaitColorSeat !== seat) throw new UnoRuleError('现在不需要你指定颜色。');
  const color = normalizeColor(state, colorId);
  state.currentColor = color;
  state.awaitColorSeat = null;
  pushEvent(state, { kind: 'color', seat, color }, `${playerAt(state, seat)?.name || `座位${seat}`} 指定颜色为${colorName(state.index, color)}`);
  const advanceBy = state.awaitAdvance || 1;
  state.awaitAdvance = 1;
  advanceTurn(state, advanceBy);
  return color;
}

function applyCallUno(state, seat) {
  if (state.phase !== 'playing') throw new UnoRuleError('本局已结束。');
  const player = playerAt(state, seat);
  if (!player) throw new UnoRuleError('座位不存在。');
  if (player.saidUno) return false;
  if (player.hand.length > 2) throw new UnoRuleError('手牌还有三张以上，不用喊 UNO。');
  player.saidUno = true;
  player.unoPending = false;
  pushEvent(state, { kind: 'uno', seat }, `${player.name} 喊了 UNO！`);
  return true;
}

/** 举报：目标确实忘喊 UNO 就罚摸两张；诬告的人自己摸一张。 */
function applyChallenge(state, challengerSeat, targetSeat) {
  if (state.phase !== 'playing') throw new UnoRuleError('本局已结束。');
  const target = playerAt(state, targetSeat);
  const challenger = playerAt(state, challengerSeat);
  if (!target || !challenger) throw new UnoRuleError('座位不存在。');
  if (!target.unoPending) {
    const drawn = drawCards(state, 1);
    challenger.hand.push(...drawn);
    pushEvent(state, { kind: 'challengeFailed', seat: challengerSeat, targetSeat, count: drawn.length }, `${challenger.name} 举报失败：${target.name} 已经喊过 UNO，${challenger.name} 罚摸 ${drawn.length} 张`);
    return false;
  }
  const drawn = drawCards(state, 2);
  target.hand.push(...drawn);
  target.unoPending = false;
  pushEvent(state, { kind: 'challengeSuccess', seat: challengerSeat, targetSeat, count: drawn.length }, `${target.name} 忘了喊 UNO，被 ${challenger.name} 举报，罚摸 ${drawn.length} 张`);
  return true;
}

function finishRound(state, winnerSeat) {
  state.phase = 'roundOver';
  state.winner = winnerSeat;
  let points = 0;
  for (const player of state.players) {
    for (const card of player.hand) points += pointsOf(state.index, card);
  }
  state.roundPoints = points;
  pushEvent(state, { kind: 'win', seat: winnerSeat, points }, `${playerAt(state, winnerSeat)?.name || `座位${winnerSeat}`} 出完最后一张牌，本局结束（对手剩余手牌共 ${points} 分）`);
  return points;
}

// ---------- 视图 ----------

/** 自己视角的快照：别人的手牌只给张数，牌堆只给数量。 */
function viewFor(state, seat) {
  const me = playerAt(state, seat);
  const top = topCard(state);
  return {
    phase: state.phase,
    rules: { ...state.rules },
    seat,
    direction: state.direction,
    turnSeat: state.turnSeat,
    currentColor: state.currentColor,
    top: top ? { ...top } : null,
    // 弃牌堆最近几张（公开信息）：给界面做「叠着的弃牌堆」用。
    discardTail: state.discardPile.slice(-4).map((card) => ({ ...card })),
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    pendingDraw: state.pendingDraw,
    pendingDrawKind: state.pendingDrawKind,
    awaitColorSeat: state.awaitColorSeat,
    turnCount: state.turnCount,
    winner: state.winner,
    roundPoints: state.roundPoints,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isBot: player.isBot,
      handCount: player.hand.length,
      saidUno: player.saidUno,
      unoPending: player.unoPending,
    })),
    hand: me ? me.hand.map((card) => ({ ...card })) : [],
    legal: legalMoves(state, seat),
    log: state.log.slice(-40),
    seq: state.seq,
  };
}

/** 增量事件：给界面播动画用（只含公开信息，不含别人的手牌）。 */
function eventsSince(state, seq) {
  const from = Number(seq) || 0;
  return state.events.filter((event) => event.seq > from);
}

/** 调试用全量快照：包含所有人的手牌，只能给脚本/测试用，绝不通过网络下发。 */
function dumpState(state) {
  return {
    phase: state.phase,
    rules: { ...state.rules },
    direction: state.direction,
    turnSeat: state.turnSeat,
    currentColor: state.currentColor,
    top: topCard(state) ? { ...topCard(state) } : null,
    drawPileCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    pendingDraw: state.pendingDraw,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isBot: player.isBot,
      saidUno: player.saidUno,
      unoPending: player.unoPending,
      hand: player.hand.map((card) => ({ ...card })),
    })),
    winner: state.winner,
    turnCount: state.turnCount,
    seq: state.seq,
  };
}

module.exports = {
  HAND_SIZE,
  DEFAULT_RULES,
  MAX_DRAW_LOOP,
  UnoRuleError,
  createRng,
  shuffle,
  buildIndex,
  buildDeck,
  pointsOf,
  faceLabel,
  colorName,
  topCard,
  playerAt,
  nextSeat,
  createRound,
  legalMoves,
  matchesTop,
  viewFor,
  eventsSince,
  dumpState,
  applyPlay,
  applyDraw,
  applyPass,
  applyChooseColor,
  applyCallUno,
  applyChallenge,
};