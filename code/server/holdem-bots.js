'use strict';

/**
 * 机器人决策：蒙特卡洛估算胜率 + 底池赔率比较，三档难度。
 *
 * 同一套逻辑还负责「超时托管」——玩家思考超时时由对应难度的机器人替他做这一次决策，
 * 玩家下一次行动即收回控制权（见 holdem-rooms.js）。
 *
 * 难度差异：
 *   easy   模拟次数少、跟得松、几乎不加注，像新手；
 *   normal 按底池赔率决策，胜率高才加注；
 *   hard   模拟次数多、按胜率调整下注尺度，并有低频诈唬。
 */

const crypto = require('crypto');
const { Hand } = require('pokersolver');
const { buildDeck } = require('./holdem-engine');

const LEVELS = {
  easy: { iterations: 120, callMargin: -0.12, raiseThreshold: 0.78, bluffChance: 0.02, aggression: 0.45 },
  normal: { iterations: 240, callMargin: 0.0, raiseThreshold: 0.62, bluffChance: 0.06, aggression: 0.7 },
  hard: { iterations: 420, callMargin: 0.04, raiseThreshold: 0.55, bluffChance: 0.12, aggression: 1.0 },
};
const BOT_NAMES = ['铁手老张', '冷面苏', '算牌阿伟', '推土机老陈', '微笑刺客', '慢热老王', '疯狗小李', '石头先生'];

function levelConfig(level) { return LEVELS[level] || LEVELS.normal; }

function randomFloat() { return crypto.randomInt(1_000_000) / 1_000_000; }

/** 蒙特卡洛胜率：随机补齐公共牌与对手底牌，统计赢/平的比例。 */
function estimateEquity(holeCards, board, opponents, iterations) {
  const known = new Set([...holeCards, ...board]);
  const remaining = buildDeck().filter((card) => !known.has(card));
  const rivals = Math.max(1, Math.min(opponents, 8));
  let score = 0;

  for (let round = 0; round < iterations; round++) {
    const pool = remaining.slice();
    const draw = () => pool.splice(crypto.randomInt(pool.length), 1)[0];
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(draw());
    const mine = Hand.solve([...holeCards, ...fullBoard]);

    let lost = false;
    let tied = false;
    for (let rival = 0; rival < rivals; rival++) {
      const opponentHand = Hand.solve([draw(), draw(), ...fullBoard]);
      const winners = Hand.winners([mine, opponentHand]);
      if (!winners.includes(mine)) { lost = true; break; }
      if (winners.length > 1) tied = true;
    }
    if (!lost) score += tied ? 0.5 : 1;
  }
  return score / iterations;
}

/**
 * 给出一个动作。legal 来自引擎的 legalActions()，保证返回的动作一定合法。
 * 返回 { action, amount, equity }
 */
function decide({ holeCards, board, opponents, legal, level }) {
  const config = levelConfig(level);
  const equity = estimateEquity(holeCards, board, opponents, config.iterations);
  const toCall = legal.toCall;
  const pot = Math.max(1, legal.pot);
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const bluffing = randomFloat() < config.bluffChance;

  // 无需跟注：按胜率决定过牌还是主动下注。
  if (toCall === 0) {
    const wantsBet = equity >= config.raiseThreshold || bluffing;
    if (wantsBet && legal.canRaise) {
      const sizing = bluffing && equity < config.raiseThreshold ? 0.45 : 0.5 + equity * 0.6 * config.aggression;
      return { action: 'raise', amount: sizeRaise(legal, pot, sizing), equity };
    }
    return { action: 'check', amount: 0, equity };
  }

  // 需要跟注：胜率打不过底池赔率就弃牌，除非这次选择诈唬。
  if (equity + config.callMargin < potOdds && !bluffing) {
    return { action: 'fold', amount: 0, equity };
  }

  if (equity >= config.raiseThreshold && legal.canRaise) {
    const sizing = 0.6 + equity * 0.8 * config.aggression;
    return { action: 'raise', amount: sizeRaise(legal, pot, sizing), equity };
  }

  // 筹码不足以跟注时，引擎会把 call 处理成全下，这里直接走 call 分支。
  return { action: legal.canCall ? 'call' : 'check', amount: 0, equity };
}

/** 把「下注池的多少倍」换算成合法的 raise-to 金额，并夹在最小/最大加注之间。 */
function sizeRaise(legal, pot, potFraction) {
  const target = legal.committed + legal.toCall + Math.round(pot * potFraction);
  const clamped = Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
  return clamped;
}

/** 托管：超时时用机器人替玩家决策，保守一档，避免替人送筹码。 */
function decideForTimeout({ holeCards, board, opponents, legal }) {
  const result = decide({ holeCards, board, opponents, legal, level: 'normal' });
  // 托管不主动加注，只在牌力足够时跟注，否则能过牌就过牌、要钱就弃牌。
  if (result.action === 'raise') return { ...result, action: legal.canCall ? 'call' : 'check', amount: 0 };
  return result;
}

function botDisplayName(index) { return BOT_NAMES[index % BOT_NAMES.length]; }

module.exports = { decide, decideForTimeout, estimateEquity, botDisplayName, BOT_NAMES, LEVELS };
