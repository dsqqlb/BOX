#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 目录布局：ops/scripts/ → ops/ → 项目根
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CODE_ROOT = path.join(PROJECT_ROOT, 'code');
const DATA_DIR = path.join(PROJECT_ROOT, 'resources', 'data');
const ENV_FILE = path.join(PROJECT_ROOT, 'resources', '.env.local');

// Prisma CLI 不会读取项目的 .env.local，这里手动加载同名配置（已存在的环境变量优先）。
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    const [, key, rawValue] = match;
    const value = (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
    process.env[key] = value;
  }
}
loadEnvFile(ENV_FILE);

// 给本地 SQLite 一条与运行时（code/server/db.js）完全一致的默认路径。
// 固定用绝对路径，避免 Prisma 按 schema 所在目录解析出第二种相对路径。
process.env.DATABASE_URL ||= `file:${path.join(DATA_DIR, 'box.sqlite').replace(/\\/g, '/')}`;

const executable = process.platform === 'win32'
  ? path.join(CODE_ROOT, 'node_modules', '.bin', 'prisma.cmd')
  : path.join(CODE_ROOT, 'node_modules', '.bin', 'prisma');
const result = spawnSync(executable, process.argv.slice(2), {
  stdio: 'inherit',
  env: process.env,
  // schema 与 migrations 都在 code/prisma 下，必须在 code/ 里执行 CLI。
  cwd: CODE_ROOT,
  shell: process.platform === 'win32',
});
if (result.error) {
  console.error(`\n无法执行 Prisma CLI（${executable}）：${result.error.message}`);
  console.error('   看起来依赖没有安装完整。请先在 code/ 目录执行：npm install');
  process.exit(1);
}
process.exit(result.status ?? 1);
