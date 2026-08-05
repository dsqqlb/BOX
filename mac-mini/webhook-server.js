/**
 * GitHub Webhook 接收服务：比轮询方案(auto-deploy-poll.sh)更"即时"，
 * push 后 GitHub 主动通知，几秒内触发部署，而不是等轮询间隔。
 *
 * 使用前提：这台Mac mini需要能被GitHub访问到（比如已经配置了 Cloudflare Tunnel/frp/公网IP+端口转发），
 * 否则GitHub发不出webhook请求，请优先使用 auto-deploy-poll.sh 轮询方案（不需要暴露任何端口）。
 *
 * 用法：
 *   WEBHOOK_SECRET=xxx node mac-mini/webhook-server.js
 * 然后在 GitHub 仓库 Settings -> Webhooks 添加：
 *   Payload URL: http://你的地址:9000/webhook
 *   Content type: application/json
 *   Secret: 和 WEBHOOK_SECRET 保持一致
 *   事件: 只勾选 "Just the push event"
 */
const http = require('http');
const crypto = require('crypto');
const { exec } = require('child_process');
const path = require('path');

const PORT = process.env.WEBHOOK_PORT || 9000;
const SECRET = process.env.WEBHOOK_SECRET || '';
const DEPLOY_SCRIPT = path.join(__dirname, 'deploy.sh');

if (!SECRET) {
  console.warn('⚠️  未设置 WEBHOOK_SECRET，任何人都能触发部署请求，强烈建议设置一个密钥！');
}

// 校验 GitHub 的签名（x-hub-signature-256），确保请求真的来自 GitHub，不是被人乱触发部署
function verifySignature(payload, signature) {
  if (!SECRET) return true; // 没配置密钥时不校验（仅用于本地测试，生产环境务必设置SECRET）
  if (!signature) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', SECRET).update(payload).digest('hex');

  // 用timingSafeEqual避免时序攻击；长度不一致时直接判false
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

let isDeploying = false;

function runDeploy() {
  if (isDeploying) {
    console.log('⏳ 已有部署在进行中，跳过本次触发');
    return;
  }
  isDeploying = true;
  console.log(`🚀 [${new Date().toISOString()}] 开始执行部署脚本...`);

  exec(`bash "${DEPLOY_SCRIPT}"`, { maxBuffer: 1024 * 1024 * 20 }, (err, stdout, stderr) => {
    isDeploying = false;
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) {
      console.error('❌ 部署脚本执行失败:', err.message);
    } else {
      console.log(`✅ [${new Date().toISOString()}] 部署完成`);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404).end('Not Found');
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const signature = req.headers['x-hub-signature-256'];

    if (!verifySignature(body, signature)) {
      console.warn('❌ 签名校验失败，拒绝请求');
      res.writeHead(401).end('Invalid signature');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }

    const branch = (payload.ref || '').replace('refs/heads/', '');
    console.log(`📨 收到 push 事件，分支: ${branch}`);

    if (branch === 'main') {
      res.writeHead(200).end('Deploy triggered');
      runDeploy();
    } else {
      res.writeHead(200).end(`Ignored (branch: ${branch})`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Webhook 服务已启动，监听端口 ${PORT}`);
  console.log(`📡 GitHub Webhook 地址应设置为: http://<你的地址>:${PORT}/webhook`);
});
