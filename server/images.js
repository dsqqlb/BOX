'use strict';

/**
 * 图片目录扫描（怪物图 / 玩家立绘）。
 *
 * 命名规则：怪物图为"中文名_英文标识.png"；玩家立绘为 player/<种族中文>_<种族英文>/<职业中文>.png。
 * 没有中文前缀的旧文件名会原样兜底（key=name=文件名本身）。
 * 每次调用都实时扫描目录，新增/改名图片后无需重启服务，刷新页面即可生效。
 */

const fs = require('fs');
const path = require('path');
const { ENEMY_DIR, PLAYER_DIR } = require('./config');

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

module.exports = { getEnemyList, getPlayerImageList };
