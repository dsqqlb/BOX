'use strict';

/**
 * EDH 组卡台：卡牌数据库加载与搜索。
 *
 * 卡牌数据库文件较大（几十MB），进程内缓存一份，只有文件修改时间变化（重新跑同步脚本后）才重新读取。
 */

const fs = require('fs');
const { EDH_CARDS_FILE } = require('./config');

let edhCardCache = null; // { mtimeMs, generatedAt, cardCount, chineseCoverage, cards, byOracleId }

function loadEdhCardDatabase() {
  let stat;
  try {
    stat = fs.statSync(EDH_CARDS_FILE);
  } catch {
    return null; // 尚未同步过卡牌数据
  }
  if (edhCardCache && edhCardCache.mtimeMs === stat.mtimeMs) return edhCardCache;

  const raw = JSON.parse(fs.readFileSync(EDH_CARDS_FILE, 'utf-8'));
  const byOracleId = new Map(raw.cards.map((card) => [card.oracleId, card]));
  edhCardCache = {
    mtimeMs: stat.mtimeMs,
    generatedAt: raw.generatedAt,
    cardCount: raw.cardCount,
    chineseCoverage: raw.chineseCoverage,
    cards: raw.cards,
    byOracleId,
  };
  return edhCardCache;
}

const WUBRG_ORDER = ['W', 'U', 'B', 'R', 'G'];

function normalizeSearchText(value) {
  return String(value || '').toLowerCase().trim();
}

function cardMatchesKeyword(card, keyword, field = 'all') {
  if (!keyword) return true;
  const fields = {
    name: [card.name, card.nameZh],
    type: [card.typeLine, card.typeLineZh],
    oracle: [card.oracleText, card.oracleTextZh],
    flavor: [card.flavorText, card.flavorTextZh],
    artist: [card.artist],
  };
  const haystacks = field === 'all' ? Object.values(fields).flat() : (fields[field] || fields.name);
  return haystacks.some((value) => value && normalizeSearchText(value).includes(keyword));
}

function numberParam(value) {
  return value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
}

function inRange(value, min, max) {
  if (min === null && max === null) return true;
  if (!Number.isFinite(value)) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

/** 颜色identity过滤：exact=正好这些颜色（含无色）；subset=不超出这些颜色（组牌时最常用，允许该颜色的子集）。 */
function cardMatchesColors(card, colors, mode) {
  if (!colors || colors.length === 0) return true;
  const cardColors = new Set(card.colorIdentity || []);
  if (mode === 'exact') {
    return cardColors.size === colors.length && colors.every((color) => cardColors.has(color));
  }
  return [...cardColors].every((color) => colors.includes(color));
}

function searchEdhCards(database, params) {
  const keyword = normalizeSearchText(params.q);
  const searchField = ['all', 'name', 'type', 'oracle', 'flavor', 'artist'].includes(params.searchField) ? params.searchField : 'all';
  const colors = Array.isArray(params.colors) ? params.colors.filter((color) => WUBRG_ORDER.includes(color)) : [];
  const colorMode = params.colorMode === 'exact' ? 'exact' : 'subset';
  const types = Array.isArray(params.types) ? params.types.map(normalizeSearchText).filter(Boolean) : [];
  const rarities = Array.isArray(params.rarities) ? params.rarities.filter((rarity) => ['common', 'uncommon', 'rare', 'mythic'].includes(rarity)) : [];
  const cmcMin = numberParam(params.cmcMin);
  const cmcMax = numberParam(params.cmcMax);
  const powerMin = numberParam(params.powerMin);
  const powerMax = numberParam(params.powerMax);
  const toughnessMin = numberParam(params.toughnessMin);
  const toughnessMax = numberParam(params.toughnessMax);
  const format = typeof params.format === 'string' ? params.format.toLowerCase() : '';
  const commanderOnly = params.commanderOnly === true;
  const nonReprint = params.nonReprint === true;
  const limit = Math.min(Math.max(Number(params.limit) || 60, 1), 120);

  const filtered = database.cards.filter((card) => {
    if (!cardMatchesKeyword(card, keyword, searchField)) return false;
    if (!cardMatchesColors(card, colors, colorMode)) return false;
    if (types.length > 0 && !types.every((type) => normalizeSearchText(card.typeLine).includes(type))) return false;
    if (rarities.length > 0 && !rarities.includes(card.rarity)) return false;
    if (!inRange(card.cmc, cmcMin, cmcMax)) return false;
    if (!inRange(card.powerNumeric, powerMin, powerMax)) return false;
    if (!inRange(card.toughnessNumeric, toughnessMin, toughnessMax)) return false;
    if (format && (card.legalities?.[format] || 'not_legal') !== 'legal') return false;
    if (nonReprint && card.reprint !== false) return false;
    if (commanderOnly && !card.isCommanderEligible) return false;
    if (card.legalCommander === 'banned') return false;
    return true;
  });

  filtered.sort((a, b) => {
    const rankA = a.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.edhrecRank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.name.localeCompare(b.name);
  });
  return { total: filtered.length, cards: filtered.slice(0, limit) };
}

module.exports = { loadEdhCardDatabase, searchEdhCards };
