#!/usr/bin/env node
/**
 * 扫描 public/image/Kards 的卡图目录结构，生成 data/kards/cards.json 目录。
 *
 * 目录约定（与资源本身的组织方式一致）：
 *   <阵营>/<Nk>/<中文名>[_<英文名>]_<slug>.png
 * 例如：德国/1k/Pak 36 反坦克炮_pak_36.png
 *
 * 卡图本身就是完整卡牌（数值、类型、效果都印在图上），因此目录只记录
 * 浏览/搜索/组牌需要的轻量元数据：id、名称、阵营、费用、图片路径。
 *
 * 用法：node scripts/build-kards-catalog.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kardsRoot = path.join(projectRoot, 'public', 'image', 'Kards');
const outFile = path.join(projectRoot, 'data', 'kards', 'cards.json');

const FACTION_ORDER = [
  '美国', '德国', '苏联', '英国', '日本',
  '法国', '意大利', '波兰', '芬兰', '澳新军团', '中立',
];

function parseFileName(fileName) {
  const base = fileName.replace(/\.(png|jpg|jpeg|webp)$/i, '');
  const underscore = base.lastIndexOf('_');
  if (underscore <= 0 || underscore === base.length - 1) {
    return { name: base, slug: '' };
  }
  const namePart = base.slice(0, underscore).replace(/_+/g, ' ').trim();
  return { name: namePart, slug: base.slice(underscore + 1) };
}

function build() {
  if (!fs.existsSync(kardsRoot)) {
    console.error(`找不到 Kards 卡图目录: ${kardsRoot}`);
    process.exit(1);
  }

  const factions = fs.readdirSync(kardsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const cards = [];
  const costByFaction = new Map();

  for (const faction of factions) {
    const factionDir = path.join(kardsRoot, faction);
    const costDirs = fs.readdirSync(factionDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\dk$/.test(entry.name))
      .sort((a, b) => Number(a.name[0]) - Number(b.name[0]));

    for (const costDir of costDirs) {
      const cost = Number(costDir.name[0]);
      const dirPath = path.join(factionDir, costDir.name);
      const files = fs.readdirSync(dirPath)
        .filter((file) => /\.(png|jpg|jpeg|webp)$/i.test(file))
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

      for (const file of files) {
        const { name, slug } = parseFileName(file);
        cards.push({
          id: `${faction}/${costDir.name}/${file}`,
          name: name || file,
          slug,
          faction,
          cost,
          path: `/image/Kards/${faction}/${costDir.name}/${file}`,
        });
      }
      costByFaction.set(faction, (costByFaction.get(faction) || []).concat([cost]));
    }
  }

  const sortedFactions = [
    ...FACTION_ORDER.filter((f) => factions.includes(f)),
    ...factions.filter((f) => !FACTION_ORDER.includes(f)),
  ];

  const catalog = {
    generatedAt: new Date().toISOString(),
    total: cards.length,
    factions: sortedFactions,
    costs: Array.from(new Set(cards.map((card) => card.cost))).sort((a, b) => a - b),
    cards,
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(catalog, null, 2), 'utf8');

  console.log(`✔ 已生成卡牌目录: ${outFile}`);
  console.log(`  共 ${cards.length} 张卡，${sortedFactions.length} 个阵营`);
  for (const faction of sortedFactions) {
    const costs = costByFaction.get(faction) || [];
    const count = cards.filter((card) => card.faction === faction).length;
    console.log(`  ${faction}: ${count} 张（费用 ${costs.join('/') || '-'}）`);
  }
}

build();
