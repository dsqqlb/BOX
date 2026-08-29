'use strict';

/**
 * BOX 服务配置：环境变量加载 + 全部运行时常量。
 *
 * 这个模块被其他 server 模块 require 时，会先加载 .env.local（若存在），
 * 保证后续任何模块读取 process.env 时配置已就绪。部署环境传入的同名变量优先，
 * 绝不被本地文件覆盖。
 */

const fs = require('fs');
const path = require('path');

// Next.js 会在自身启动后读取 .env.local，但本文件在它之前运行；本地直接 `npm run dev`
// 时需要先加载认证配置。部署环境传入的同名变量优先，绝不被本地文件覆盖。
function loadLocalEnvironment() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    const [, key, rawValue] = match;
    const value = (rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue;
    process.env[key] = value;
  }
}
loadLocalEnvironment();

const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
const PORT = Number(process.env.PORT || 9999);
const HOST = process.env.HOST || '0.0.0.0';

const PROJECT_ROOT = path.join(__dirname, '..');
// 静态产物目录（生产环境用）：next build + output:'export' 的产物
const STATIC_DIR = path.resolve(process.env.STATIC_DIR || path.join(PROJECT_ROOT, 'out'));
// 图片目录：开发环境直接读 public/image；生产模式默认读取 out/image。
// 如需使用其他目录，可通过 IMAGE_DIR 显式指定。
const IMAGE_DIR = path.resolve(
  process.env.IMAGE_DIR || (DEV ? path.join(PROJECT_ROOT, 'public', 'image') : path.join(STATIC_DIR, 'image'))
);
const ENEMY_DIR = path.join(IMAGE_DIR, 'enemies');
const PLAYER_DIR = path.join(IMAGE_DIR, 'player');
const EDH_CARDS_FILE = path.join(PROJECT_ROOT, 'data', 'edh', 'cards.json');
const KARDS_CARDS_FILE = path.join(PROJECT_ROOT, 'data', 'kards', 'cards.json');

// 所有受保护工具的稳定路由标识。权限配置只使用这些标识，不使用可变的页面标题。
const TOOL_SLUGS = [
  'claude-code-guide',
  'dnd-translator',
  'initiative-tracker',
  'initiative-tracker/display',
  'json-visualizer',
  'tarot-reading',
  'savings-tracker',
  'css-cascade',
  'edh-builder',
  'dnd-character',
  'kards',
  'conways-game-of-life',
];
const TOOL_SLUG_SET = new Set(TOOL_SLUGS);

module.exports = {
  DEV,
  PORT,
  HOST,
  PROJECT_ROOT,
  STATIC_DIR,
  IMAGE_DIR,
  ENEMY_DIR,
  PLAYER_DIR,
  EDH_CARDS_FILE,
  KARDS_CARDS_FILE,
  TOOL_SLUGS,
  TOOL_SLUG_SET,
};
