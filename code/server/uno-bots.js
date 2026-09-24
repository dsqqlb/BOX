'use strict';

/**
 * UNO 机器人：新手 / 普通 / 高手三档。
 *
 * 机器人只是一条「座位记录」，没有 socket，由房间层定时驱动：
 *   1. decide() 读引擎的全量局面 + 自己的手牌（不看别人的手牌，保持公平），返回一个动作意图；
 *   2. applyBotAction() 把意图交给引擎执行。
 * 所以同一套机器人既能陪玩家打，也能在超时/掉线时代打。
 */

const engine = require('./uno-engine');

const LEVELS = ['easy', 'normal', 'hard'];
const LEVEL_LABELS = { easy: '新手', normal: '普通', hard: '高手' };

function isWild(kind) {
  return kind === 'wild' || kind === 'wild4';
}

function isAction(kind) {
  return kind === 'skip' || kind === 'reverse' || kind === 'draw2';
}

/** 手上各颜色张数，用来决定「指定颜色」与出牌偏好。 */
function colorCounts(state, seat) {
  const player = engine.playerAt(state, seat);
  const counts = {};
  if (!player) return counts;
  for (const card of player.hand) {
    if (card.color === state.index.wildColorId) continue;
    counts[card.color] = (counts[card.color] || 0) + 1;
  }
  return counts;
}

function bestColor(state, seat, rng, sloppy) {
  const counts = colorCounts(state, seat);
  const entries = Object.entries(counts);
  const colors = [...state.index.colors.keys()].filter((id) => id !== state.index.wildColorId);
  if (!entries.length) return colors[Math.floor(rng() * colors.length)];
  if (sloppy && rng() < 0.35) return colors[Math.floor(rng() * colors.length)];
  entries.sort((left, right) => right[1] - left[1]);
  const best = entries[0][1];
  const tied = entries.filter((entry) => entry[1] === best).map((entry) => entry[0]);
  return tied[Math.floor(rng() * tied.length)];
}

function nextSeatOf(state) {
  return engine.nextSeat(state, state.turnSeat, 1);
}

/** 给一张可出的牌打分：分数越高越先出。 */
function scoreCard(state, seat, card, level) {
  const counts = colorCounts(state, seat);
  const player = engine.playerAt(state, seat);
  if (!player) return 0;
  const nextSeat = nextSeatOf(state);
  const nextCount = engine.playerAt(state, nextSeat)?.hand.length ?? 0;
  const threatened = nextCount <= 2;
  const lastCard = player.hand.length === 1;

  let score = 0;
  if (card.kind === 'number') score += 10 + (card.value || 0) * 0.1;
  else if (card.kind === 'skip' || card.kind === 'reverse') score += 12;
  else if (card.kind === 'draw2') score += 14;
  else if (card.kind === 'wild') score += 5;
  else if (card.kind === 'wild4') score += 3;

  // 同色牌越多，出这个颜色越容易续上
  score += 1.5 * ((counts[card.color] || 1) - 1);

  if (level === 'hard' || level === 'normal') {
    if (threatened && isAction(card.kind)) score += level === 'hard' ? 10 : 6;
    // 万能牌是保命牌，尽量留着；除非这是最后一张（能直接赢）
    if (isWild(card.kind) && !lastCard) {
      const hasAlternative = player.hand.some((other) => other.id !== card.id && !isWild(other.kind));
      if (hasAlternative) score -= level === 'hard' ? 12 : 7;
    }
    if (level === 'hard' && card.kind === 'draw2' && threatened) score += 4;
  }
  return score;
}

function pickCard(state, seat, playable, level, rng) {
  if (level === 'easy') return playable[Math.floor(rng() * playable.length)];
  let best = null;
  let bestScore = -Infinity;
  for (const card of playable) {
    const score = scoreCard(state, seat, card, level) + rng() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = card;
    }
  }
  return best;
}

/**
 * 返回机器人这一步想做的事：
 *   { type: 'chooseColor', color } / { type: 'callUno' } / { type: 'play', cardId, color }
 *   { type: 'draw' } / { type: 'pass' } / { type: 'challenge', targetSeat }
 */
function decide(state, seat, { level = 'normal', rng = Math.random, skipUno = false } = {}) {
  const player = engine.playerAt(state, seat);
  if (!player) throw new engine.UnoRuleError('座位不存在。');

  if (state.phase !== 'playing') return { type: 'none' };

  if (state.awaitColorSeat === seat) {
    return { type: 'chooseColor', color: bestColor(state, seat, rng, level === 'easy') };
  }

  const legal = engine.legalMoves(state, seat);
  if (state.turnSeat !== seat || state.awaitColorSeat !== null) return { type: 'none' };

  // 剩两张牌时先喊 UNO（喊完再出牌，手牌只剩一张时就已经喊过了）
  if (state.rules.callUno && !skipUno && !player.saidUno && player.hand.length === 2) {
    return { type: 'callUno' };
  }

  // 举报：只要有人忘喊 UNO，各档机器人都会举报（高手 100%，普通 70%，新手 40%）
  const forgetful = state.players.find((other) => other.seat !== seat && other.unoPending);
  if (forgetful) {
    const chance = level === 'hard' ? 1 : level === 'normal' ? 0.7 : 0.4;
    if (rng() < chance) return { type: 'challenge', targetSeat: forgetful.seat };
  }

  if (legal.playable.length) {
    const playable = player.hand.filter((card) => legal.playable.includes(card.id));
    const card = pickCard(state, seat, playable, level, rng);
    const wantsColor = isWild(card.kind);
    return { type: 'play', cardId: card.id, color: wantsColor ? bestColor(state, seat, rng, level === 'easy') : null };
  }

  if (legal.canDraw) return { type: 'draw' };
  if (legal.canPass) return { type: 'pass' };
  return { type: 'none' };
}

/** 把 decide() 的意图交给引擎执行，返回中文动作描述（给日志用）。 */
function applyBotAction(state, seat, action) {
  const name = engine.playerAt(state, seat)?.name || `座位${seat}`;
  switch (action.type) {
    case 'callUno':
      engine.applyCallUno(state, seat);
      return `${name} 喊了 UNO`;
    case 'challenge':
      engine.applyChallenge(state, seat, action.targetSeat);
      return `${name} 发起举报`;
    case 'chooseColor':
      return `${name} 指定颜色为${engine.colorName(state.index, engine.applyChooseColor(state, seat, action.color))}`;
    case 'play':
      engine.applyPlay(state, seat, action.cardId, { color: action.color });
      return `${name} 出牌`;
    case 'draw':
      engine.applyDraw(state, seat);
      return `${name} 抓牌`;
    case 'pass':
      engine.applyPass(state, seat);
      return `${name} 过牌`;
    default:
      throw new engine.UnoRuleError(`${name} 没有可执行的动作。`);
  }
}

module.exports = { LEVELS, LEVEL_LABELS, decide, applyBotAction, colorCounts, scoreCard };