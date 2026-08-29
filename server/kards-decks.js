'use strict';

/**
 * Kards 牌组：SQLite 按账户隔离，cardsJson 存"卡牌 id 数组（含重复=多张）"。
 *
 * 目录 data/kards/cards.json 是纯展示元数据（名称/阵营/费用/图片路径），
 * 卡图上的数值与效果文本不参与服务端逻辑——规则由玩家自己掌握（TTS 式桌游）。
 */

const fs = require('fs');
const { prisma } = require('./db');
const { KARDS_CARDS_FILE } = require('./config');

const MAX_CARDS_PER_DECK = 200;
const MAX_COPIES_PER_CARD = 3;

let catalogCache = null;
let catalogJsonCache = null;
function loadCatalog() {
  if (catalogCache) return catalogCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(KARDS_CARDS_FILE, 'utf8'));
    catalogCache = {
      total: parsed.total || 0,
      factions: parsed.factions || [],
      byId: new Map((parsed.cards || []).map((card) => [card.id, card])),
    };
  } catch {
    catalogCache = { total: 0, factions: [], byId: new Map() };
  }
  return catalogCache;
}

/** 返回原始目录 JSON（生成时间/统计/完整卡列表），供 /api/kards/cards 直接透传。 */
function getCatalogJson() {
  if (catalogJsonCache) return catalogJsonCache;
  try {
    catalogJsonCache = JSON.parse(fs.readFileSync(KARDS_CARDS_FILE, 'utf8'));
  } catch {
    catalogJsonCache = null;
  }
  return catalogJsonCache;
}

function parseCardsJson(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function toDeck(deck) {
  return {
    id: deck.id,
    owner: deck.owner.username,
    name: deck.name,
    faction: deck.faction,
    cards: parseCardsJson(deck.cardsJson),
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString(),
  };
}

const deckInclude = { owner: { select: { username: true } } };

async function listDecks(username) {
  const decks = await prisma.kardsDeck.findMany({
    where: { owner: { username } },
    include: deckInclude,
    orderBy: { updatedAt: 'desc' },
  });
  return decks.map(toDeck);
}

async function getDeck(username, id) {
  const deck = await prisma.kardsDeck.findFirst({ where: { id, owner: { username } }, include: deckInclude });
  return deck ? toDeck(deck) : null;
}

/**
 * 校验并归一化牌组卡牌列表。
 * - 只允许目录中存在的卡牌 id；
 * - 单卡最多 MAX_COPIES_PER_CARD 张，总量最多 MAX_CARDS_PER_DECK；
 * - 超过上限的部分直接截断（丢弃超出的复制张），保证数据库里永远是可渲染的牌组。
 */
function normalizeCards(cards, catalog) {
  if (!Array.isArray(cards)) return [];
  const counts = new Map();
  const normalized = [];
  for (const raw of cards) {
    const id = typeof raw === 'string' ? raw : null;
    if (!id || !catalog.byId.has(id)) continue;
    const count = (counts.get(id) || 0) + 1;
    if (count > MAX_COPIES_PER_CARD) continue;
    counts.set(id, count);
    normalized.push(id);
    if (normalized.length >= MAX_CARDS_PER_DECK) break;
  }
  return normalized;
}

function dominantFaction(cards, catalog) {
  const counts = new Map();
  for (const id of cards) {
    const card = catalog.byId.get(id);
    if (!card || card.faction === '中立') continue;
    counts.set(card.faction, (counts.get(card.faction) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [faction, count] of counts) {
    if (count > bestCount) {
      best = faction;
      bestCount = count;
    }
  }
  return best;
}

async function createDeck(username, deck) {
  const catalog = loadCatalog();
  const cards = normalizeCards(deck.cards, catalog);
  const created = await prisma.kardsDeck.create({
    data: {
      id: deck.id,
      owner: { connect: { username } },
      name: deck.name,
      faction: deck.faction || dominantFaction(cards, catalog),
      cardsJson: JSON.stringify(cards),
      createdAt: new Date(deck.createdAt),
      updatedAt: new Date(deck.updatedAt),
    },
    include: deckInclude,
  });
  return toDeck(created);
}

async function updateDeck(username, id, patch) {
  const current = await prisma.kardsDeck.findFirst({ where: { id, owner: { username } }, include: deckInclude });
  if (!current) return null;
  const catalog = loadCatalog();
  const cards = patch.cards !== undefined ? normalizeCards(patch.cards, catalog) : parseCardsJson(current.cardsJson);
  const updated = await prisma.kardsDeck.update({
    where: { id },
    data: {
      name: patch.name !== undefined ? patch.name : current.name,
      faction: patch.faction !== undefined ? patch.faction : (current.faction || dominantFaction(cards, catalog)),
      cardsJson: JSON.stringify(cards),
      updatedAt: new Date(),
    },
    include: deckInclude,
  });
  return toDeck(updated);
}

async function deleteDeck(username, id) {
  const result = await prisma.kardsDeck.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

module.exports = { listDecks, getDeck, createDeck, updateDeck, deleteDeck, loadCatalog, getCatalogJson, normalizeCards, MAX_CARDS_PER_DECK, MAX_COPIES_PER_CARD };
