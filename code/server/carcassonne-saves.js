'use strict';

const { prisma } = require('./db');

function clampInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.floor(num) : fallback;
}

function normalizePlayer(value, fallbackName) {
  const player = (value && typeof value === 'object') ? value : {};
  return {
    name: typeof player.name === 'string' && player.name.trim() ? player.name.trim().slice(0, 20) : fallbackName,
    score: clampInt(player.score),
    items: Array.isArray(player.items)
      ? [0, 1, 2].map((index) => clampInt(player.items[index]))
      : [0, 0, 0],
  };
}

function normalizeState(value) {
  const state = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  const king = state.king || {};
  const thief = state.thief || {};
  return {
    player1: normalizePlayer(state.player1, '秦'),
    player2: normalizePlayer(state.player2, '马'),
    king: { count: clampInt(king.count), holder: king.holder === 1 ? 1 : 0 },
    thief: { count: clampInt(thief.count), holder: thief.holder === 1 ? 1 : 0 },
  };
}

function toSave(record) {
  let state = null;
  try {
    state = normalizeState(JSON.parse(record.stateJson));
  } catch {
    state = {
      player1: { name: '秦', score: 0, items: [0, 0, 0] },
      player2: { name: '马', score: 0, items: [0, 0, 0] },
      king: { count: 0, holder: 0 },
      thief: { count: 0, holder: 1 },
    };
  }
  return {
    id: record.id,
    title: record.title,
    state,
    createdAt: record.createdAt.toISOString(),
  };
}

async function listSaves(username) {
  const records = await prisma.carcassonneSave.findMany({
    where: { owner: { username } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return records.map(toSave);
}

async function getSave(username, id) {
  const record = await prisma.carcassonneSave.findFirst({
    where: { id, owner: { username } },
  });
  return record ? toSave(record) : null;
}

async function createSave(username, record) {
  const created = await prisma.carcassonneSave.create({
    data: {
      id: record.id,
      title: record.title,
      stateJson: JSON.stringify(normalizeState(record.state)),
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.createdAt),
      owner: { connect: { username } },
    },
  });
  return toSave(created);
}

async function deleteSave(username, id) {
  const result = await prisma.carcassonneSave.deleteMany({
    where: { id, owner: { username } },
  });
  return result.count > 0;
}

module.exports = { listSaves, getSave, createSave, deleteSave };
