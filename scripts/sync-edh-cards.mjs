#!/usr/bin/env node
/**
 * EDH 组卡台 - 卡牌数据同步脚本
 *
 * 做两件事：
 *   1. 下载 Scryfall 的 oracle_cards 批量数据（每个 oracle_id 一张代表印刷版，英文为主），
 *      裁剪成组卡台需要的精简字段，写入 data/edh/cards.json。
 *   2. 分页抓取 lang:zhs（简体）和 lang:zht（繁体）的搜索结果，只提取「oracle_id -> 中文名/中文类型/中文文字」
 *      的对照表，合并进上面的数据里。没有中文版的卡保留英文原名作为兜底。
 *
 * 图片不下载：所有图片字段都是 Scryfall CDN 的 URL，浏览器直接从 Scryfall 加载。
 *
 * 用法：
 *   npm run sync:edh-cards
 *
 * 注意：这一步会向 api.scryfall.com 和 data.scryfall.io 发出网络请求，下载公开的卡牌数据
 * （不涉及账户或隐私数据）。首次同步全量数据大概几分钟，取决于网络状况。
 */

import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'data', 'edh');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'cards.json');

// Scryfall 要求所有调用方提供自定义 User-Agent，否则会拒绝请求（这不是密钥，是身份标识）。
const USER_AGENT = 'BOX-EDH-Builder/1.0 (self-hosted personal tool)';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

// 不属于「可以被组进牌组」的卡牌形态：代币、纹章、先驱者、诡局、异界位面等游戏配件。
const EXCLUDED_LAYOUTS = new Set([
  'token',
  'emblem',
  'vanguard',
  'scheme',
  'plane',
  'phenomenon',
  'art_series',
  'double_faced_token',
]);

// Scryfall 建议的请求间隔（避免触发限流），单位毫秒。搜索接口比bulk-data更容易被限流，间隔要更保守。
const REQUEST_DELAY_MS = 400;
const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 请求 JSON：限流或网络超时都按指数退避重试，避免某一页无限挂起。 */
async function fetchJson(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.status === 429 && attempt <= MAX_RETRIES) {
      const retryAfterHeader = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : 1000 * 2 ** attempt;
      console.warn(`  ⏳ 被限流（429），等待 ${Math.round(waitMs / 1000)}s 后重试（第 ${attempt}/${MAX_RETRIES} 次）...`);
      await sleep(waitMs);
      return fetchJson(url, attempt + 1);
    }
    if (!response.ok) throw new Error(`请求失败 ${response.status} ${response.statusText}：${url}`);
    return response.json();
  } catch (error) {
    if (attempt > MAX_RETRIES) throw error;
    const waitMs = 1000 * 2 ** attempt;
    console.warn(`  ⏳ 请求超时或失败，${Math.round(waitMs / 1000)}s 后重试（第 ${attempt}/${MAX_RETRIES} 次）...`);
    await sleep(waitMs);
    return fetchJson(url, attempt + 1);
  }
}

/** 从 bulk-data 列表中找到 oracle_cards 的下载地址。 */
async function getOracleCardsDownloadUri() {
  const listing = await fetchJson('https://api.scryfall.com/bulk-data');
  const entry = listing.data.find((item) => item.type === 'oracle_cards');
  if (!entry) throw new Error('未能在 Scryfall bulk-data 列表中找到 oracle_cards。');
  return entry.jsonl_download_uri;
}

/** 判断一张卡是否具备「可以担任指挥官」的资格（传奇生物，或文字明确写了可以当指挥官）。 */
function isCommanderEligible(card) {
  const typeLine = card.type_line || '';
  const isLegendaryCreature = typeLine.includes('Legendary') && typeLine.includes('Creature');
  const oracleText = card.oracle_text || (card.card_faces || []).map((face) => face.oracle_text || '').join('\n');
  const explicitlyAllowed = /can be your commander/i.test(oracleText);
  return isLegendaryCreature || explicitlyAllowed;
}

/** 从原始 Scryfall 卡牌对象里，裁出组卡台真正需要的字段。 */
function toSlimCard(card) {
  const faces = Array.isArray(card.card_faces) && card.card_faces.length > 0 ? card.card_faces : null;
  const primaryImages = card.image_uris || faces?.[0]?.image_uris || null;

  return {
    oracleId: card.oracle_id,
    name: card.name,
    nameZh: null, // 由中文对照表合并阶段填充
    manaCost: card.mana_cost || faces?.map((face) => face.mana_cost || '').join(' // ') || '',
    cmc: typeof card.cmc === 'number' ? card.cmc : 0,
    typeLine: card.type_line || '',
    typeLineZh: null,
    oracleText: card.oracle_text || faces?.map((face) => face.oracle_text || '').filter(Boolean).join('\n---\n') || '',
    oracleTextZh: null,
    flavorText: card.flavor_text || '',
    flavorTextZh: null,
    artist: card.artist || '',
    legalities: card.legalities || {},
    reprint: card.reprint === true,
    powerNumeric: /^-?\d+(?:\.\d+)?$/.test(String(card.power ?? faces?.[0]?.power ?? '')) ? Number(card.power ?? faces?.[0]?.power) : null,
    toughnessNumeric: /^-?\d+(?:\.\d+)?$/.test(String(card.toughness ?? faces?.[0]?.toughness ?? '')) ? Number(card.toughness ?? faces?.[0]?.toughness) : null,
    colors: card.colors || faces?.flatMap((face) => face.colors || []) || [],
    colorIdentity: card.color_identity || [],
    keywords: card.keywords || [],
    power: card.power ?? faces?.[0]?.power ?? null,
    toughness: card.toughness ?? faces?.[0]?.toughness ?? null,
    loyalty: card.loyalty ?? faces?.[0]?.loyalty ?? null,
    rarity: card.rarity || 'common',
    set: card.set || '',
    setName: card.set_name || '',
    collectorNumber: card.collector_number || '',
    layout: card.layout || 'normal',
    legalCommander: card.legalities?.commander || 'not_legal',
    edhrecRank: typeof card.edhrec_rank === 'number' ? card.edhrec_rank : null,
    isCommanderEligible: isCommanderEligible(card),
    image: primaryImages ? { small: primaryImages.small, normal: primaryImages.normal, artCrop: primaryImages.art_crop } : null,
    faces: faces
      ? faces.map((face) => ({
          name: face.name,
          manaCost: face.mana_cost || '',
          typeLine: face.type_line || '',
          oracleText: face.oracle_text || '',
          power: face.power ?? null,
          toughness: face.toughness ?? null,
          image: face.image_uris ? { small: face.image_uris.small, normal: face.image_uris.normal, artCrop: face.image_uris.art_crop } : null,
        }))
      : null,
  };
}

/** 流式下载 + gunzip + 按行解析 oracle_cards.jsonl.gz，避免把上百MB解压结果全部放进内存字符串。 */
async function downloadAndParseOracleCards(downloadUri, onCard) {
  const response = await fetch(downloadUri, { headers: HEADERS });
  if (!response.ok) throw new Error(`下载卡牌数据失败 ${response.status} ${response.statusText}`);

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(response.body);
  const lineReader = createInterface({ input: nodeStream.pipe(gunzip) });

  let count = 0;
  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[' || trimmed === ']') continue;
    // Scryfall 的 bulk jsonl 每行是一个卡牌对象，可能带尾随逗号（旧格式JSON数组每行）。
    const jsonText = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
    let card;
    try {
      card = JSON.parse(jsonText);
    } catch {
      continue; // 跳过无法解析的行，不让单行脏数据中断整个同步
    }
    if (EXCLUDED_LAYOUTS.has(card.layout)) continue;
    if (card.digital) continue; // 只保留实体牌，不含纯数字版本（如 Alchemy 重铸）
    onCard(card);
    count += 1;
  }
  return count;
}

/** 分页抓取某个语言的搜索结果，产出 oracle_id -> 中文字段 的条目。 */
async function fetchLocalizedNames(langCode, onEntry) {
  let url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`lang:${langCode}`)}&order=name&unique=cards`;
  let page = 0;
  let total = 0;

  while (url) {
    page += 1;
    let payload;
    try {
      payload = await fetchJson(url);
    } catch (error) {
      console.warn(`  ⚠️  第 ${page} 页拉取失败（${langCode}）：${error.message}，跳过剩余页。`);
      break;
    }
    for (const card of payload.data || []) {
      if (!card.oracle_id || !card.printed_name) continue;
      onEntry(card.oracle_id, {
        name: card.printed_name,
        typeLine: card.printed_type_line || null,
        oracleText: card.printed_text || null,
        flavorText: card.flavor_text || null,
      });
      total += 1;
    }
    url = payload.has_more ? payload.next_page : null;
    if (url) await sleep(REQUEST_DELAY_MS);
  }
  return total;
}

async function main() {
  console.log('🔄 EDH 卡牌数据同步开始...\n');
  await mkdir(OUTPUT_DIR, { recursive: true });

  console.log('① 定位 Scryfall oracle_cards 批量数据下载地址...');
  const downloadUri = await getOracleCardsDownloadUri();
  console.log(`   → ${downloadUri}\n`);

  console.log('② 下载并解析英文卡牌数据（流式处理，不会把整份文件读进内存）...');
  const cardsByOracleId = new Map();
  const startedAt = Date.now();
  const total = await downloadAndParseOracleCards(downloadUri, (card) => {
    cardsByOracleId.set(card.oracle_id, toSlimCard(card));
  });
  console.log(`   → 已收录 ${total} 张唯一卡牌，用时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  console.log('③ 抓取简体中文（zhs）卡名对照表...');
  let zhsCount = 0;
  await fetchLocalizedNames('zhs', (oracleId, zh) => {
    const card = cardsByOracleId.get(oracleId);
    if (!card) return;
    card.nameZh = zh.name;
    card.typeLineZh = zh.typeLine;
    card.oracleTextZh = zh.oracleText;
    card.flavorTextZh = zh.flavorText;
    zhsCount += 1;
  });
  console.log(`   → 简体中文覆盖 ${zhsCount} 张\n`);

  console.log('④ 抓取繁体中文（zht）卡名对照表（仅补充简体未覆盖的卡）...');
  let zhtCount = 0;
  await fetchLocalizedNames('zht', (oracleId, zh) => {
    const card = cardsByOracleId.get(oracleId);
    if (!card || card.nameZh) return; // 简体已覆盖的优先，不用繁体覆盖
    card.nameZh = zh.name;
    card.typeLineZh = zh.typeLine;
    card.oracleTextZh = zh.oracleText;
    card.flavorTextZh = zh.flavorText;
    zhtCount += 1;
  });
  console.log(`   → 繁体中文补充 ${zhtCount} 张\n`);

  const cards = Array.from(cardsByOracleId.values());
  const withChinese = cards.filter((card) => card.nameZh).length;
  console.log('⑤ 写入本地数据文件...');

  const payload = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    cardCount: cards.length,
    chineseCoverage: withChinese,
    source: 'https://scryfall.com',
    cards,
  };

  // 先写临时文件再原子重命名，避免同步中途失败导致 cards.json 半成品损坏服务运行。
  const tempFile = `${OUTPUT_FILE}.tmp`;
  await writeFile(tempFile, JSON.stringify(payload), 'utf8');
  await rename(tempFile, OUTPUT_FILE);

  console.log(`   → 已写入 ${OUTPUT_FILE}`);
  console.log(`\n✅ 同步完成：共 ${cards.length} 张卡，其中 ${withChinese} 张（${((withChinese / cards.length) * 100).toFixed(1)}%）有中文名。`);
  console.log('   没有官方中文版的卡会在搜索/展示时使用英文名兜底。');
}

main().catch((error) => {
  console.error('\n❌ 同步失败：', error.message);
  process.exit(1);
});
