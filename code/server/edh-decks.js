'use strict';

const { prisma } = require('./db');

function parseLayout(layoutJson) {
  if (!layoutJson) return undefined;
  try { return JSON.parse(layoutJson); } catch { return undefined; }
}

function toDeck(deck) {
  return {
    id: deck.id,
    owner: deck.owner.username,
    name: deck.name,
    commanderOracleId: deck.commanderOracleId,
    cards: deck.cards.map((card) => ({ oracleId: card.oracleId, quantity: card.quantity })),
    ...(parseLayout(deck.layoutJson) ? { layout: parseLayout(deck.layoutJson) } : {}),
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString(),
  };
}

const deckInclude = { owner: { select: { username: true } }, cards: { orderBy: { oracleId: 'asc' } } };

async function listDecks(username) {
  const decks = await prisma.deck.findMany({ where: { owner: { username } }, include: deckInclude, orderBy: { updatedAt: 'desc' } });
  return decks.map(toDeck);
}

async function getDeck(username, id) {
  const deck = await prisma.deck.findFirst({ where: { id, owner: { username } }, include: deckInclude });
  return deck ? toDeck(deck) : null;
}

async function createDeck(username, deck) {
  const created = await prisma.deck.create({
    data: { id: deck.id, owner: { connect: { username } }, name: deck.name, commanderOracleId: deck.commanderOracleId, createdAt: new Date(deck.createdAt), updatedAt: new Date(deck.updatedAt) },
    include: deckInclude,
  });
  return toDeck(created);
}

function normalizeCards(cards) {
  const quantities = new Map();
  for (const card of cards) quantities.set(card.oracleId, Math.min(99, (quantities.get(card.oracleId) || 0) + card.quantity));
  return [...quantities].map(([oracleId, quantity]) => ({ oracleId, quantity }));
}

async function updateDeck(username, id, patch) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.deck.findFirst({ where: { id, owner: { username } }, include: { cards: true } });
    if (!current) return null;
    const data = {
      name: patch.name,
      commanderOracleId: patch.commanderOracleId,
      layoutJson: patch.layout === undefined ? current.layoutJson : (patch.layout ? JSON.stringify(patch.layout) : null),
      updatedAt: new Date(),
    };
    if (patch.cards !== undefined) {
      await tx.deckCard.deleteMany({ where: { deckId: id } });
      const cards = normalizeCards(patch.cards);
      if (cards.length) await tx.deckCard.createMany({ data: cards.map((card) => ({ deckId: id, oracleId: card.oracleId, quantity: card.quantity })) });
    }
    const saved = await tx.deck.update({ where: { id }, data, include: deckInclude });
    return toDeck(saved);
  });
}

async function deleteDeck(username, id) {
  const result = await prisma.deck.deleteMany({ where: { id, owner: { username } } });
  return result.count > 0;
}

module.exports = { listDecks, getDeck, createDeck, updateDeck, deleteDeck };
