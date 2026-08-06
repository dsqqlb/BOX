const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 怪物图片目录：命名规则为"中文名_英文标识.png"（如 哥布林弓手_goblin_archer.png）
// 没有中文前缀的旧文件名会原样兜底（key=name=文件名本身）
const ENEMY_DIR = path.join(__dirname, '..', 'public', 'image', 'enemies');
const VALID_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const CN_PREFIX_PATTERN = /^([\u4e00-\u9fa5]+)_(.+)$/;

function parseEnemyFilename(filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, -ext.length);
  const match = base.match(CN_PREFIX_PATTERN);
  if (match) {
    const [, name, key] = match;
    return { key, name };
  }
  return { key: base, name: base };
}

// 每次调用都实时扫描目录，新增/改名图片后无需重启服务，刷新页面即可生效
function getEnemyList() {
  if (!fs.existsSync(ENEMY_DIR)) return [];

  const files = fs
    .readdirSync(ENEMY_DIR)
    .filter((f) => VALID_IMAGE_EXT.has(path.extname(f).toLowerCase()));

  const byKey = new Map();
  for (const file of files) {
    const { key, name } = parseEnemyFilename(file);
    byKey.set(key, { key, name, file });
  }

  return Array.from(byKey.values()).sort((a, b) => a.key.localeCompare(b.key));
}

// 玩家立绘目录：public/image/player/<种族名>_<英文>/<职业名>.png
// 每个种族一个子文件夹，文件夹名同样是"中文_英文"格式；职业文件名就是中文职业名（或"其他N"占位图）
const PLAYER_DIR = path.join(__dirname, '..', 'public', 'image', 'player');

function getPlayerImageList() {
  if (!fs.existsSync(PLAYER_DIR)) return [];

  const raceDirs = fs
    .readdirSync(PLAYER_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const result = [];
  for (const dir of raceDirs) {
    const match = dir.name.match(CN_PREFIX_PATTERN);
    const raceName = match ? match[1] : dir.name;
    const raceEn = match ? match[2] : dir.name;

    const raceDirPath = path.join(PLAYER_DIR, dir.name);
    const files = fs
      .readdirSync(raceDirPath)
      .filter((f) => VALID_IMAGE_EXT.has(path.extname(f).toLowerCase()));

    for (const file of files) {
      const ext = path.extname(file);
      const className = file.slice(0, -ext.length); // 职业名，如"战士"、"其他1"
      // key用种族英文+职业名拼接，保证跨种族不重名；name是给人看的完整显示名
      const key = `${raceEn}__${className}`;
      result.push({
        key,
        name: `${raceName} · ${className}`,
        race: raceName,
        raceEn,
        className,
        file: `${dir.name}/${file}`, // 相对 public/image/player 的路径
      });
    }
  }

  return result.sort((a, b) => a.key.localeCompare(b.key));
}

// 创建HTTP服务器：常规HTTP请求走这里，WebSocket升级请求由ws库单独处理，互不干扰
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/enemies') {
    const list = getEnemyList();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(list));
    return;
  }

  if (req.method === 'GET' && req.url === '/player-images') {
    const list = getPlayerImageList();
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(list));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});
const wss = new WebSocket.Server({ server });

// 存储所有房间的数据
const rooms = new Map();

// 广播函数：向房间内所有客户端发送消息
function broadcastToRoom(roomId, message, excludeClient = null) {
  wss.clients.forEach(client => {
    if (
      client.readyState === WebSocket.OPEN &&
      client.roomId === roomId &&
      client !== excludeClient
    ) {
      client.send(JSON.stringify(message));
    }
  });
}

// WebSocket连接处理
wss.on('connection', (ws) => {
  console.log('🔌 新客户端连接');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      const { type, payload } = message;
      
      console.log('📨 收到消息:', type, payload);

      switch (type) {
        case 'CREATE_ROOM': {
          // 主屏幕创建房间（或断线后重新连回同一个房间）
          const { roomId } = payload;
          const now = Date.now();
          const isReconnect = rooms.has(roomId);
          
          if (!isReconnect) {
            rooms.set(roomId, {
              roomId,
              characters: [],
              currentTurn: 0,
              roundNumber: 1,
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
          
          // 发送当前房间状态
          ws.send(JSON.stringify({
            type: 'ROOM_STATE',
            payload: room,
          }));
          
          // 通知房间内所有遥控器：主屏幕已连接/重连
          if (isReconnect) {
            broadcastToRoom(roomId, {
              type: 'DISPLAY_STATUS',
              payload: { connected: true },
            }, ws);
          }
          break;
        }

        case 'JOIN_ROOM': {
          // 遥控器加入房间
          const { roomId } = payload;
          
          if (!rooms.has(roomId)) {
            // 房间不存在
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: '房间不存在' },
            }));
            console.log(`❌ 尝试加入不存在的房间: ${roomId}`);
            return;
          }
          
          const room = rooms.get(roomId);
          room.lastActivity = Date.now();
          
          ws.roomId = roomId;
          ws.isDisplay = false;
          
          console.log(`🎮 遥控器加入房间 ${roomId}`);
          
          // 发送当前房间状态
          ws.send(JSON.stringify({
            type: 'ROOM_STATE',
            payload: room,
          }));
          
          // 同步告知遥控器主屏幕当前的在线状态
          ws.send(JSON.stringify({
            type: 'DISPLAY_STATUS',
            payload: { connected: room.displayConnected !== false },
          }));
          break;
        }

        case 'UPDATE_ROOM': {
          // 更新房间状态
          const { roomId, updates } = payload;
          
          if (!rooms.has(roomId)) {
            console.log(`❌ 房间不存在: ${roomId}`);
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: '房间已失效，请重新连接' },
            }));
            return;
          }
          
          const room = rooms.get(roomId);
          Object.assign(room, updates);
          room.lastActivity = Date.now();
          rooms.set(roomId, room);
          
          console.log(`🔄 房间更新: ${roomId}`, Object.keys(updates));
          
          // 广播给房间内所有客户端
          broadcastToRoom(roomId, {
            type: 'ROOM_STATE',
            payload: room,
          });
          break;
        }

        case 'PING': {
          // 心跳检测
          ws.send(JSON.stringify({ type: 'PONG' }));
          break;
        }

        default:
          console.log(`⚠️ 未知消息类型: ${type}`);
      }
    } catch (error) {
      console.error('❌ 消息处理错误:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        payload: { message: '服务器错误' },
      }));
    }
  });

  ws.on('close', () => {
    if (ws.roomId) {
      console.log(`👋 客户端断开连接 (房间: ${ws.roomId})`);
      
      // 如果是主屏幕断开，只标记状态，不删除房间数据
      // 房间数据会保留，等待主屏幕刷新重连（走CREATE_ROOM的重连分支）
      if (ws.isDisplay && rooms.has(ws.roomId)) {
        console.log(`⚠️ 主屏幕断开，保留房间数据等待重连: ${ws.roomId}`);
        const room = rooms.get(ws.roomId);
        room.displayConnected = false;
        room.lastActivity = Date.now();
        
        // 通知房间内所有遥控器：主屏幕已断开
        broadcastToRoom(ws.roomId, {
          type: 'DISPLAY_STATUS',
          payload: { connected: false },
        });
      }
    } else {
      console.log('👋 客户端断开连接');
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket错误:', error);
  });
});

// 定期清理过期房间（1小时无任何活动，而非1小时无论是否使用）
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  rooms.forEach((room, roomId) => {
    const lastActive = room.lastActivity || room.createdAt;
    if (now - lastActive > oneHour) {
      console.log(`🗑️ 清理过期房间（1小时无活动）: ${roomId}`);
      rooms.delete(roomId);
    }
  });
}, 5 * 60 * 1000); // 每5分钟检查一次

// 启动服务器
const PORT = process.env.WS_PORT || 9998;
const HOST = '0.0.0.0'; // 监听所有网络接口

server.listen(PORT, HOST, () => {
  console.log(`🚀 WebSocket服务器运行在端口 ${PORT}`);
  console.log(`📡 WebSocket地址: ws://localhost:${PORT}`);
  console.log(`📡 网络地址: ws://0.0.0.0:${PORT}`);
  console.log(`✅ 服务器已就绪，等待连接...`);
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n👋 正在关闭服务器...');
  wss.clients.forEach(client => {
    client.close();
  });
  server.close(() => {
    console.log('✅ 服务器已关闭');
    process.exit(0);
  });
});
