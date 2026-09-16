'use strict';

/**
 * 德州扑克对战房间（WebSocket，/ws?holdem=1）。
 *
 * 与 Kards 对战桌的最大区别：这里服务端是规则权威方。
 *   1. 牌堆、底牌、下注合法性、边池与摊牌全部由 holdem-engine 在服务端裁定；
 *   2. 每个客户端只收到「自己视角」的状态，别人的底牌在摊牌前永远不下发；
 *   3. 机器人没有 socket，只是座位上的一条记录，由服务端定时驱动；
 *   4. 玩家思考超时后由机器人接管这一次决策，玩家下次行动即收回控制权。
 *
 * 桌上筹码在进程内存里，账户余额在 SQLite：只有「买入上桌」和「离桌」两个时刻互通。
 * 房间状态重启即清空（与其他房间工具一致），因此进程异常退出时进行中的一手会连同桌上筹码一起丢失。
 */

const WebSocket = require('ws');
const engine = require('./holdem-engine');
const bots = require('./holdem-bots');
const holdemStore = require('./holdem-store');
const { HOLDEM_MIN_BUY_IN } = require('./config');

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const THINK_SECONDS = [10, 15, 30, 40];
const BOT_LEVELS = new Set(['easy', 'normal', 'hard']);
const MIN_SEATS = 2;
const MAX_SEATS = 6;
const BOT_ACT_MIN_MS = 900;
const BOT_ACT_MAX_MS = 2100;
const NEXT_HAND_DELAY_MS = 6000;

function createHoldemRoomServer({ auth }) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map();

  function randomRoomId() {
    for (let i = 0; i < 100; i++) {
      const id = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms.has(id)) return id;
    }
    return String(Date.now()).slice(-6);
  }

  function addLog(room, seat, text) {
    room.log = [{ at: Date.now(), seat, text }, ...room.log].slice(0, 60);
  }

  function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ERROR', payload: { message } }));
  }

  function occupiedSeats(room) { return room.seats.filter((seat) => seat.username || seat.isBot); }
  function humanSeats(room) { return room.seats.filter((seat) => seat.username && !seat.isBot); }
  function playableSeats(room) { return occupiedSeats(room).filter((seat) => seat.stack > 0); }

  function seatByUsername(room, username) {
    return room.seats.find((seat) => !seat.isBot && seat.username === username) || null;
  }

  function seatLabel(room, seatIndex) {
    const seat = room.seats[seatIndex];
    if (!seat) return `座位${seatIndex + 1}`;
    return seat.isBot ? seat.botName : (seat.username || `座位${seatIndex + 1}`);
  }

  // ---------- 视图 ----------

  function roomView(room, viewerSeat, viewerUsername) {
    return {
      roomId: room.roomId,
      hostUsername: room.hostUsername,
      isHost: viewerUsername === room.hostUsername,
      phase: room.phase,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      buyIn: room.buyIn,
      thinkSeconds: room.thinkSeconds,
      maxSeats: room.maxSeats,
      seat: viewerSeat,
      buttonSeat: room.buttonSeat,
      handNumber: room.handNumber,
      actionDeadline: room.actionDeadline,
      nextHandAt: room.nextHandAt,
      canStart: room.phase === 'waiting' && playableSeats(room).length >= MIN_SEATS,
      seats: room.seats.map((seat) => ({
        seat: seat.seat,
        username: seat.username,
        isBot: seat.isBot,
        botLevel: seat.botLevel,
        botName: seat.botName,
        displayName: seat.isBot ? seat.botName : seat.username,
        stack: seat.stack,
        connected: seat.connected,
        autoPiloted: seat.autoPiloted,
        empty: !seat.username && !seat.isBot,
      })),
      hand: engine.handView(room.hand, viewerSeat),
      log: room.log,
    };
  }

  function broadcast(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    wss.clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN || client.holdemRoomId !== roomId) return;
      const seat = seatByUsername(room, client.user?.username);
      client.send(JSON.stringify({ type: 'ROOM_STATE', payload: roomView(room, seat ? seat.seat : null, client.user?.username) }));
    });
  }

  // ---------- 计时与机器人驱动 ----------

  function clearTimers(room) {
    if (room.actTimer) { clearTimeout(room.actTimer); room.actTimer = null; }
    if (room.nextHandTimer) { clearTimeout(room.nextHandTimer); room.nextHandTimer = null; }
    room.actionDeadline = null;
  }

  /** 安排当前行动位：机器人短延迟自动出牌，真人则开始思考倒计时。 */
  function scheduleAction(room) {
    if (room.actTimer) { clearTimeout(room.actTimer); room.actTimer = null; }
    room.actionDeadline = null;
    const hand = room.hand;
    if (!hand || hand.complete || hand.actingSeat === null) return;

    const seat = room.seats[hand.actingSeat];
    if (!seat) return;

    // 机器人或掉线的玩家都由机器人驱动，避免桌子卡住。
    const drivenByBot = seat.isBot || !seat.connected;
    if (drivenByBot) {
      const delay = seat.isBot ? BOT_ACT_MIN_MS + Math.floor(Math.random() * (BOT_ACT_MAX_MS - BOT_ACT_MIN_MS)) : 600;
      room.actTimer = setTimeout(() => runAutoAction(room, seat.isBot ? 'bot' : 'offline'), delay);
      return;
    }

    room.actionDeadline = Date.now() + room.thinkSeconds * 1000;
    room.actTimer = setTimeout(() => runAutoAction(room, 'timeout'), room.thinkSeconds * 1000);
  }

  /** 机器人出牌 / 掉线代打 / 超时托管，三种情况共用一条执行路径。 */
  function runAutoAction(room, reason) {
    room.actTimer = null;
    room.actionDeadline = null;
    const hand = room.hand;
    if (!hand || hand.complete || hand.actingSeat === null) return;
    const actingSeat = hand.actingSeat;
    const seat = room.seats[actingSeat];
    const player = hand.players.find((entry) => entry.seat === actingSeat);
    if (!seat || !player) return;

    try {
      const legal = engine.legalActions(hand);
      if (!legal) return;
      const opponents = Math.max(1, engine.activeSeats(hand).length - 1);
      const input = { holeCards: player.holeCards, board: hand.board, opponents, legal };
      const move = reason === 'bot'
        ? bots.decide({ ...input, level: seat.botLevel || 'normal' })
        : bots.decideForTimeout(input);

      if (reason === 'timeout') {
        seat.autoPiloted = true;
        addLog(room, actingSeat, `${seatLabel(room, actingSeat)} 思考超时，由机器人托管本次决策`);
      } else if (reason === 'offline') {
        addLog(room, actingSeat, `${seatLabel(room, actingSeat)} 已掉线，由机器人代打`);
      }
      engine.applyAction(hand, actingSeat, move.action, move.amount);
      afterAction(room);
    } catch (error) {
      console.error('❌ 德州扑克自动决策失败:', error);
      // 兜底：让这一手能继续，不把桌子卡死。
      try {
        const legal = engine.legalActions(hand);
        engine.applyAction(hand, actingSeat, legal && legal.canCheck ? 'check' : 'fold');
        afterAction(room);
      } catch (fallbackError) {
        console.error('❌ 德州扑克兜底动作也失败:', fallbackError);
      }
    }
  }

  /** 每次动作之后：同步筹码、决定继续行动还是收官，然后广播。 */
  function afterAction(room) {
    room.lastActivity = Date.now();
    syncStacks(room);
    if (room.hand && room.hand.complete) {
      void completeHand(room);
      return;
    }
    scheduleAction(room);
    broadcast(room.roomId);
  }

  function syncStacks(room) {
    if (!room.hand) return;
    for (const player of room.hand.players) {
      const seat = room.seats[player.seat];
      if (seat) seat.stack = player.stack;
    }
  }

  // ---------- 一手牌的开始与结束 ----------

  function startHand(room) {
    clearTimers(room);
    const eligible = playableSeats(room);
    if (eligible.length < MIN_SEATS) {
      room.phase = 'waiting';
      room.hand = null;
      addLog(room, null, '有筹码的玩家不足两人，牌局暂停，回到等待中');
      broadcast(room.roomId);
      return;
    }

    for (const seat of room.seats) seat.autoPiloted = false;
    room.handNumber += 1;
    room.phase = 'playing';
    room.nextHandAt = null;
    room.hand = engine.startHand({
      seats: eligible.map((seat) => ({ seat: seat.seat, username: seat.isBot ? seat.botName : seat.username, stack: seat.stack, isBot: seat.isBot, botLevel: seat.botLevel })),
      buttonSeat: room.buttonSeat,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      handNumber: room.handNumber,
    });
    room.buttonSeat = room.hand.buttonSeat;
    syncStacks(room);
    scheduleAction(room);
    broadcast(room.roomId);
  }

  /** 一手结束：记录统计、播报结果，并安排下一手。 */
  async function completeHand(room) {
    clearTimers(room);
    const hand = room.hand;
    if (!hand || !hand.results) return;

    const winners = new Set(hand.results.winners);
    for (const entry of hand.results.payouts) {
      if (entry.amount > 0) addLog(room, entry.seat, `${seatLabel(room, entry.seat)} 赢得 ${entry.amount}`);
    }

    // 真人玩家累计一手统计；余额本身不动，等离桌时一次性回账。
    for (const seat of humanSeats(room)) {
      if (!hand.players.some((player) => player.seat === seat.seat)) continue;
      try { await holdemStore.recordHandResult(seat.username, winners.has(seat.seat), room.roomId); }
      catch (error) { console.error('❌ 德州扑克手牌统计写入失败:', error); }
    }

    if (!rooms.has(room.roomId)) return;
    const remaining = playableSeats(room);
    if (remaining.length < MIN_SEATS) {
      room.phase = 'waiting';
      addLog(room, null, '桌上有筹码的玩家不足两人，房主可以补充机器人或重新买入后继续');
      broadcast(room.roomId);
      return;
    }

    room.nextHandAt = Date.now() + NEXT_HAND_DELAY_MS;
    room.nextHandTimer = setTimeout(() => {
      room.nextHandTimer = null;
      if (rooms.has(room.roomId)) startHand(room);
    }, NEXT_HAND_DELAY_MS);
    broadcast(room.roomId);
  }

  // ---------- 房间生命周期 ----------

  function makeSeats(maxSeats) {
    return Array.from({ length: maxSeats }, (_, index) => ({
      seat: index, username: null, isBot: false, botLevel: null, botName: null,
      stack: 0, connected: false, autoPiloted: false,
    }));
  }

  function normalizeConfig(payload) {
    const smallBlind = Math.trunc(Number(payload.smallBlind));
    const bigBlind = Math.trunc(Number(payload.bigBlind));
    const buyIn = Math.trunc(Number(payload.buyIn));
    const thinkSeconds = Math.trunc(Number(payload.thinkSeconds));
    const maxSeats = Math.trunc(Number(payload.maxSeats));
    if (!Number.isFinite(smallBlind) || smallBlind < 1 || smallBlind > 100000) throw new Error('小盲注需在 1–100000 之间。');
    if (!Number.isFinite(bigBlind) || bigBlind <= smallBlind || bigBlind > 200000) throw new Error('大盲注必须大于小盲注。');
    if (!Number.isFinite(buyIn) || buyIn < Math.max(HOLDEM_MIN_BUY_IN, bigBlind * 2) || buyIn > 10000000) throw new Error(`买入至少为 ${Math.max(HOLDEM_MIN_BUY_IN, bigBlind * 2)} 筹码。`);
    if (!THINK_SECONDS.includes(thinkSeconds)) throw new Error('思考时长只能是 10、15、30 或 40 秒。');
    if (!Number.isFinite(maxSeats) || maxSeats < MIN_SEATS || maxSeats > MAX_SEATS) throw new Error(`座位数需在 ${MIN_SEATS}–${MAX_SEATS} 之间。`);
    return { smallBlind, bigBlind, buyIn, thinkSeconds, maxSeats };
  }

  /** 关闭房间：把桌上剩余筹码退回每个真人账户，再断开所有连接。 */
  async function closeRoom(roomId, reason = '房间已关闭') {
    const room = rooms.get(roomId);
    if (!room) return;
    clearTimers(room);
    rooms.delete(roomId);

    for (const seat of humanSeats(room)) {
      if (seat.stack <= 0) continue;
      try { await holdemStore.cashOut(seat.username, seat.stack, roomId); }
      catch (error) { console.error('❌ 德州扑克离桌结算失败:', error); }
    }

    wss.clients.forEach((client) => {
      if (client.holdemRoomId !== roomId) return;
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'ROOM_CLOSED', payload: { roomId, reason } }));
        client.close(1000, 'Room closed');
      }
      client.holdemRoomId = null;
    });
  }

  /** 玩家主动离桌：退回其桌上筹码，空出座位；房主离桌直接解散房间。 */
  async function leaveRoom(ws) {
    const roomId = ws.holdemRoomId;
    if (!roomId || !rooms.has(roomId)) { ws.holdemRoomId = null; return; }
    const room = rooms.get(roomId);
    const username = ws.user?.username;
    ws.holdemRoomId = null;

    if (username === room.hostUsername) { await closeRoom(roomId, '房主已解散房间'); return; }
    const seat = seatByUsername(room, username);
    if (!seat) return;

    const refund = seat.stack;
    seat.username = null; seat.stack = 0; seat.connected = false; seat.autoPiloted = false;
    if (refund > 0) {
      try { await holdemStore.cashOut(username, refund, roomId); }
      catch (error) { console.error('❌ 德州扑克离桌结算失败:', error); }
    }
    addLog(room, seat.seat, `${username} 离开了牌桌，带走 ${refund} 筹码`);
    room.lastActivity = Date.now();

    // 离桌的人正好在行动轮：让引擎按弃牌继续，不要卡住其他人。
    if (room.hand && !room.hand.complete && room.hand.actingSeat === seat.seat) {
      try { engine.applyAction(room.hand, seat.seat, 'fold'); afterAction(room); return; }
      catch (error) { console.error('❌ 离桌自动弃牌失败:', error); }
    }
    if (room.hand && !room.hand.complete) {
      const player = room.hand.players.find((entry) => entry.seat === seat.seat);
      if (player) player.inHand = false;
    }
    broadcast(roomId);
  }

  // ---------- 消息处理 ----------

  async function handleMessage(ws, message) {
    const { type, payload = {} } = message;
    const username = ws.user?.username;

    if (type === 'PING') {
      if (ws.holdemRoomId && rooms.has(ws.holdemRoomId)) rooms.get(ws.holdemRoomId).lastActivity = Date.now();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PONG' }));
      return;
    }

    if (type === 'CREATE_ROOM') {
      const config = normalizeConfig(payload);
      await holdemStore.reserveBuyIn(username, config.buyIn, 'pending');
      const roomId = randomRoomId();
      const room = {
        roomId,
        hostUsername: username,
        ...config,
        phase: 'waiting',
        seats: makeSeats(config.maxSeats),
        hand: null,
        buttonSeat: -1,
        handNumber: 0,
        log: [],
        actTimer: null,
        nextHandTimer: null,
        actionDeadline: null,
        nextHandAt: null,
        botCounter: 0,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      room.seats[0].username = username;
      room.seats[0].stack = config.buyIn;
      room.seats[0].connected = true;
      rooms.set(roomId, room);
      ws.holdemRoomId = roomId;
      addLog(room, 0, `${username} 创建了牌桌（盲注 ${config.smallBlind}/${config.bigBlind}，买入 ${config.buyIn}，思考 ${config.thinkSeconds} 秒）`);
      console.log(`🃏 德州扑克房间创建: ${roomId}（房主 ${username}）`);
      broadcast(roomId);
      return;
    }

    if (type === 'JOIN_ROOM') {
      const roomId = String(payload.roomId || '');
      if (!/^\d{6}$/.test(roomId)) throw new Error('房间号无效。');
      const room = rooms.get(roomId);
      if (!room) throw new Error('房间不存在，请检查房间号。');

      const existing = seatByUsername(room, username);
      if (existing) {
        // 断线重连：座位与桌上筹码原样保留。
        existing.connected = true;
        ws.holdemRoomId = roomId;
        room.lastActivity = Date.now();
        addLog(room, existing.seat, `${username} 重新连接`);
        broadcast(roomId);
        if (room.hand && !room.hand.complete && room.hand.actingSeat === existing.seat) scheduleAction(room);
        return;
      }

      const free = room.seats.find((seat) => !seat.username && !seat.isBot);
      if (!free) throw new Error('牌桌已满。');
      await holdemStore.reserveBuyIn(username, room.buyIn, roomId);
      free.username = username;
      free.stack = room.buyIn;
      free.connected = true;
      ws.holdemRoomId = roomId;
      room.lastActivity = Date.now();
      addLog(room, free.seat, `${username} 带着 ${room.buyIn} 筹码入座`);
      broadcast(roomId);
      return;
    }

    // 以下操作都要求已经在房间里。
    const roomId = ws.holdemRoomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) throw new Error('请先创建或加入房间。');
    const mySeat = seatByUsername(room, username);
    const isHost = username === room.hostUsername;

    switch (type) {
      case 'ADD_BOT': {
        if (!isHost) throw new Error('只有房主可以添加机器人。');
        if (room.phase === 'playing') throw new Error('牌局进行中不能添加机器人，请等这一手结束。');
        const level = String(payload.level || 'normal');
        if (!BOT_LEVELS.has(level)) throw new Error('机器人难度无效。');
        const free = room.seats.find((seat) => !seat.username && !seat.isBot);
        if (!free) throw new Error('没有空座位了。');
        free.isBot = true;
        free.botLevel = level;
        free.botName = bots.botDisplayName(room.botCounter++);
        free.stack = room.buyIn;
        free.connected = true;
        addLog(room, free.seat, `房主请来了机器人 ${free.botName}（${level}）`);
        room.lastActivity = Date.now();
        broadcast(roomId);
        return;
      }

      case 'REMOVE_BOT': {
        if (!isHost) throw new Error('只有房主可以移除机器人。');
        if (room.phase === 'playing') throw new Error('牌局进行中不能移除机器人。');
        const target = room.seats[Math.trunc(Number(payload.seat))];
        if (!target || !target.isBot) throw new Error('该座位上没有机器人。');
        addLog(room, target.seat, `机器人 ${target.botName} 离开了牌桌`);
        target.isBot = false; target.botLevel = null; target.botName = null; target.stack = 0; target.connected = false;
        room.lastActivity = Date.now();
        broadcast(roomId);
        return;
      }

      case 'START_GAME': {
        if (!isHost) throw new Error('只有房主可以开始牌局。');
        if (room.phase === 'playing') throw new Error('牌局已经在进行中。');
        if (playableSeats(room).length < MIN_SEATS) throw new Error('至少需要两位有筹码的玩家。');
        addLog(room, null, '房主开始了牌局');
        startHand(room);
        return;
      }

      case 'ACTION': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        if (!room.hand || room.hand.complete) throw new Error('现在没有进行中的牌局。');
        if (room.hand.actingSeat !== mySeat.seat) throw new Error('现在不是你的行动轮。');
        const action = String(payload.action || '');
        engine.applyAction(room.hand, mySeat.seat, action, payload.amount);
        mySeat.autoPiloted = false; // 玩家自己行动后收回控制权
        afterAction(room);
        return;
      }

      case 'REBUY': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        if (mySeat.stack > 0) throw new Error('桌上还有筹码，暂不需要重新买入。');
        if (room.hand && !room.hand.complete && room.hand.players.some((player) => player.seat === mySeat.seat && player.inHand)) {
          throw new Error('这一手还没结束，无法重新买入。');
        }
        await holdemStore.reserveBuyIn(username, room.buyIn, roomId);
        mySeat.stack = room.buyIn;
        addLog(room, mySeat.seat, `${username} 重新买入 ${room.buyIn} 筹码`);
        room.lastActivity = Date.now();
        if (room.phase === 'waiting' && playableSeats(room).length >= MIN_SEATS) addLog(room, null, '人数已够，房主可以继续开局');
        broadcast(roomId);
        return;
      }

      case 'LEAVE_ROOM': {
        await leaveRoom(ws);
        return;
      }

      case 'DELETE_ROOM': {
        if (!isHost) throw new Error('只有房主可以解散房间。');
        await closeRoom(roomId, '房主已解散房间');
        return;
      }

      default:
        throw new Error(`未知操作：${type}`);
    }
  }

  wss.on('connection', (ws) => {
    ws.holdemRoomId = null;

    ws.on('message', (data) => {
      void (async () => {
        let message;
        try { message = JSON.parse(data.toString()); }
        catch { sendError(ws, '消息格式无效。'); return; }

        if (!ws.user || !auth.hasToolAccess(ws.user, 'texas-holdem')) {
          sendError(ws, '当前账户没有德州扑克权限。');
          ws.close(1008, 'Unauthorized');
          return;
        }

        try { await handleMessage(ws, message); }
        catch (error) {
          if (error instanceof holdemStore.HoldemStoreError) return sendError(ws, error.message);
          sendError(ws, error?.message || '服务器错误');
        }
      })().catch((error) => {
        console.error('❌ 德州扑克消息处理错误:', error);
        sendError(ws, '服务器错误');
      });
    });

    ws.on('close', () => {
      const roomId = ws.holdemRoomId;
      ws.holdemRoomId = null;
      if (!roomId || !rooms.has(roomId)) return;
      const room = rooms.get(roomId);
      const seat = seatByUsername(room, ws.user?.username);
      if (!seat) return;
      // 掉线不清座位、不退筹码，等重连；正在行动就交给机器人代打。
      seat.connected = false;
      room.lastActivity = Date.now();
      addLog(room, seat.seat, `${seat.username} 断开连接`);
      if (room.hand && !room.hand.complete && room.hand.actingSeat === seat.seat) scheduleAction(room);
      broadcast(roomId);
    });
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        console.log(`🧹 回收闲置德州扑克房间: ${roomId}`);
        void closeRoom(roomId, '房间长时间无人操作已关闭').catch((error) => console.error('❌ 回收房间失败:', error));
      }
    }
  }, 60 * 1000);

  /** 大厅列表：只暴露公共信息，不含任何手牌。 */
  function lobbyList() {
    return [...rooms.values()].map((room) => ({
      roomId: room.roomId,
      hostUsername: room.hostUsername,
      phase: room.phase,
      smallBlind: room.smallBlind,
      bigBlind: room.bigBlind,
      buyIn: room.buyIn,
      thinkSeconds: room.thinkSeconds,
      maxSeats: room.maxSeats,
      seatedCount: occupiedSeats(room).length,
      humanCount: humanSeats(room).length,
      handNumber: room.handNumber,
      lastActivity: room.lastActivity,
    })).sort((left, right) => right.lastActivity - left.lastActivity);
  }

  return { wss, rooms, cleanupTimer, closeRoom, lobbyList, THINK_SECONDS, MIN_SEATS, MAX_SEATS };
}

module.exports = { createHoldemRoomServer, THINK_SECONDS, MIN_SEATS, MAX_SEATS };
