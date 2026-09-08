'use strict';

/**
 * 无限注德州扑克规则引擎：服务端权威，纯函数式状态推进。
 *
 * 这里只处理「牌」和「钱」的规则，不涉及 WebSocket、账户或界面：
 *   1. 洗牌发牌用 crypto.randomInt 做无偏 Fisher-Yates，牌堆永不离开服务端；
 *   2. 下注轮完整实现过牌/跟注/加注/全下、最小加注额、以及全下不足一个加注时的封顶规则；
 *   3. 摊牌用 pokersolver 判定牌型，并按每个玩家的实际投入切分主池与边池。
 *
 * 状态机：waiting → preflop → flop → turn → river → showdown → complete
 */

const crypto = require('crypto');
const { Hand } = require('pokersolver');

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const BOARD_SIZE = { preflop: 0, flop: 3, turn: 4, river: 5 };

function buildDeck() {
  const deck = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push(`${rank}${suit}`);
  return deck;
}

/** 无偏洗牌：用 crypto.randomInt 而不是 Math.random，避免可预测的牌序。 */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function activeSeats(hand) {
  return hand.players.filter((player) => player.inHand);
}

/** 还能继续行动的玩家：没弃牌且没全下。 */
function actionableSeats(hand) {
  return hand.players.filter((player) => player.inHand && !player.allIn && player.stack > 0);
}

function nextOccupiedSeat(hand, fromSeat) {
  const total = hand.players.length;
  for (let step = 1; step <= total; step++) {
    const candidate = hand.players[(fromSeat + step) % total];
    if (candidate.inHand && !candidate.allIn && candidate.stack > 0) return candidate.seat;
  }
  return null;
}

function nextSeatInHand(hand, fromSeat) {
  const total = hand.players.length;
  for (let step = 1; step <= total; step++) {
    const candidate = hand.players[(fromSeat + step) % total];
    if (candidate.inHand) return candidate.seat;
  }
  return null;
}

function highestCommitted(hand) {
  return hand.players.reduce((max, player) => Math.max(max, player.committed), 0);
}

/**
 * 开一手新牌：转移按钮位、收盲注、发底牌，并决定首个行动位。
 * seats 是本手参与的玩家（stack > 0），buttonSeat 为上一手的按钮位。
 */
function startHand({ seats, buttonSeat, smallBlind, bigBlind, handNumber }) {
  const eligible = seats.filter((seat) => seat.stack > 0);
  if (eligible.length < 2) throw new Error('至少需要两名有筹码的玩家才能开始。');

  const deck = shuffle(buildDeck());
  const players = eligible.map((seat) => ({
    seat: seat.seat,
    username: seat.username,
    isBot: Boolean(seat.isBot),
    botLevel: seat.botLevel || null,
    stack: seat.stack,
    holeCards: [deck.pop(), deck.pop()],
    committed: 0,      // 本轮下注额
    totalCommitted: 0, // 本手累计投入，用于切边池
    inHand: true,
    allIn: false,
    hasActed: false,
    lastAction: null,
  }));

  const hand = {
    handNumber,
    players,
    deck,
    board: [],
    street: 'preflop',
    pot: 0,
    smallBlind,
    bigBlind,
    minRaise: bigBlind,
    currentBet: 0,
    buttonSeat: null,
    actingSeat: null,
    lastAggressorSeat: null,
    log: [],
    results: null,
    complete: false,
  };

  // 按钮位后移到下一位在座玩家。
  const order = players.map((player) => player.seat);
  const buttonIndex = order.findIndex((seat) => seat > buttonSeat);
  hand.buttonSeat = buttonIndex === -1 ? order[0] : order[buttonIndex];

  // 单挑时按钮位就是小盲；三人及以上按钮位后两位分别是小盲、大盲。
  const heads = players.length === 2;
  const smallBlindSeat = heads ? hand.buttonSeat : nextSeatInHand(hand, hand.buttonSeat);
  const bigBlindSeat = nextSeatInHand(hand, smallBlindSeat);

  postBlind(hand, smallBlindSeat, smallBlind, '小盲');
  postBlind(hand, bigBlindSeat, bigBlind, '大盲');
  hand.currentBet = highestCommitted(hand);
  hand.minRaise = bigBlind;
  hand.bigBlindSeat = bigBlindSeat;

  // 翻牌前由大盲下一位先说话；单挑时是按钮位（小盲）。
  hand.actingSeat = nextOccupiedSeat(hand, bigBlindSeat);
  hand.lastAggressorSeat = bigBlindSeat;
  addLog(hand, null, `第 ${handNumber} 手开始，盲注 ${smallBlind}/${bigBlind}`);
  return hand;
}

function postBlind(hand, seat, amount, label) {
  const player = hand.players.find((entry) => entry.seat === seat);
  if (!player) return;
  const paid = Math.min(amount, player.stack);
  player.stack -= paid;
  player.committed += paid;
  player.totalCommitted += paid;
  hand.pot += paid;
  if (player.stack === 0) player.allIn = true;
  addLog(hand, seat, `${label} ${paid}`);
}

function addLog(hand, seat, text) {
  hand.log = [{ at: Date.now(), seat, text }, ...hand.log].slice(0, 60);
}

/** 当前行动玩家可选的动作与合法金额区间，供界面和机器人共用。 */
function legalActions(hand) {
  const player = hand.players.find((entry) => entry.seat === hand.actingSeat);
  if (!player || hand.complete) return null;
  const toCall = Math.max(0, hand.currentBet - player.committed);
  const canCheck = toCall === 0;
  // 加注到的最小总额：当前注 + 最小加注幅度；筹码不够时只能全下。
  const minRaiseTo = hand.currentBet + hand.minRaise;
  const maxRaiseTo = player.committed + player.stack;
  return {
    seat: player.seat,
    toCall: Math.min(toCall, player.stack),
    canCheck,
    canCall: toCall > 0 && player.stack > 0,
    canFold: true,
    canRaise: player.stack > toCall,
    minRaiseTo: Math.min(minRaiseTo, maxRaiseTo),
    maxRaiseTo,
    isAllInOnly: player.stack <= toCall || maxRaiseTo < minRaiseTo,
    pot: hand.pot,
    stack: player.stack,
    committed: player.committed,
  };
}

/**
 * 执行一个动作。action: 'fold' | 'check' | 'call' | 'raise' | 'allin'
 * raise 时 amount 表示「加注到的本轮总额」（raise-to 语义）。
 */
function applyAction(hand, seat, action, amount) {
  if (hand.complete) throw new Error('这一手已经结束。');
  if (hand.actingSeat !== seat) throw new Error('现在不是你的行动轮。');
  const player = hand.players.find((entry) => entry.seat === seat);
  if (!player || !player.inHand) throw new Error('你已经不在这一手牌里。');

  const options = legalActions(hand);
  const toCall = options.toCall;

  switch (action) {
    case 'fold': {
      player.inHand = false;
      player.hasActed = true;
      player.lastAction = 'fold';
      addLog(hand, seat, '弃牌');
      break;
    }
    case 'check': {
      if (!options.canCheck) throw new Error('当前有下注，不能过牌。');
      player.hasActed = true;
      player.lastAction = 'check';
      addLog(hand, seat, '过牌');
      break;
    }
    case 'call': {
      if (toCall <= 0) throw new Error('没有需要跟的注，请选择过牌。');
      commit(hand, player, toCall);
      player.hasActed = true;
      player.lastAction = 'call';
      addLog(hand, seat, player.allIn ? `跟注全下 ${toCall}` : `跟注 ${toCall}`);
      break;
    }
    case 'allin': {
      const all = player.stack;
      if (all <= 0) throw new Error('没有可下的筹码。');
      const raiseTo = player.committed + all;
      const isRaise = raiseTo > hand.currentBet;
      commit(hand, player, all);
      player.hasActed = true;
      player.lastAction = 'allin';
      if (isRaise) {
        // 全下额超过当前注时才重开下注轮；不足一个最小加注也照样是新的最高注。
        hand.minRaise = Math.max(hand.minRaise, raiseTo - hand.currentBet);
        hand.currentBet = raiseTo;
        hand.lastAggressorSeat = seat;
        resetActedExcept(hand, seat);
      }
      addLog(hand, seat, `全下 ${all}`);
      break;
    }
    case 'raise': {
      const raiseTo = Math.trunc(Number(amount));
      if (!Number.isFinite(raiseTo)) throw new Error('加注金额无效。');
      if (!options.canRaise) throw new Error('筹码不足，无法加注。');
      if (raiseTo > options.maxRaiseTo) throw new Error('加注金额超过你的筹码。');
      if (raiseTo < options.minRaiseTo) throw new Error(`最少需要加注到 ${options.minRaiseTo}。`);
      const delta = raiseTo - player.committed;
      commit(hand, player, delta);
      hand.minRaise = raiseTo - hand.currentBet;
      hand.currentBet = raiseTo;
      hand.lastAggressorSeat = seat;
      resetActedExcept(hand, seat);
      player.hasActed = true;
      player.lastAction = player.allIn ? 'allin' : 'raise';
      addLog(hand, seat, player.allIn ? `加注到 ${raiseTo} 并全下` : `加注到 ${raiseTo}`);
      break;
    }
    default:
      throw new Error(`未知动作：${action}`);
  }

  advance(hand);
  return hand;
}

function commit(hand, player, amount) {
  const paid = Math.min(Math.max(0, amount), player.stack);
  player.stack -= paid;
  player.committed += paid;
  player.totalCommitted += paid;
  hand.pot += paid;
  if (player.stack === 0) player.allIn = true;
}

function resetActedExcept(hand, seat) {
  for (const player of hand.players) {
    if (player.seat !== seat && player.inHand && !player.allIn) player.hasActed = false;
  }
}

/** 本轮是否结束：所有还能行动的玩家都已行动且注额一致。 */
function bettingRoundComplete(hand) {
  const actionable = actionableSeats(hand);
  if (actionable.length === 0) return true;
  return actionable.every((player) => player.hasActed && player.committed === hand.currentBet);
}

function advance(hand) {
  // 只剩一人未弃牌：直接收池，不进入摊牌。
  if (activeSeats(hand).length === 1) return finish(hand, false);

  if (!bettingRoundComplete(hand)) {
    const next = nextOccupiedSeat(hand, hand.actingSeat);
    // 找不到下一个可行动的人（其余都全下），直接推进街道。
    if (next === null) return nextStreet(hand);
    hand.actingSeat = next;
    return hand;
  }
  return nextStreet(hand);
}

function nextStreet(hand) {
  for (const player of hand.players) { player.committed = 0; player.hasActed = false; }
  hand.currentBet = 0;
  hand.minRaise = hand.bigBlind;

  const index = STREETS.indexOf(hand.street);
  if (index === STREETS.length - 1) return finish(hand, true);

  hand.street = STREETS[index + 1];
  dealBoard(hand);
  addLog(hand, null, `${{ flop: '翻牌', turn: '转牌', river: '河牌' }[hand.street]}：${hand.board.join(' ')}`);

  // 没人还能行动（都全下）就继续发下一条街，直到摊牌。
  if (actionableSeats(hand).length < 2) {
    hand.actingSeat = null;
    return nextStreet(hand);
  }
  // 翻牌后从小盲方向第一个可行动的玩家开始。
  hand.actingSeat = nextOccupiedSeat(hand, hand.buttonSeat);
  hand.lastAggressorSeat = null;
  return hand;
}

function dealBoard(hand) {
  const target = BOARD_SIZE[hand.street];
  hand.deck.pop(); // 烧牌，与真实发牌流程一致
  while (hand.board.length < target) hand.board.push(hand.deck.pop());
}

/** 结算：按每人实际投入切分主池/边池，逐池比牌分钱。 */
function finish(hand, showdown) {
  hand.actingSeat = null;
  hand.complete = true;
  hand.street = showdown ? 'showdown' : hand.street;

  const contenders = activeSeats(hand);
  const payouts = new Map(hand.players.map((player) => [player.seat, 0]));
  const shownHands = [];

  if (!showdown || contenders.length === 1) {
    const winner = contenders[0];
    payouts.set(winner.seat, hand.pot);
    addLog(hand, winner.seat, `其他人全部弃牌，赢得底池 ${hand.pot}`);
  } else {
    const solved = new Map();
    for (const player of contenders) {
      const solution = Hand.solve([...player.holeCards, ...hand.board]);
      solved.set(player.seat, solution);
      shownHands.push({ seat: player.seat, holeCards: player.holeCards, description: solution.descr, name: solution.name });
    }

    // 按投入额分层，每层构成一个池，只有投入达到该层的人有资格争夺。
    const levels = [...new Set(hand.players.filter((p) => p.totalCommitted > 0).map((p) => p.totalCommitted))].sort((a, b) => a - b);
    let previous = 0;
    for (const level of levels) {
      const slice = level - previous;
      const participants = hand.players.filter((player) => player.totalCommitted >= level);
      const potAmount = slice * participants.length;
      if (potAmount <= 0) { previous = level; continue; }
      const eligible = participants.filter((player) => player.inHand);
      if (eligible.length === 0) { previous = level; continue; }
      const best = Hand.winners(eligible.map((player) => solved.get(player.seat)));
      const winnerSeats = eligible.filter((player) => best.includes(solved.get(player.seat))).map((player) => player.seat);
      const share = Math.floor(potAmount / winnerSeats.length);
      let remainder = potAmount - share * winnerSeats.length;
      for (const seat of winnerSeats) {
        // 无法整除的零头按座位顺序发给靠前的赢家，保证总额守恒。
        const extra = remainder > 0 ? 1 : 0;
        remainder -= extra;
        payouts.set(seat, payouts.get(seat) + share + extra);
      }
      previous = level;
    }
    for (const entry of shownHands) addLog(hand, entry.seat, `摊牌：${entry.description}`);
  }

  for (const player of hand.players) {
    const won = payouts.get(player.seat) || 0;
    player.stack += won;
  }

  hand.results = {
    payouts: [...payouts.entries()].map(([seat, amount]) => ({ seat, amount })),
    shownHands,
    pot: hand.pot,
    winners: [...payouts.entries()].filter(([, amount]) => amount > 0).map(([seat]) => seat),
  };
  return hand;
}

/** 给指定座位的可见视图：别人的底牌一律不下发，只在摊牌后公开参与摊牌者的牌。 */
function handView(hand, viewerSeat) {
  if (!hand) return null;
  const revealed = hand.complete && hand.results ? new Map(hand.results.shownHands.map((entry) => [entry.seat, entry])) : new Map();
  return {
    handNumber: hand.handNumber,
    street: hand.street,
    board: hand.board,
    pot: hand.pot,
    currentBet: hand.currentBet,
    minRaise: hand.minRaise,
    buttonSeat: hand.buttonSeat,
    actingSeat: hand.actingSeat,
    smallBlind: hand.smallBlind,
    bigBlind: hand.bigBlind,
    complete: hand.complete,
    results: hand.results,
    log: hand.log,
    players: hand.players.map((player) => ({
      seat: player.seat,
      username: player.username,
      isBot: player.isBot,
      botLevel: player.botLevel,
      stack: player.stack,
      committed: player.committed,
      totalCommitted: player.totalCommitted,
      inHand: player.inHand,
      allIn: player.allIn,
      lastAction: player.lastAction,
      holeCards: player.seat === viewerSeat ? player.holeCards : (revealed.get(player.seat)?.holeCards || null),
      handDescription: revealed.get(player.seat)?.description || null,
    })),
    legal: hand.actingSeat === viewerSeat ? legalActions(hand) : null,
  };
}

/** 描述任意 5–7 张牌的最佳牌型，界面用来提示"你当前是什么牌"。 */
function describeHand(cards) {
  if (!Array.isArray(cards) || cards.length < 5) return null;
  try { return Hand.solve(cards).descr; } catch { return null; }
}

module.exports = { buildDeck, shuffle, startHand, applyAction, legalActions, handView, describeHand, activeSeats, actionableSeats, STREETS };
