// 测试WebSocket服务器是否正常运行
const WebSocket = require('ws');

console.log('🔍 测试连接到 ws://localhost:9998...');

const ws = new WebSocket('ws://localhost:9998');

ws.on('open', () => {
  console.log('✅ WebSocket连接成功！');
  ws.close();
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('❌ WebSocket连接失败:', error.message);
  process.exit(1);
});

// 5秒超时
setTimeout(() => {
  console.error('❌ 连接超时');
  process.exit(1);
}, 5000);
