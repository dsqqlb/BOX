// 快速测试服务是否正常运行（房间同步WebSocket）
// 页面和WebSocket共用同一个端口，所以这里连的就是访问站点的那个端口 + /ws 路径
const WebSocket = require('ws');

const PORT = process.env.PORT || 9999;
const URL = `ws://localhost:${PORT}/ws`;

console.log(`🔍 测试连接到 ${URL} ...`);

const ws = new WebSocket(URL);

ws.on('open', () => {
  console.log('✅ WebSocket连接成功！');
  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket连接失败:', error.message);
  console.error('   请确认服务已启动：开发用 npm run dev，生产用 npm start');
  process.exit(1);
});

// 5秒超时
setTimeout(() => {
  console.error('❌ 连接超时');
  process.exit(1);
}, 5000);
