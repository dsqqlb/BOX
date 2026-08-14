'use strict';

const crypto = require('crypto');

function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = '';
    stdout.write(question);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      if (chunk === '\r' || chunk === '\n') {
        stdin.off('data', onData);
        stdin.setRawMode?.(false);
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (chunk === '\u0003') process.exit(130);
      if (chunk === '\u007f' || chunk === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += chunk;
    };
    stdin.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) throw new Error('请在交互式终端中运行此工具。');
  const password = await askHidden('输入密码（不会显示）：');
  const confirmation = await askHidden('再次输入密码：');
  if (password.length < 4) throw new Error('密码至少需要 4 个字符。');
  if (password !== confirmation) throw new Error('两次输入的密码不一致。');

  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 });
  console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}`);
}

main().catch((error) => {
  console.error(`生成密码哈希失败：${error.message}`);
  process.exit(1);
});
