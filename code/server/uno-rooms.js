'use strict';

/**
 * UNO 对战房间（WebSocket，/ws?uno=1）。
 *
 * 与德州扑克同一套思路：服务端是规则权威，客户端只发意图，每个连接只收到「自己视角」的快照。
 *   1. 房间住在进程内存里，服务重启即清空（与其他房间类工具一致）；
 *   2. 6 位房间号，任何人都能建房；大厅列表由 HTTP /api/uno/rooms 提供；
 *   3. 座位归账户所有：掉线、思考超时、主动点托管都只是把「这一回合之后的操作」交给机器人，
 *      玩家回来（刷新后重新加入同一房间）即可顶替回座位，手牌与进度原样保留；
 *   4. 三种闲置回收：等待中一直没人进入（默认 30 分钟）、对局中长时间没人操作（默认 15 分钟）、
 *      全员掉线（默认 5 分钟）。阈值可用环境变量调小，方便冒烟测试验证。
 *
 * 客户端消息：
 *   PING / CREATE_ROOM / JOIN_ROOM / LEAVE_ROOM / DELETE_ROOM / UPDATE_SETTINGS
 *   ADD_BOT / REMOVE_BOT / START_GAME / REMATCH
 *   PLAY_CARD / DRAW_CARD / PASS / CHOOSE_COLOR / CALL_UNO / CHALLENGE_UNO / SET_AUTO_PILOT
 * 服务端消息：
 *   ROOM_STATE（自己视角的快照 + 本次新增的事件）/ ROOM_CLOSED / ERROR / PONG
 */

const fs = require('fs');
const WebSocket = require('ws');
const engine = require('./uno-engine');
const bots = require('./uno-bots');
const { UNO_ROOM_TTLS, UNO_CATALOG_FILE } = require('./config');

const MIN_SEATS = 2;
const MAX_SEATS = 4;
// 思考时间档位；0 表示不限时（这一档不会发生超时托管）。
const THINK_SECONDS = [10, 20, 30, 0];
const BOT_ACT_MIN_MS = 900;
const BOT_ACT_MAX_MS = 2000;
const AUTO_PILOT_DELAY_MS = 700;
const BOT_NAMES = ['阿尔法', '小北', '阿豆', '糖豆', '大熊', '闪电', '蜗牛', '火苗'];

// 牌组目录（base.json）只读一次：改内容后重启服务即生效（与其他 content 数据一致）。
let cachedCatalog = null;
function loadBaseCatalog() {
  if (!cachedCatalog) cachedCatalog = JSON.parse(fs.readFileSync(UNO_CATALOG_FILE, 'utf8'));
  return cachedCatalog;
}

function createUnoRoomServer({ auth, ttls = UNO_ROOM_TTLS, catalog = null } = {}) {
  const base = catalog || loadBaseCatalog();
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
  const rooms = new Map();
  let botCounter = 0;

  const now = () => Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function randomRoomId() {
    for (let i = 0; i < 200; i++) {
      const id = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms.has(id)) return id;
    }
    return String(now()).slice(-6);
  }

  function send(ws, type, payload) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, payload }));
  }

  function sendError(ws, message) {
    send(ws, 'ERROR', { message });
  }

  function addLog(room, seat, text) {
    room.log = [{ at: now(), seat, text }, ...room.log].slice(0, 80);
  }

  // ---------- 座位 ----------

  function makeSeats(count) {
    return Array.from({ length: count }, (_, seat) => ({
      seat,
      username: null,
      isBot: false,
      botLevel: null,
      botName: null,
      joinedAt: 0,
      connected: false,
      autoPiloted: false,
      temporaryBot: false,
    }));
  }

  function humanSeats(room) {
    return room.seats.filter((seat) => seat.username && !seat.isBot);
  }

  function occupiedSeats(room) {
    return room.seats.filter((seat) => seat.username || seat.isBot);
  }

  function connectedHumans(room) {
    return humanSeats(room).filter((seat) => seat.connected);
  }

  function seatByUsername(room, username) {
    return room.seats.find((seat) => !seat.isBot && seat.username === username) || null;
  }

  function seatLabel(room, seatIndex) {
    const seat = room.seats[seatIndex];
    if (!seat) return `座位${seatIndex + 1}`;
    if (seat.isBot) return seat.botName || '机器人';
    return seat.username || `座位${seatIndex + 1}`;
  }

  function roomRules(room) {
    return { ...engine.DEFAULT_RULES, ...room.settings.rules };
  }

  /** 建房 / 改设置时的参数校验（外部输入一律当作不可信）。 */
  function normalizeSettings(payload, current = {}) {
    const seats = Math.trunc(Number(payload.seats ?? current.seats ?? MAX_SEATS));
    if (!Number.isFinite(seats) || seats < MIN_SEATS || seats > MAX_SEATS) throw new Error(`座位数需在 ${MIN_SEATS}–${MAX_SEATS} 之间。`);
    const thinkSeconds = Math.trunc(Number(payload.thinkSeconds ?? current.thinkSeconds ?? 20));
    if (!THINK_SECONDS.includes(thinkSeconds)) throw new Error('思考时间只能是 10、20、30 秒或不限时。');

    const rules = { ...engine.DEFAULT_RULES, ...(current.rules || {}) };
    const incoming = payload.rules;
    if (incoming !== undefined) {
      if (!incoming || typeof incoming !== 'object') throw new Error('房规参数无效。');
      for (const rule of base.houseRules || []) {
        if (incoming[rule.id] === undefined) continue;
        if (rule.type === 'boolean') rules[rule.id] = Boolean(incoming[rule.id]);
        else if (rule.type === 'number') {
          const value = Number(incoming[rule.id]);
          if (!Number.isFinite(value)) throw new Error(`房规「${rule.name}」需要数字。`);
          rules[rule.id] = Math.min(Math.max(value, rule.min ?? 0), rule.max ?? 99);
        } else if (rule.type === 'select') {
          if (!(rule.options || []).includes(incoming[rule.id])) throw new Error(`房规「${rule.name}」取值不在可选范围内。`);
          rules[rule.id] = incoming[rule.id];
        }
      }
    }

    // 拓展包：Step 7 才会真正加载，这里只保留 id 列表，避免出现「声称启用但没生效」。
    const expansions = Array.isArray(payload.expansions) ? payload.expansions.map((id) => String(id).slice(0, 40)).slice(0, 12) : (current.expansions || []);

    return { seats, thinkSeconds, rules, expansions };
  }

  // ---------- 视图与广播 ----------

  /** 自己视角的快照：别人的手牌只有张数，牌堆只有数量（都由引擎保证）。 */
  function roomView(room, viewerSeat, viewerUsername, events = []) {
    const inGame = Boolean(room.game) && viewerSeat !== null && room.game.players.some((player) => player.seat === viewerSeat);
    return {
      roomId: room.roomId,
      hostUsername: room.hostUsername,
      isHost: viewerUsername === room.hostUsername,
      phase: room.phase,
      roundNumber: room.roundNumber,
      settings: { ...room.settings, rules: { ...room.settings.rules }, expansions: [...room.settings.expansions] },
      rulesSchema: base.houseRules || [],
      limits: { minSeats: MIN_SEATS, maxSeats: MAX_SEATS, thinkOptions: THINK_SECONDS },
      seat: viewerSeat,
      seats: room.seats.map((seat) => ({
        seat: seat.seat,
        username: seat.username,
        displayName: seat.isBot ? seat.botName : seat.username,
        isBot: seat.isBot,
        botLevel: seat.botLevel,
        occupied: Boolean(seat.username || seat.isBot),
        connected: seat.connected,
        autoPiloted: seat.autoPiloted,
      })),
      canStart: room.phase === 'waiting' && occupiedSeats(room).length >= MIN_SEATS,
      canRematch: room.phase === 'roundOver' && occupiedSeats(room).length >= MIN_SEATS,
      turnDeadline: room.turnDeadline,
      serverNow: now(),
      game: room.game ? engine.viewFor(room.game, inGame ? viewerSeat : null) : null,
      events,
      seq: room.game ? room.game.seq : 0,
      log: room.log,
    };
  }

  function broadcast(room) {
    const events = room.game ? engine.eventsSince(room.game, room.lastEventSeq) : [];
    if (room.game) room.lastEventSeq = room.game.seq;
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN || client.unoRoomId !== room.roomId) continue;
      const seat = seatByUsername(room, client.user?.username);
      send(client, 'ROOM_STATE', roomView(room, seat ? seat.seat : null, client.user?.username, events));
    }
  }

  /** 大厅列表：只暴露公共信息，不含任何手牌。 */
  function lobbyList() {
    return [...rooms.values()].map((room) => ({
      roomId: room.roomId,
      hostUsername: room.hostUsername,
      phase: room.phase,
      roundNumber: room.roundNumber,
      seatCount: room.settings.seats,
      seatedCount: occupiedSeats(room).length,
      humanCount: humanSeats(room).length,
      connectedHumans: connectedHumans(room).length,
      botCount: occupiedSeats(room).filter((seat) => seat.isBot).length,
      thinkSeconds: room.settings.thinkSeconds,
      rules: { ...room.settings.rules },
      expansions: [...room.settings.expansions],
      createdAt: room.createdAt,
      lastHumanActivity: room.lastHumanActivity,
    })).sort((left, right) => right.lastHumanActivity - left.lastHumanActivity);
  }

  // ---------- 计时 ----------

  function clearTimers(room) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    room.turnDeadline = null;
  }

  /** 现在该谁操作（可能是「先指定颜色」的那一位）。 */
  function actingSeatOf(room) {
    if (!room.game || room.game.phase !== 'playing') return null;
    if (room.game.awaitColorSeat !== null) return room.game.awaitColorSeat;
    return room.game.turnSeat;
  }

  /**
   * 安排当前操作位：
   *   机器人 → 短延迟自动出牌；
   *   托管中 / 已掉线 → 立刻由机器人代打；
   *   真人 → 开始思考倒计时，超时后托管（「不限时」档位不设倒计时）。
   */
  function scheduleTurn(room) {
    clearTimers(room);
    const seatIndex = actingSeatOf(room);
    if (seatIndex === null) return;
    const seat = room.seats[seatIndex];
    if (!seat) return;

    if (seat.isBot) {
      const delay = BOT_ACT_MIN_MS + Math.floor(Math.random() * (BOT_ACT_MAX_MS - BOT_ACT_MIN_MS));
      room.turnTimer = setTimeout(() => runAutoAction(room, 'bot', seatIndex), delay);
      return;
    }
    if (seat.autoPiloted) {
      room.turnTimer = setTimeout(() => runAutoAction(room, 'pilot', seatIndex), AUTO_PILOT_DELAY_MS);
      return;
    }
    if (!seat.connected) {
      room.turnTimer = setTimeout(() => runAutoAction(room, 'offline', seatIndex), AUTO_PILOT_DELAY_MS);
      return;
    }
    const think = room.settings.thinkSeconds;
    if (!think) return; // 不限时：等玩家自己行动
    room.turnDeadline = now() + think * 1000;
    room.turnTimer = setTimeout(() => runAutoAction(room, 'timeout', seatIndex), think * 1000);
  }

  /** 机器人 / 主动托管 / 掉线 / 超时四条路径共用同一个执行入口。 */
  function runAutoAction(room, reason, scheduledSeat = null) {
    room.turnTimer = null;
    room.turnDeadline = null;
    if (!rooms.has(room.roomId)) return;
    const seatIndex = scheduledSeat === null ? actingSeatOf(room) : scheduledSeat;
    // 定时器到点时局面可能已经变了（玩家自己先操作了、或回合已经走过去了），此时不能代打。
    if (seatIndex === null || actingSeatOf(room) !== seatIndex) return;
    const seat = room.seats[seatIndex];
    if (!seat) return;

    if (reason === 'timeout') {
      seat.autoPiloted = true;
      addLog(room, seatIndex, `${seatLabel(room, seatIndex)} 思考超时，交给机器人托管`);
    } else if (reason === 'offline') {
      seat.autoPiloted = true;
      addLog(room, seatIndex, `${seatLabel(room, seatIndex)} 已掉线，由机器人代打`);
    }

    try {
      const action = bots.decide(room.game, seatIndex, { level: seat.botLevel || 'normal' });
      if (action.type === 'none') throw new engine.UnoRuleError('没有可执行的动作。');
      bots.applyBotAction(room.game, seatIndex, action);
      afterEngineAction(room, { auto: true });
    } catch (error) {
      console.error('❌ UNO 自动决策失败:', error?.message || error);
      // 兜底：至少把回合交出去，别把牌桌卡死。
      try {
        const legal = engine.legalMoves(room.game, seatIndex);
        if (legal.canDraw) engine.applyDraw(room.game, seatIndex);
        else if (legal.canPass) engine.applyPass(room.game, seatIndex);
        else throw error;
        afterEngineAction(room, { auto: true });
      } catch (fallbackError) {
        console.error('❌ UNO 兜底动作也失败:', fallbackError?.message || fallbackError);
        clearTimers(room);
        broadcast(room);
      }
    }
  }

  /** 每次局面变化之后：判局终、安排下一位、广播。 */
  function afterEngineAction(room, { auto = false } = {}) {
    room.lastActivity = now();
    if (!auto) room.lastHumanActivity = now();

    if (room.game && room.game.phase === 'roundOver') {
      room.phase = 'roundOver';
      clearTimers(room);
      const winner = engine.playerAt(room.game, room.game.winner);
      addLog(room, room.game.winner, `${winner ? winner.name : '有人'} 出完最后一张牌，本局结束（对手剩余 ${room.game.roundPoints} 分）`);
    } else {
      scheduleTurn(room);
    }
    broadcast(room);
  }

  function startRound(room) {
    clearTimers(room);
    // 上一局中途离席留下的「临时机器人」：这一局开始前清掉，把座位还给真人。
    for (const seat of room.seats) {
      if (!seat.temporaryBot) continue;
      seat.isBot = false;
      seat.botLevel = null;
      seat.botName = null;
      seat.temporaryBot = false;
      seat.connected = false;
    }
    const players = occupiedSeats(room).map((seat) => ({
      seat: seat.seat,
      name: seat.isBot ? seat.botName : seat.username,
      isBot: seat.isBot,
    }));
    if (players.length < MIN_SEATS) throw new Error(`至少需要 ${MIN_SEATS} 位玩家。`);

    // 新一局重新发牌，托管状态清空：玩家自己回来就能接着打。
    for (const seat of room.seats) seat.autoPiloted = false;
    room.roundNumber += 1;
    room.phase = 'playing';
    room.game = engine.createRound({ catalog: base, players, rules: roomRules(room), seed: now() + room.roundNumber * 7919 });
    room.lastEventSeq = 0;
    addLog(room, null, `第 ${room.roundNumber} 局开始：${players.map((player) => player.name).join('、')}`);
    afterEngineAction(room, { auto: false });
  }

  // ---------- 房间生命周期 ----------

  /** 房规默认值以 base.json 为准（content 是单一事实来源）。 */
  function defaultRules() {
    const rules = { ...engine.DEFAULT_RULES };
    for (const rule of base.houseRules || []) rules[rule.id] = rule.default;
    return rules;
  }

  function createRoom(ws, username, payload) {
    const settings = normalizeSettings(payload, {
      seats: base.turnDefaults?.seats || MAX_SEATS,
      thinkSeconds: base.turnDefaults?.thinkSeconds ?? 20,
      rules: defaultRules(),
      expansions: [],
    });
    const roomId = randomRoomId();
    const stamp = now();
    const room = {
      roomId,
      hostUsername: username,
      createdAt: stamp,
      lastActivity: stamp,
      lastHumanActivity: stamp,
      emptySince: 0,
      phase: 'waiting',
      roundNumber: 0,
      settings,
      seats: makeSeats(settings.seats),
      game: null,
      turnTimer: null,
      turnDeadline: null,
      lastEventSeq: 0,
      log: [],
    };
    const seat = room.seats[0];
    seat.username = username;
    seat.joinedAt = stamp;
    seat.connected = true;
    rooms.set(roomId, room);
    ws.unoRoomId = roomId;
    addLog(room, 0, `${username} 创建了房间 ${roomId}`);
    broadcast(room);
    return room;
  }

  function joinRoom(ws, username, roomIdRaw) {
    const roomId = String(roomIdRaw || '').trim();
    if (!/^\d{6}$/.test(roomId)) throw new Error('房间号是 6 位数字。');
    const room = rooms.get(roomId);
    if (!room) throw new Error('房间不存在或已被回收。');

    const existing = seatByUsername(room, username);
    if (existing) {
      // 回到自己的座位：解除托管，操作权交回玩家（手牌与进度原样保留）。
      existing.connected = true;
      existing.autoPiloted = false;
      ws.unoRoomId = roomId;
      room.lastActivity = now();
      room.lastHumanActivity = now();
      room.emptySince = 0;
      addLog(room, existing.seat, `${username} 重新加入房间，收回座位`);
      if (actingSeatOf(room) === existing.seat) scheduleTurn(room);
      broadcast(room);
      return room;
    }

    const free = room.seats.find((seat) => !seat.username && !seat.isBot);
    if (!free) throw new Error('房间已满。');
    free.username = username;
    free.joinedAt = now();
    free.connected = true;
    free.autoPiloted = false;
    ws.unoRoomId = roomId;
    room.lastActivity = now();
    room.lastHumanActivity = now();
    room.emptySince = 0;
    addLog(room, free.seat, room.phase === 'playing'
      ? `${username} 加入房间，将在下一局入座`
      : `${username} 加入房间`);
    broadcast(room);
    return room;
  }

  function closeRoom(roomId, reason = '房间已关闭') {
    const room = rooms.get(roomId);
    if (!room) return false;
    clearTimers(room);
    rooms.delete(roomId);
    for (const client of wss.clients) {
      if (client.unoRoomId !== roomId) continue;
      send(client, 'ROOM_CLOSED', { roomId, reason });
      client.unoRoomId = null;
      if (client.readyState === WebSocket.OPEN) client.close(1000, 'Room closed');
    }
    return true;
  }

  /**
   * 主动离开房间：释放座位。房主离开时把房主身份顺延给最早加入的真人；
   * 对局中离开会把座位临时交给机器人，保证这一局能正常打完（下一局开始时清掉）。
   */
  function leaveRoom(ws) {
    const roomId = ws.unoRoomId;
    ws.unoRoomId = null;
    if (!roomId || !rooms.has(roomId)) return null;
    const room = rooms.get(roomId);
    const username = ws.user?.username;
    const seat = seatByUsername(room, username);
    if (!seat) {
      broadcast(room);
      return room;
    }

    seat.username = null;
    seat.connected = false;
    seat.autoPiloted = false;
    seat.joinedAt = 0;
    addLog(room, seat.seat, `${username} 离开了房间`);

    if (room.phase === 'playing' && room.game.players.some((player) => player.seat === seat.seat)) {
      seat.isBot = true;
      seat.botLevel = 'normal';
      seat.botName = `${BOT_NAMES[botCounter++ % BOT_NAMES.length]}（临时）`;
      seat.temporaryBot = true;
      addLog(room, seat.seat, `这一局由机器人 ${seat.botName} 接手`);
    }

    if (username === room.hostUsername) {
      const heir = humanSeats(room).sort((left, right) => left.joinedAt - right.joinedAt)[0];
      if (heir) {
        room.hostUsername = heir.username;
        addLog(room, null, `房主已转交给 ${heir.username}`);
      } else {
        return closeRoom(roomId, '房主已解散房间');
      }
    }

    room.lastActivity = now();
    room.lastHumanActivity = now();
    if (!connectedHumans(room).length) room.emptySince = now();
    scheduleTurn(room);
    broadcast(room);
    return room;
  }

  // 闲置回收：等待中没人进入 / 对局中长时间没人操作 / 全员掉线。
  const cleanupTimer = setInterval(() => {
    const stamp = now();
    for (const [roomId, room] of rooms) {
      if (room.emptySince && stamp - room.emptySince > ttls.emptyMs) {
        console.log(`🧹 回收 UNO 房间 ${roomId}：全员掉线超过 ${Math.round(ttls.emptyMs / 1000)} 秒`);
        closeRoom(roomId, '房间里已经没有人了，房间已回收');
        continue;
      }
      const idle = stamp - room.lastHumanActivity;
      if (room.phase === 'waiting' && idle > ttls.waitingMs) {
        console.log(`🧹 回收 UNO 房间 ${roomId}：等待中一直没人进入`);
        closeRoom(roomId, '房间长时间没人进入，已自动回收');
        continue;
      }
      if (room.phase !== 'waiting' && idle > ttls.playingMs) {
        console.log(`🧹 回收 UNO 房间 ${roomId}：对局中长时间无人操作`);
        closeRoom(roomId, '房间长时间无人操作，已自动回收');
      }
    }
  }, ttls.sweepMs);

  // ---------- 消息处理 ----------

  function requireTurn(room, seatIndex) {
    if (!room.game || room.game.phase !== 'playing') throw new Error('现在没有进行中的对局。');
    if (actingSeatOf(room) !== seatIndex) throw new Error('现在不是你操作。');
  }

  async function handleMessage(ws, message) {
    const { type, payload = {} } = message;
    const username = ws.user?.username;

    if (type === 'PING') {
      const room = ws.unoRoomId ? rooms.get(ws.unoRoomId) : null;
      if (room) {
        room.lastActivity = now();
        room.lastHumanActivity = now();
        if (room.emptySince && connectedHumans(room).length) room.emptySince = 0;
      }
      send(ws, 'PONG', { at: now() });
      return;
    }

    if (type === 'CREATE_ROOM') {
      if (ws.unoRoomId && rooms.has(ws.unoRoomId)) throw new Error('你已经在一个房间里了。');
      createRoom(ws, username, payload);
      return;
    }

    if (type === 'JOIN_ROOM') {
      joinRoom(ws, username, payload.roomId);
      return;
    }

    // 以下操作都要求已经在房间里。
    const roomId = ws.unoRoomId;
    const room = roomId ? rooms.get(roomId) : null;
    if (!room) throw new Error('请先创建或加入房间。');
    const mySeat = seatByUsername(room, username);
    const isHost = username === room.hostUsername;
    room.lastActivity = now();
    room.lastHumanActivity = now();

    switch (type) {
      case 'UPDATE_SETTINGS': {
        if (!isHost) throw new Error('只有房主可以修改房间设置。');
        if (room.phase === 'playing') throw new Error('对局进行中不能改设置，等这一局结束。');
        const next = normalizeSettings(payload, room.settings);
        if (next.seats !== room.settings.seats) {
          if (next.seats < occupiedSeats(room).length) throw new Error('座位数不能少于当前在座人数。');
          const seats = makeSeats(next.seats);
          for (const seat of room.seats) {
            if (seat.username || seat.isBot) Object.assign(seats[seat.seat], seat);
          }
          room.seats = seats;
        }
        room.settings = next;
        addLog(room, null, '房主更新了房间设置');
        broadcast(room);
        return;
      }

      case 'ADD_BOT': {
        if (!isHost) throw new Error('只有房主可以添加机器人。');
        if (room.phase === 'playing') throw new Error('对局进行中不能加机器人，等这一局结束。');
        const level = String(payload.level || 'normal');
        if (!bots.LEVELS.includes(level)) throw new Error('机器人难度无效。');
        const free = room.seats.find((seat) => !seat.username && !seat.isBot);
        if (!free) throw new Error('没有空座位了。');
        free.isBot = true;
        free.botLevel = level;
        free.botName = BOT_NAMES[botCounter++ % BOT_NAMES.length];
        free.connected = true;
        addLog(room, free.seat, `房主请来了机器人 ${free.botName}（${bots.LEVEL_LABELS[level] || level}）`);
        broadcast(room);
        return;
      }

      case 'REMOVE_BOT': {
        if (!isHost) throw new Error('只有房主可以移除机器人。');
        if (room.phase === 'playing') throw new Error('对局进行中不能移除机器人。');
        const target = room.seats[Math.trunc(Number(payload.seat))];
        if (!target || !target.isBot) throw new Error('该座位上没有机器人。');
        addLog(room, target.seat, `机器人 ${target.botName} 离开了房间`);
        target.isBot = false;
        target.botLevel = null;
        target.botName = null;
        target.connected = false;
        target.temporaryBot = false;
        broadcast(room);
        return;
      }

      case 'START_GAME':
      case 'REMATCH': {
        if (!isHost) throw new Error('只有房主可以开始牌局。');
        if (room.phase === 'playing') throw new Error('对局已经在进行中。');
        if (occupiedSeats(room).length < MIN_SEATS) throw new Error(`至少需要 ${MIN_SEATS} 位玩家（可以加机器人）。`);
        startRound(room);
        return;
      }

      case 'PLAY_CARD': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        requireTurn(room, mySeat.seat);
        engine.applyPlay(room.game, mySeat.seat, String(payload.cardId || ''));
        mySeat.autoPiloted = false; // 玩家自己操作了，收回控制权
        if (payload.color) {
          // 万能牌：客户端可以顺手把颜色一起发过来，省一次往返。
          try { engine.applyChooseColor(room.game, mySeat.seat, String(payload.color)); }
          catch { /* 不是万能牌或不需要选色 */ }
        }
        afterEngineAction(room, { auto: false });
        return;
      }

      case 'DRAW_CARD': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        requireTurn(room, mySeat.seat);
        engine.applyDraw(room.game, mySeat.seat);
        mySeat.autoPiloted = false;
        afterEngineAction(room, { auto: false });
        return;
      }

      case 'PASS': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        requireTurn(room, mySeat.seat);
        engine.applyPass(room.game, mySeat.seat);
        mySeat.autoPiloted = false;
        afterEngineAction(room, { auto: false });
        return;
      }

      case 'CHOOSE_COLOR': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        if (!room.game || room.game.phase !== 'playing') throw new Error('现在没有进行中的对局。');
        engine.applyChooseColor(room.game, mySeat.seat, String(payload.color || ''));
        mySeat.autoPiloted = false;
        afterEngineAction(room, { auto: false });
        return;
      }

      case 'CALL_UNO': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        engine.applyCallUno(room.game, mySeat.seat);
        broadcast(room);
        return;
      }

      case 'CHALLENGE_UNO': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        const targetSeat = Math.trunc(Number(payload.targetSeat));
        if (!room.seats[targetSeat]) throw new Error('座位不存在。');
        engine.applyChallenge(room.game, mySeat.seat, targetSeat);
        broadcast(room);
        return;
      }

      case 'SET_AUTO_PILOT': {
        if (!mySeat) throw new Error('你不在这张牌桌上。');
        const on = payload.on === undefined ? !mySeat.autoPiloted : Boolean(payload.on);
        mySeat.autoPiloted = on;
        addLog(room, mySeat.seat, `${username} ${on ? '交给机器人托管' : '收回操作权'}`);
        if (actingSeatOf(room) === mySeat.seat) scheduleTurn(room);
        broadcast(room);
        return;
      }

      case 'LEAVE_ROOM': {
        leaveRoom(ws);
        return;
      }

      case 'DELETE_ROOM': {
        if (!isHost) throw new Error('只有房主可以解散房间。');
        closeRoom(room.roomId, '房主已解散房间');
        return;
      }

      default:
        throw new Error(`未知操作：${type}`);
    }
  }

  // ---------- 连接 ----------

  wss.on('connection', (ws) => {
    ws.unoRoomId = null;

    ws.on('message', (data) => {
      void (async () => {
        let message;
        try { message = JSON.parse(data.toString()); }
        catch { sendError(ws, '消息格式无效。'); return; }

        if (!ws.user || !auth.hasToolAccess(ws.user, 'uno')) {
          sendError(ws, '当前账户没有 UNO 权限。');
          ws.close(1008, 'Unauthorized');
          return;
        }

        try { await handleMessage(ws, message); }
        catch (error) {
          if (error instanceof engine.UnoRuleError) return sendError(ws, error.message);
          sendError(ws, error?.message || '服务器错误');
        }
      })().catch((error) => {
        console.error('❌ UNO 消息处理错误:', error);
        sendError(ws, '服务器错误');
      });
    });

    ws.on('close', () => {
      const roomId = ws.unoRoomId;
      ws.unoRoomId = null;
      if (!roomId || !rooms.has(roomId)) return;
      const room = rooms.get(roomId);
      const seat = seatByUsername(room, ws.user?.username);
      room.lastActivity = now();
      if (seat) {
        // 掉线不释放座位：回来（重新加入房间）就能顶替回机器人。
        seat.connected = false;
        addLog(room, seat.seat, `${seat.username} 断开连接`);
      }
      if (!connectedHumans(room).length) room.emptySince = now();
      scheduleTurn(room); // 掉线的人正好在行动轮就交给机器人
      broadcast(room);
    });
  });

  return {
    wss,
    rooms,
    cleanupTimer,
    closeRoom,
    lobbyList,
    catalog: () => base,
    THINK_SECONDS,
    MIN_SEATS,
    MAX_SEATS,
  };
}

module.exports = { createUnoRoomServer, THINK_SECONDS, MIN_SEATS, MAX_SEATS };