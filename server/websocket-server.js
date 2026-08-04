const WebSocket = require('ws');
const http = require('http');

// 创建HTTP服务器
const server = http.createServer();
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
          // 主屏幕创建房间
          const { roomId } = payload;
          
          if (!rooms.has(roomId)) {
            rooms.set(roomId, {
              roomId,
              characters: [],
              currentTurn: 0,
              roundNumber: 1,
              createdAt: Date.now(),
            });
            console.log(`🏠 房间创建: ${roomId}`);
          }
          
          ws.roomId = roomId;
          ws.isDisplay = true;
          
          // 发送当前房间状态
          ws.send(JSON.stringify({
            type: 'ROOM_STATE',
            payload: rooms.get(roomId),
          }));
          break;
        }

        case 'JOIN_ROOM': {
          // 遥控器加入房间
          const { roomId, controllerId } = payload;
          
          if (!rooms.has(roomId)) {
            // 房间不存在
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: '房间不存在' },
            }));
            console.log(`❌ 尝试加入不存在的房间: ${roomId}`);
            return;
          }
          
          ws.roomId = roomId;
          ws.controllerId = controllerId;
          ws.isDisplay = false;
          
          console.log(`🎮 遥控器 ${controllerId.slice(0, 8)} 加入房间 ${roomId}`);
          
          // 发送当前房间状态
          ws.send(JSON.stringify({
            type: 'ROOM_STATE',
            payload: rooms.get(roomId),
          }));
          break;
        }

        case 'UPDATE_ROOM': {
          // 更新房间状态
          const { roomId, updates } = payload;
          
          if (!rooms.has(roomId)) {
            console.log(`❌ 房间不存在: ${roomId}`);
            return;
          }
          
          const room = rooms.get(roomId);
          Object.assign(room, updates);
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
      
      // 如果是主屏幕断开，清理房间
      if (ws.isDisplay) {
        console.log(`🗑️ 主屏幕断开，清理房间: ${ws.roomId}`);
        rooms.delete(ws.roomId);
      }
    } else {
      console.log('👋 客户端断开连接');
    }
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket错误:', error);
  });
});

// 定期清理过期房间（1小时无活动）
setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  rooms.forEach((room, roomId) => {
    if (now - room.createdAt > oneHour) {
      console.log(`🗑️ 清理过期房间: ${roomId}`);
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
