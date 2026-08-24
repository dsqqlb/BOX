'use strict';

/**
 * WebSocket：先攻追踪器房间实时同步。
 *
 * noServer:true —— 不自己起HTTP服务，而是由 server/index.js 在 upgrade 事件里
 * 按路径决定这个升级请求是给房间同步(/ws)还是给Next.js的HMR，鉴权通过后调用
 * wss.handleUpgrade 并把用户信息挂到 ws.user 上。
 *
 * 房间数据存储在进程内存中，容器重启会清空，这是已知限制。
 */

const WebSocket = require('ws');

function createRoomServer({ auth }) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });

  // 存储所有房间的数据（进程内存，容器重启会清空，这是已知限制）
  const rooms = new Map();

  // 广播函数：向房间内所有客户端发送消息
  function broadcastToRoom(roomId, message, excludeClient = null) {
    wss.clients.forEach((client) => {
      if (
        client.readyState === WebSocket.OPEN &&
        client.roomId === roomId &&
        client !== excludeClient
      ) {
        client.send(JSON.stringify(message));
      }
    });
  }

  function sendWsError(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ERROR', payload: { message } }));
  }

  function isCurrentRoomMember(ws, roomId) {
    return typeof roomId === 'string' && ws.roomId === roomId && rooms.has(roomId);
  }

  const ROOM_UPDATE_FIELDS = new Set([
    'characters', 'currentTurn', 'roundNumber', 'dimIntensity', 'resultPanelOpacity',
    'characterScale', 'diceDisplayScale', 'roomInfoScale', 'diceHistoryScale',
    'displayRoomInfoVisible', 'displayDiceHistoryVisible', 'displayRoundVisible',
  ]);

  function sanitizeRoomUpdates(updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return null;
    const safe = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ROOM_UPDATE_FIELDS.has(key)) safe[key] = value;
    }
    return safe;
  }

  wss.on('connection', (ws) => {
    console.log('🔌 新客户端连接');

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        const { type, payload } = message;

        if (!ws.user || !auth.hasToolAccess(ws.user, 'initiative-tracker')) {
          sendWsError(ws, '当前账户没有先攻追踪器权限。');
          ws.close(1008, 'Unauthorized');
          return;
        }

        console.log('📨 收到消息:', type, payload);

        switch (type) {
          case 'CREATE_ROOM': {
            // 主屏幕创建房间（或由同一账户断线后重连）。房间号仍由主屏选择，但必须是合法的六位数字。
            const { roomId } = payload || {};
            if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) {
              sendWsError(ws, '房间号无效。');
              return;
            }
            const now = Date.now();
            const isReconnect = rooms.has(roomId);

            if (isReconnect && rooms.get(roomId).ownerUsername !== ws.user.username) {
              sendWsError(ws, '只有创建该房间的账户可以作为主屏幕重连。');
              return;
            }

            if (!isReconnect) {
              rooms.set(roomId, {
                roomId,
                ownerUsername: ws.user.username,
                characters: [],
                currentTurn: 0,
                roundNumber: 1,
                diceHistory: [],
                displayRoomInfoVisible: true,
                displayDiceHistoryVisible: true,
                displayRoundVisible: true,
                characterScale: 1,
                diceDisplayScale: 1,
                roomInfoScale: 1,
                diceHistoryScale: 1,
                createdAt: now,
                lastActivity: now,
                displayConnected: true,
              });
              console.log(`🏠 房间创建: ${roomId}`);
            } else {
              console.log(`🔁 主屏幕重新连接到已存在房间: ${roomId}`);
            }

            const room = rooms.get(roomId);
            room.lastActivity = now;
            room.displayConnected = true;

            ws.roomId = roomId;
            ws.isDisplay = true;

            ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: room }));

            // 通知房间内所有遥控器：主屏幕已连接/重连
            if (isReconnect) {
              broadcastToRoom(roomId, { type: 'DISPLAY_STATUS', payload: { connected: true } }, ws);
            }
            break;
          }

          case 'JOIN_ROOM': {
            // 遥控器加入房间：必须持有先攻追踪器权限，且仅允许加入合法的现有房间。
            const { roomId } = payload || {};
            if (typeof roomId !== 'string' || !/^\d{6}$/.test(roomId)) {
              sendWsError(ws, '房间号无效。');
              return;
            }

            if (!rooms.has(roomId)) {
              ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '房间不存在' } }));
              console.log(`❌ 尝试加入不存在的房间: ${roomId}`);
              return;
            }

            const room = rooms.get(roomId);
            room.lastActivity = Date.now();

            ws.roomId = roomId;
            ws.isDisplay = false;

            console.log(`🎮 遥控器加入房间 ${roomId}`);

            ws.send(JSON.stringify({ type: 'ROOM_STATE', payload: room }));

            // 同步告知遥控器主屏幕当前的在线状态
            ws.send(JSON.stringify({
              type: 'DISPLAY_STATUS',
              payload: { connected: room.displayConnected !== false },
            }));
            break;
          }

          case 'UPDATE_ROOM': {
            // 只有已加入该房间的遥控器可以更改共享战斗状态；字段白名单防止客户端覆盖房间所有权等内部字段。
            const { roomId, updates } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
              sendWsError(ws, '无权更新该房间。');
              return;
            }
            const safeUpdates = sanitizeRoomUpdates(updates);
            if (!safeUpdates || Object.keys(safeUpdates).length === 0) {
              sendWsError(ws, '没有可更新的房间字段。');
              return;
            }

            const room = rooms.get(roomId);
            Object.assign(room, safeUpdates);
            room.lastActivity = Date.now();

            console.log(`🔄 房间更新: ${roomId}`, Object.keys(safeUpdates));

            broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
            break;
          }

          case 'DICE_HISTORY_APPEND': {
            // 遥控器在初次结果和每次重投结果后提交历史；只有当前房间的遥控器可写入。
            const { roomId, entry } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay || !entry
              || typeof entry.id !== 'string'
              || typeof entry.recordedAt !== 'string'
              || typeof entry.label !== 'string'
              || typeof entry.expression !== 'string'
              || typeof entry.finalTotal !== 'number'
              || !Array.isArray(entry.rerolls)) return;
            const room = rooms.get(roomId);
            const history = Array.isArray(room.diceHistory) ? room.diceHistory : [];
            // 初次结果立即写入；重投结果会带相同id再次提交，从而覆盖成最新点数与重投明细。
            room.diceHistory = [entry, ...history.filter((item) => item && item.id !== entry.id)].slice(0, 50);
            room.lastActivity = Date.now();
            broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
            break;
          }

          case 'DICE_HISTORY_CLEAR': {
            const { roomId } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
              sendWsError(ws, '无权清空该房间的历史记录。');
              return;
            }
            const room = rooms.get(roomId);
            room.diceHistory = [];
            room.lastActivity = Date.now();
            broadcastToRoom(roomId, { type: 'ROOM_STATE', payload: room });
            break;
          }

          case 'DICE_ROLL': {
            // 遥控器发起一次掷骰请求：只做转发广播，不存进房间状态里
            // （掷骰是一次性事件，不是需要持久化的房间数据，房间重连/刷新时不需要重放上一次的投骰动画）。
            // 广播给房间内所有客户端（包括主屏幕和其他遥控器），主屏幕收到后播放3D动画，
            // 遥控器收到后进入"等待结果"状态。
            // shapeTextures 是按形状(d4/d6/d8/d10/d12/d20)单独指定的纹理，一并转发给主屏幕决定3D骰子的样式。
            // 不再需要颜色方案(colorset)——纹理图本身盖住骰子表面，颜色对最终视觉没有影响。
            // recipe 是可选的"自定义表达式配方"(骰子分组+kh/kl取高取低+符号，不含完整语法树)，
            // 只有遥控器"自定义掷骰"标签页用表达式发起投掷时才会带上；服务器只管转发，不解析内容，
            // 主屏幕拿到后据此重新计算kh/kl明细，决定给哪几颗骰子加发光描边。
            const { roomId, id, notation, shapeTextures, recipe, label, expression } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
              sendWsError(ws, '无权在该房间发起掷骰。');
              return;
            }
            rooms.get(roomId).lastActivity = Date.now();
            console.log(`🎲 掷骰请求: ${roomId} ${notation}`);
            broadcastToRoom(roomId, { type: 'DICE_ROLL', payload: { id, notation, shapeTextures, recipe, label, expression } });
            break;
          }

          case 'DICE_ROLL_RESULT': {
            // 主屏幕算完3D骰子动画的结果后，把结构化结果广播回房间内所有客户端，
            // 遥控器据此展示每组小计+总和的文字结果。
            const { roomId, id, notation, result } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || !ws.isDisplay) {
              sendWsError(ws, '只有当前主屏幕可以发送掷骰结果。');
              return;
            }
            rooms.get(roomId).lastActivity = Date.now();
            broadcastToRoom(roomId, { type: 'DICE_ROLL_RESULT', payload: { id, notation, result } });
            break;
          }

          case 'DICE_DIE_REROLL': {
            // 重投请求可包含多颗骰子；服务器只转发，主屏幕会校验本轮可用骰子并一次性播放动画。
            const { roomId, rollId, requestId, dieIds } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
              sendWsError(ws, '无权在该房间请求重投。');
              return;
            }
            rooms.get(roomId).lastActivity = Date.now();
            console.log(`🎲 重投请求: ${roomId} 骰子#${Array.isArray(dieIds) ? dieIds.join(', ') : ''}`);
            broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL', payload: { rollId, requestId, dieIds } });
            break;
          }

          case 'DICE_DIE_REROLL_RESULT': {
            // 主屏幕广播一次批量重投后的完整结果和已使用重投机会的骰子列表。
            const { roomId, id, requestId, notation, result, rerolledDieIds, rerolls } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || !ws.isDisplay) {
              sendWsError(ws, '只有当前主屏幕可以发送重投结果。');
              return;
            }
            rooms.get(roomId).lastActivity = Date.now();
            broadcastToRoom(roomId, { type: 'DICE_DIE_REROLL_RESULT', payload: { id, requestId, notation, result, rerolledDieIds, rerolls } });
            break;
          }

          case 'DICE_ROLL_DISMISS': {
            // 任意一端（通常是遥控器点"收起"）主动关闭结果展示：转发给房间内所有客户端，
            // 主屏幕收到后立刻收起全屏遮罩，不用等倒计时自然结束；
            // 其他遥控器收到后也同步清掉自己本地展示的结果横幅，保持所有端一致。
            const { roomId, id } = payload || {};
            if (!isCurrentRoomMember(ws, roomId) || ws.isDisplay) {
              sendWsError(ws, '无权收起该房间的骰盘。');
              return;
            }
            rooms.get(roomId).lastActivity = Date.now();
            broadcastToRoom(roomId, { type: 'DICE_ROLL_DISMISS', payload: { id } });
            break;
          }

          case 'PING': {
            // 心跳也算"活动"：只要客户端还连着、还在正常发心跳，就不该被当成"空闲房间"清理掉。
            // 没有这一行的话，一个打开了很久但角色/回合数一直没变化的房间，光靠心跳是保不住的，
            // 1小时后会被下面的定时清理误删，即使遥控器和主屏幕其实都还稳稳连着。
            if (ws.roomId && rooms.has(ws.roomId)) {
              rooms.get(ws.roomId).lastActivity = Date.now();
            }
            ws.send(JSON.stringify({ type: 'PONG' }));
            break;
          }

          default:
            console.log(`⚠️ 未知消息类型: ${type}`);
        }
      } catch (error) {
        console.error('❌ 消息处理错误:', error);
        ws.send(JSON.stringify({ type: 'ERROR', payload: { message: '服务器错误' } }));
      }
    });

    ws.on('close', () => {
      if (ws.roomId) {
        console.log(`👋 客户端断开连接 (房间: ${ws.roomId})`);

        // 如果是主屏幕断开，只标记状态、不删除房间数据，
        // 房间数据保留等待主屏幕刷新重连（走CREATE_ROOM的重连分支）
        if (ws.isDisplay && rooms.has(ws.roomId)) {
          console.log(`⚠️ 主屏幕断开，保留房间数据等待重连: ${ws.roomId}`);
          const room = rooms.get(ws.roomId);
          room.displayConnected = false;
          room.lastActivity = Date.now();

          broadcastToRoom(ws.roomId, { type: 'DISPLAY_STATUS', payload: { connected: false } });
        }
      } else {
        console.log('👋 客户端断开连接');
      }
    });

    ws.on('error', (error) => {
      console.error('❌ WebSocket错误:', error);
    });
  });

  // 房间是否还有客户端连着（主屏幕或遥控器，任意一个OPEN状态的连接都算）。
  // 清理时优先看这个，而不是只看lastActivity时间戳——
  // 只要还有人连着，这个房间就不该被清理，不管战斗数据本身多久没变化过。
  function roomHasLiveClients(roomId) {
    for (const client of wss.clients) {
      if (client.roomId === roomId && client.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  // 房间空闲多久、多久检查一次，都可以通过环境变量调（方便测试，生产默认值不变：1小时/5分钟）
  const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MS || 60 * 60 * 1000);
  const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS || 5 * 60 * 1000);

  // 定期清理过期房间：只清理"没有任何客户端连接、且超过ROOM_IDLE_MS无活动"的房间。
  // 有主屏幕或遥控器连着的房间永远不会被这个定时器清理，不管开着放多久不动。
  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    rooms.forEach((room, roomId) => {
      if (roomHasLiveClients(roomId)) return; // 还有人连着，跳过

      const lastActive = room.lastActivity || room.createdAt;
      if (now - lastActive > ROOM_IDLE_MS) {
        console.log(`🗑️ 清理过期房间（无人连接且长时间无活动）: ${roomId}`);
        rooms.delete(roomId);
      }
    });
  }, CLEANUP_INTERVAL_MS);

  return { wss, rooms, cleanupTimer };
}

module.exports = { createRoomServer };
