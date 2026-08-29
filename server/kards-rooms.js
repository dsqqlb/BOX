'use strict';

/**
 * Kards 对战桌：双人 WebSocket 房间（/ws/kards）。
 *
 * 设计定位与 TTS 一致：模拟器只负责"把牌摆好"，不判定规则。
 * 服务端保管共享桌面状态并做两件事：
 *   1. 权限/所有权校验（玩家只能动自己的牌、改自己的 kredits）；
 *   2. 隐私遮蔽——自己的手牌和牌库对对手只暴露数量与"背面"占位，
 *      前线/支援/墓地/HQ 等公共区域对双方完全可见。
 *
 * 房间状态在进程内存中（与先攻追踪器一致），重启即清空，属于已知限制。
 */

const WebSocket = require('ws');
const { loadCatalog } = require('./kards-decks');

const ZONES = new Set(['deck', 'hand', 'frontline', 'support', 'discard', 'hq']);
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // 无活动 2 小时后回收房间
const MAX_DECK_CARDS = 200;
const MAX_COPIES = 3;

function createKardsRoomServer({ auth }) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 512 * 1024 });
  const rooms = new Map();

  function randomRoomId() {
    for (let i = 0; i < 100; i++) {
      const id = String(Math.floor(100000 + Math.random() * 900000));
      if (!rooms.has(id)) return id;
    }
    return String(Date.now()).slice(-6);
  }

  function addLog(room, seat, text) {
    room.log = [{ at: Date.now(), seat, text }, ...room.log].slice(0, 40);
  }

  function makeDeckCards(deckCards, owner, seqState) {
    return (deckCards || []).map((cardId) => {
      const id = `${cardId}#${seqState.n++}`;
      return { id, cardId, owner, zone: 'deck', order: seqState.n - 1, faceDown: true, rotated: false, damage: 0 };
    });
  }

  /** 校验牌组卡牌 id：只保留目录中存在的卡，单卡最多 3 张，总量上限 200。 */
  function sanitizeDeckCards(deckCards) {
    if (!Array.isArray(deckCards)) return [];
    const catalog = loadCatalog();
    const seen = new Map();
    const out = [];
    for (const id of deckCards) {
      if (typeof id !== 'string' || !catalog.byId.has(id)) continue;
      const count = seen.get(id) || 0;
      if (count >= MAX_COPIES) continue;
      seen.set(id, count + 1);
      out.push(id);
      if (out.length >= MAX_DECK_CARDS) break;
    }
    return out;
  }

  function makeRoom(hostUsername, deckCards) {
    const seqState = { n: 0 };
    const cards = makeDeckCards(deckCards, 0, seqState);
    return {
      roomId: randomRoomId(),
      hostUsername,
      joinerUsername: null,
      players: [
        { seat: 0, username: hostUsername, connected: true },
        { seat: 1, username: null, connected: false },
      ],
      kredits: [
        { current: 1, max: 10 },
        { current: 1, max: 10 },
      ],
      turnSeat: 0,
      cards,
      log: [{ at: Date.now(), seat: 0, text: `${hostUsername} 创建了房间` }],
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };
  }

  function shuffleDeck(cards, owner) {
    const deckCards = cards
      .filter((card) => card.owner === owner && card.zone === 'deck')
      .sort((a, b) => a.order - b.order);
    const orders = deckCards.map((_, index) => index);
    for (let i = orders.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [orders[i], orders[j]] = [orders[j], orders[i]];
    }
    deckCards.forEach((card, index) => {
      card.order = orders[index];
      card.faceDown = true;
    });
  }

  function zoneCards(room, owner, zone) {
    return room.cards
      .filter((card) => card.owner === owner && card.zone === zone)
      .sort((a, b) => a.order - b.order);
  }

  function nextOrder(room, owner, zone) {
    const maxOrder = room.cards.reduce((max, card) => {
      if (card.owner === owner && card.zone === zone && card.order > max) return card.order;
      return max;
    }, -1);
    return maxOrder + 1;
  }

  function cardForClient(card, viewerSeat) {
    const hidden = card.owner !== viewerSeat && (card.zone === 'hand' || card.zone === 'deck');
    return {
      id: card.id,
      owner: card.owner,
      zone: card.zone,
      order: card.order,
      faceDown: hidden ? true : card.faceDown,
      rotated: hidden ? false : card.rotated,
      damage: hidden ? 0 : card.damage,
      cardId: hidden ? null : card.cardId,
      hidden,
    };
  }

  function roomView(room, viewerSeat) {
    return {
      roomId: room.roomId,
      seat: viewerSeat,
      players: room.players.map((player) => ({ seat: player.seat, username: player.username, connected: player.connected })),
      kredits: room.kredits.map((entry) => ({ current: entry.current, max: entry.max })),
      turnSeat: room.turnSeat,
      cards: room.cards.map((card) => cardForClient(card, viewerSeat)),
      log: room.log,
    };
  }

  function broadcast(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN && client.roomId === roomId && client.seat != null) {
        client.send(JSON.stringify({ type: 'ROOM_STATE', payload: roomView(room, client.seat) }));
      }
    });
  }

  function sendError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ERROR', payload: { message } }));
  }

  function closeRoom(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    wss.clients.forEach((client) => {
      if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'ROOM_CLOSED', payload: { roomId } }));
        client.close(1000, 'Room closed');
      }
    });
    rooms.delete(roomId);
  }

  function findCard(room, cardId, owner) {
    return room.cards.find((card) => card.id === cardId && card.owner === owner) || null;
  }

  function handleAction(ws, room, payload) {
    const { action } = payload;
    const seat = ws.seat;
    const now = Date.now();
    room.lastActivity = now;

    switch (action) {
      case 'DRAW': {
        const count = Math.max(1, Math.min(10, Number.isFinite(Number(payload.count)) ? Math.floor(Number(payload.count)) : 1));
        const deck = zoneCards(room, seat, 'deck').slice(0, count);
        if (deck.length === 0) return sendError(ws, '牌库是空的。');
        for (const card of deck) {
          card.zone = 'hand';
          card.faceDown = false;
          card.order = nextOrder(room, seat, 'hand');
        }
        addLog(room, seat, `摸了 ${deck.length} 张牌`);
        break;
      }

      case 'MOVE': {
        const { cardId, zone, faceDown } = payload;
        if (typeof cardId !== 'string' || !ZONES.has(zone)) return sendError(ws, '移动参数无效。');
        const card = findCard(room, cardId, seat);
        if (!card) return sendError(ws, '找不到这张牌（只能操作自己的牌）。');
        if (card.zone === zone) return sendError(ws, '这张牌已经在这个区域了。');
        card.zone = zone;
        card.order = nextOrder(room, seat, zone);
        if (zone === 'deck') card.faceDown = true;
        if (typeof faceDown === 'boolean') card.faceDown = faceDown;
        if (zone === 'hand') card.faceDown = false;
        addLog(room, seat, `把一张牌移到「${zone}」`);
        break;
      }

      case 'FLIP': {
        const card = findCard(room, payload.cardId, seat);
        if (!card) return sendError(ws, '找不到这张牌（只能操作自己的牌）。');
        card.faceDown = !card.faceDown;
        addLog(room, seat, card.faceDown ? '翻成背面' : '翻开');
        break;
      }

      case 'ROTATE': {
        const card = findCard(room, payload.cardId, seat);
        if (!card) return sendError(ws, '找不到这张牌（只能操作自己的牌）。');
        card.rotated = !card.rotated;
        addLog(room, seat, card.rotated ? '旋转（攻击态）' : '摆正（防御态）');
        break;
      }

      case 'DAMAGE': {
        const card = findCard(room, payload.cardId, seat);
        if (!card) return sendError(ws, '找不到这张牌（只能操作自己的牌）。');
        const delta = Math.max(-9, Math.min(9, Math.floor(Number(payload.delta) || 0)));
        card.damage = Math.max(0, Math.min(99, card.damage + delta));
        if (delta !== 0) addLog(room, seat, `伤害 ${delta > 0 ? '+' : ''}${delta}`);
        break;
      }

      case 'KREDITS': {
        const delta = Math.max(-9, Math.min(9, Math.floor(Number(payload.delta) || 0)));
        const entry = room.kredits[seat];
        entry.current = Math.max(0, Math.min(entry.max, entry.current + delta));
        if (delta !== 0) addLog(room, seat, `kredits ${delta > 0 ? '+' : ''}${delta} → ${entry.current}`);
        break;
      }

      case 'SHUFFLE': {
        shuffleDeck(room.cards, seat);
        addLog(room, seat, '洗了牌库');
        break;
      }

      case 'PASS_TURN': {
        room.turnSeat = room.turnSeat === 0 ? 1 : 0;
        addLog(room, seat, `把回合标记交给 ${room.turnSeat === 0 ? '玩家1' : '玩家2'}`);
        break;
      }

      case 'RESET_TABLE': {
        const owners = [0, 1];
        for (const owner of owners) {
          for (const card of room.cards) {
            if (card.owner !== owner) continue;
            card.zone = 'deck';
            card.faceDown = true;
            card.rotated = false;
            card.damage = 0;
          }
          shuffleDeck(room.cards, owner);
        }
        room.turnSeat = 0;
        room.kredits = [
          { current: 1, max: 10 },
          { current: 1, max: 10 },
        ];
        addLog(room, seat, '重置了桌面（所有牌回到牌库并洗牌）');
        break;
      }

      case 'SET_DECK': {
        const deckCards = sanitizeDeckCards(payload.deckCards);
        if (deckCards.length === 0) return sendError(ws, '牌组数据无效。');
        room.cards = room.cards.filter((card) => card.owner !== seat || card.zone !== 'deck');
        const seqState = { n: room.cards.length };
        const newCards = makeDeckCards(deckCards, seat, seqState);
        room.cards = room.cards.concat(newCards);
        shuffleDeck(room.cards, seat);
        addLog(room, seat, `换了新牌库（${newCards.length} 张）并洗牌`);
        break;
      }

      default:
        sendError(ws, `未知操作：${action}`);
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload = {} } = message;

        if (!ws.user || !auth.hasToolAccess(ws.user, 'kards')) {
          sendError(ws, '当前账户没有 Kards 工具权限。');
          ws.close(1008, 'Unauthorized');
          return;
        }

        switch (type) {
          case 'PING': {
            if (ws.roomId && rooms.has(ws.roomId)) rooms.get(ws.roomId).lastActivity = Date.now();
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;
          }

          case 'CREATE_ROOM': {
            const { roomId } = payload;
            if (typeof roomId === 'string' && rooms.has(roomId)) {
              const existing = rooms.get(roomId);
              if (existing.hostUsername !== ws.user.username) {
                sendError(ws, '这个房间号已经被占用。');
                return;
              }
              // 房主断线重连：沿用现有桌面，只重新绑定连接。
              existing.players[0].connected = true;
              existing.lastActivity = Date.now();
              ws.roomId = existing.roomId;
              ws.seat = 0;
              addLog(existing, 0, `${ws.user.username} 重新连接`);
              broadcast(existing.roomId);
              return;
            }

            const deckCards = sanitizeDeckCards(payload.deckCards);
            const room = makeRoom(ws.user.username, deckCards);
            rooms.set(room.roomId, room);
            ws.roomId = room.roomId;
            ws.seat = 0;
            console.log(`🎴 Kards 房间创建: ${room.roomId}（房主 ${ws.user.username}，${deckCards.length} 张牌）`);
            broadcast(room.roomId);
            break;
          }

          case 'JOIN_ROOM': {
            const { roomId } = payload;
            if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) {
              sendError(ws, '房间号无效。');
              return;
            }
            if (!rooms.has(roomId)) {
              sendError(ws, '房间不存在，请检查房间号。');
              return;
            }
            const room = rooms.get(roomId);

            if (room.hostUsername === ws.user.username) {
              sendError(ws, '不能加入自己创建的房间（房主请直接在房间里操作）。');
              return;
            }
            if (room.joinerUsername === ws.user.username) {
              // 2P 断线重连。
              room.players[1].connected = true;
              room.lastActivity = Date.now();
              ws.roomId = room.roomId;
              ws.seat = 1;
              addLog(room, 1, `${ws.user.username} 重新连接`);
              broadcast(room.roomId);
              return;
            }
            if (room.joinerUsername) {
              sendError(ws, '房间已满。');
              return;
            }

            room.joinerUsername = ws.user.username;
            room.players[1].username = ws.user.username;
            room.players[1].connected = true;
            room.lastActivity = Date.now();
            ws.roomId = room.roomId;
            ws.seat = 1;

            const deckCards = sanitizeDeckCards(payload.deckCards);
            if (deckCards.length) {
              const seqState = { n: room.cards.length };
              room.cards = room.cards.concat(makeDeckCards(deckCards, 1, seqState));
              shuffleDeck(room.cards, 1);
            }
            addLog(room, 1, `${ws.user.username} 加入了房间`);
            console.log(`🎴 ${ws.user.username} 加入 Kards 房间 ${room.roomId}`);
            broadcast(room.roomId);
            break;
          }

          case 'ACTION': {
            if (typeof payload.roomId !== 'string' || !rooms.has(payload.roomId)) {
              sendError(ws, '房间不存在或已关闭。');
              return;
            }
            const room = rooms.get(payload.roomId);
            if (ws.roomId !== room.roomId || ws.seat == null) {
              sendError(ws, '请先加入房间。');
              return;
            }
            handleAction(ws, room, payload);
            if (rooms.has(room.roomId)) broadcast(room.roomId);
            break;
          }

          case 'LEAVE_ROOM': {
            if (ws.roomId && rooms.has(ws.roomId)) {
              const room = rooms.get(ws.roomId);
              const seat = ws.seat;
              room.players[seat].connected = false;
              room.lastActivity = Date.now();
              addLog(room, seat, `${ws.user.username} 离开了房间`);
              ws.roomId = null;
              ws.seat = null;
              broadcast(room.roomId);
            }
            break;
          }

          case 'DELETE_ROOM': {
            if (typeof payload.roomId !== 'string' || !rooms.has(payload.roomId)) return;
            const room = rooms.get(payload.roomId);
            if (room.hostUsername !== ws.user.username) {
              sendError(ws, '只有房主可以解散房间。');
              return;
            }
            console.log(`🗑️ Kards 房间解散: ${room.roomId}`);
            closeRoom(room.roomId);
            break;
          }

          default:
            console.log(`⚠️ Kards 未知消息类型: ${type}`);
        }
      } catch (error) {
        console.error('❌ Kards 消息处理错误:', error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '服务器错误' } }));
      }
    });

    ws.on('close', () => {
      if (!ws.roomId) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const seat = ws.seat;
      if (seat == null || seat > 1 || !room.players[seat]) return;
      room.players[seat].connected = false;
      room.lastActivity = Date.now();
      addLog(room, seat, `${ws.user.username} 断开连接`);
      broadcast(room.roomId);
    });
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [roomId, room] of rooms) {
      if (now - room.lastActivity > ROOM_TTL_MS) {
        console.log(`🧹 回收闲置 Kards 房间: ${roomId}`);
        closeRoom(roomId);
      }
    }
  }, 60 * 1000);

  return { wss, rooms, cleanupTimer, closeRoom };
}

module.exports = { createKardsRoomServer };
