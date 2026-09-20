#!/usr/bin/env node
/**
 * NoteQuest 引擎模拟器（本地验证工具，不参与发布）。
 *
 * 引擎是纯函数：applyAction(state, action, rng) 立刻算完并返回新状态，RNG 可注入，
 * 所以可以在 Node 里不用浏览器就跑大量随机探索，验证长链路（开门 → 房间 → 战斗 →
 * 掉落 → 往返城镇 → 下楼梯 → Boss → 死亡/通关）不崩、数值不越界。
 *
 * 需要 esbuild 把 TS + JSON 打包成 Node 能直接跑的 ESM：
 *   npm --prefix code install --no-save esbuild
 * 用法：
 *   node ops/scripts/simulate-notequest.mjs [局数=30]
 * 没有 esbuild 时打印提示并跳过（退出码 0），不会卡住发布流程。
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const codeRoot = path.join(projectRoot, 'code');
const require = createRequire(path.join(codeRoot, 'package.json'));

let esbuild = null;
try {
  esbuild = require('esbuild');
} catch {
  console.log('跳过引擎模拟：本机没有 esbuild（npm --prefix code install --no-save esbuild 后重试）。');
  process.exit(0);
}

/** 把 lib/notequest/engine.ts 打包成临时 ESM（@content 别名指向 resources/content）。 */
async function loadEngine() {
  const bundled = await esbuild.build({
    entryPoints: [path.join(codeRoot, 'lib', 'notequest', 'engine.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    loader: { '.json': 'json' },
    alias: { '@content': path.join(projectRoot, 'resources', 'content') },
  });
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nq-engine-')), 'engine.mjs');
  fs.writeFileSync(file, bundled.outputFiles[0].text, 'utf8');
  return import(pathToFileURL(file).href);
}

/** 可复现的伪随机数（同一 seed 每次跑出同一局）。 */
function mulberry32(seed) {
  let value = seed >>> 0;
  return function next() {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const failures = [];
/** 报告行（SIM_REPORT 指向文件时写出去，方便在终端编码不友好的环境里查看） */
const reportLines = [];

function verify(state, step, runIndex) {
  const where = `第 ${runIndex} 局第 ${step} 步`;
  if (!Number.isFinite(state.hero.hp) || !Number.isFinite(state.hero.coins) || !Number.isFinite(state.hero.torches)) {
    failures.push(`${where}：数值出现 NaN/Infinity`);
  }
  if (state.hero.coins < 0 || state.hero.torches < 0 || state.hero.treasure < 0) {
    failures.push(`${where}：资源变成负数（金币 ${state.hero.coins} / 火把 ${state.hero.torches} / 财宝 ${state.hero.treasure}）`);
  }
  if (state.hero.torches > 10) failures.push(`${where}：火把超过上限（${state.hero.torches}）`);
  if (!state.dungeon.nodes.length) failures.push(`${where}：地图里没有片段了`);
  if (!state.dungeon.nodes.some((node) => node.id === state.dungeon.currentId)) failures.push(`${where}：当前片段不在图里`);
  if (state.log.length > 400) failures.push(`${where}：日志超过上限（${state.log.length}）`);
  if (state.combat && !state.dungeon.nodes.some((node) => node.id === state.combat.nodeId)) {
    failures.push(`${where}：战斗记录指向了不存在的片段`);
  }
  const bag = state.hero.items.filter((item) => item.kind !== 'treasure' && item.kind !== 'key').length;
  if (bag > 10) failures.push(`${where}：背包超过上限（${bag}）`);
}

function currentNode(state) {
  return state.dungeon.nodes.find((node) => node.id === state.dungeon.currentId) ?? state.dungeon.nodes[0];
}

/** 一个"会玩但很莽"的机器人：先清怪、开箱、找密道、往下走，血少了回城。
 *  blocked 里放着"上一轮被引擎拒绝的动作类型"，用来避免在同一个不可能的动作上死循环。 */
function chooseAction(state, rng, blocked = new Set(), memory = {}) {
  const node = currentNode(state);
  const hero = state.hero;

  if (state.combat) {
    if (state.combat.awaitingDamageTarget) {
      const armor = hero.armors.find((item) => (item.hp ?? 0) > 0);
      if (armor && !state.combat.pendingDamageUnabsorbable) return { type: 'allocate-damage', target: 'armor', armorUid: armor.uid };
      return { type: 'allocate-damage', target: 'hp' };
    }
    const alive = node.monsters.filter((monster) => monster.hp > 0);
    if (!alive.length) return null;
    const heal = hero.spells.findIndex((spell) => !spell.spent && spell.spellId === 'heal' && hero.hp < hero.maxHp / 2);
    if (heal >= 0) return { type: 'cast-spell', spellIndex: heal };
    const potion = hero.items.find((item) => item.use === 'heal');
    if (potion && hero.hp < hero.maxHp / 2) return { type: 'use-item', itemUid: potion.uid };
    const nuke = hero.spells.findIndex((spell) => !spell.spent && ['fireball', 'lightning', 'ice-ray'].includes(spell.spellId));
    if (nuke >= 0 && rng() < 0.5) return { type: 'cast-spell', spellIndex: nuke, targetUid: alive[0].uid };
    return { type: 'attack', targetUid: alive[0].uid };
  }

  if (state.town.inTown) {
    if (!blocked.has('town-rest') && hero.hp < hero.maxHp * 0.8 && hero.coins >= 1) return { type: 'town-rest' };
    if (!blocked.has('town-buy-torch') && hero.torches < 4 && hero.coins >= 2) return { type: 'town-buy-torch', count: 4 };
    if (!blocked.has('town-reward-treasure') && hero.treasure > 0) return { type: 'town-reward-treasure', count: 1 };
    const armor = hero.items.find((item) => item.kind === 'armor');
    if (armor && !memory.equippedArmor) {
      memory.equippedArmor = true;
      return { type: 'equip-armor', itemUid: armor.uid };
    }
    const weapon = hero.items.find((item) => item.kind === 'weapon');
    if (weapon && !memory.equippedWeapon) {
      memory.equippedWeapon = true;
      return { type: 'equip-weapon', itemUid: weapon.uid };
    }
    const junk = hero.items.find((item) => item.kind !== 'key' && item.kind !== 'armor' && item.kind !== 'weapon');
    if (junk && (hero.coins < 5 || hero.torches < 4)) return { type: 'town-sell', itemUid: junk.uid };
    if (hero.torches <= 1 && !blocked.has('town-buy-torch')) return { type: 'town-buy-torch', count: 3 };
    return { type: 'return-dungeon' };
  }

  if (!blocked.has('to-town') && node.monsters.every((monster) => monster.hp <= 0)
    && (hero.hp < hero.maxHp * 0.35 || hero.torches <= 2 || (hero.hasLight === false && hero.hp < hero.maxHp * 0.5))) {
    return { type: 'to-town' };
  }
  if (node.corpse && !node.corpse.devoured && !blocked.has('devour')) return { type: 'devour', nodeId: node.id };
  if (node.chest && !node.chest.opened && !blocked.has('open-chest')) return { type: 'open-chest', nodeId: node.id };
  if (node.hasSecretPassage && !node.secretPassageSearched && hero.torches > 1 && !blocked.has('search-secret-passage')) {
    return { type: 'search-secret-passage', nodeId: node.id };
  }
  if (node.kind === 'stairs' && !blocked.has('descend')) return { type: 'descend', nodeId: node.id };

  const reachable = state.dungeon.nodes.filter((item) => item.id !== node.id && state.dungeon.nodes.some((from) =>
    from.doors.some((door) => door.to === item.id && (door.status === 'open' || door.status === 'broken'))));
  const unvisited = reachable.find((item) => !item.visited);
  if (unvisited) {
    if (rng() < 0.35 && hero.torches > 1) return { type: 'enter-node', nodeId: unvisited.id, sneak: true };
    return { type: 'enter-node', nodeId: unvisited.id };
  }
  // 地图都逛过了：优先走向楼梯继续往下层走
  const stairs = reachable.find((item) => item.kind === 'stairs');
  if (stairs) return { type: 'enter-node', nodeId: stairs.id };
  if (reachable.length && rng() < 0.2) return { type: 'enter-node', nodeId: reachable[0].id };

  const closed = node.doors.find((door) => door.status === 'closed');
  if (closed) return { type: 'open-door', nodeId: node.id, doorId: closed.id };
  const locked = node.doors.find((door) => door.status === 'locked');
  if (locked) {
    const pick = rng();
    if (hero.keys > 0 && pick < 0.3) return { type: 'use-key', nodeId: node.id, doorId: locked.id };
    if (hero.torches > 0 && pick < 0.75) return { type: 'lockpick', nodeId: node.id, doorId: locked.id };
    return { type: 'smash', nodeId: node.id, doorId: locked.id };
  }
  if (reachable.length) return { type: 'enter-node', nodeId: reachable[0].id };
  return null;
}

async function main() {
  const engine = await loadEngine();
  const runs = Number(process.argv[2] ?? 30);
  const summary = { cleared: 0, dead: 0, stuck: 0, steps: 0, kills: 0, treasures: 0 };
  const causes = new Map();
  const depths = new Map();
  const stuckSamples = [];

  for (let index = 0; index < runs; index += 1) {
    const rng = mulberry32(1000 + index * 7919);
    let state = engine.createRun({ rng }).state;
    let steps = 0;
    const blocked = new Set();
    const memory = {};
    const trace = index === 0 && Boolean(process.env.SIM_TRACE);
    while (state.status === 'active' && steps < 2000) {
      const action = chooseAction(state, rng, blocked, memory);
      if (!action) break;
      const outcome = engine.applyAction(state, action, rng);
      steps += 1;
      if (trace && steps <= 60) {
        const node = currentNode(outcome.state);
        reportLines.push(`  #${steps} ${action.type} ${outcome.notice ? `拒绝：${outcome.notice}` : 'OK'} · 城镇=${outcome.state.town.inTown} 节点=${outcome.state.dungeon.nodes.length} 当前门=${node.doors.map((door) => door.status[0]).join('') || '无'} 活怪=${node.monsters.filter((monster) => monster.hp > 0).length}`);
      }
      if (outcome.notice) {
        // 被引擎拒绝：记下来，下一轮选别的动作，避免死循环
        blocked.add(action.type);
        if (blocked.size > 6) blocked.clear();
        continue;
      }
      blocked.clear();
      verify(outcome.state, steps, index);
      state = outcome.state;
    }
    summary.steps += steps;
    summary.kills += state.stats.kills;
    summary.treasures += state.stats.treasures;
    depths.set(state.stats.deepestDepth, (depths.get(state.stats.deepestDepth) ?? 0) + 1);
    if (state.status === 'cleared') summary.cleared += 1;
    else if (state.status === 'dead') {
      summary.dead += 1;
      const cause = state.outcome?.text ?? '未知';
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
    } else summary.stuck += 1;
    if (state.status === 'active' && stuckSamples.length < 3) {
      const node = currentNode(state);
      stuckSamples.push({
        steps,
        depth: state.dungeon.depth,
        nodes: state.dungeon.nodes.length,
        kinds: state.dungeon.nodes.map((item) => `${item.kind}${item.visited ? '' : '(未访问)'}[${item.doors.map((door) => door.status[0]).join('')}]`).join(' '),
        current: `${node.kind} doors=${node.doors.map((door) => door.status).join(',') || '无'} 活怪=${node.monsters.filter((monster) => monster.hp > 0).length}`,
        inTown: state.town.inTown,
        torches: state.hero.torches,
        hp: `${state.hero.hp}/${state.hero.maxHp}`,
        hasLight: state.hero.hasLight,
        log: state.log.slice(-5).map((entry) => entry.text),
      });
    }
  }

  console.log(`\n模拟 ${runs} 局：通关 ${summary.cleared} · 阵亡 ${summary.dead} · 卡住/未结束 ${summary.stuck}`);
  reportLines.push(`模拟 ${runs} 局：通关 ${summary.cleared} · 阵亡 ${summary.dead} · 卡住/未结束 ${summary.stuck}`);
  console.log(`平均回合 ${(summary.steps / runs).toFixed(1)} · 平均击杀 ${(summary.kills / runs).toFixed(1)} · 平均财宝 ${(summary.treasures / runs).toFixed(1)}`);
  reportLines.push(`平均回合 ${(summary.steps / runs).toFixed(1)} · 平均击杀 ${(summary.kills / runs).toFixed(1)} · 平均财宝 ${(summary.treasures / runs).toFixed(1)}`);
  console.log(`最深到达层数：${[...depths.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => `${depth} 层 ×${count}`).join('、')}`);
  reportLines.push(`最深到达层数：${[...depths.entries()].sort((a, b) => a[0] - b[0]).map(([depth, count]) => `${depth} 层 ×${count}`).join('、')}`);
  console.log('常见死因：');
  for (const [cause, count] of [...causes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${count} × ${cause}`);
    reportLines.push(`  ${count} × ${cause}`);
  }
  for (const [index, sample] of stuckSamples.entries()) {
    console.log(`\n⚠️ 未结束样本 ${index + 1}（步数 ${sample.steps}，第 ${sample.depth} 层，节点 ${sample.nodes}）`);
    console.log(`   地图：${sample.kinds}`);
    console.log(`   当前：${sample.current} · 城镇=${sample.inTown} · 火把=${sample.torches} · HP=${sample.hp} · 有光源=${sample.hasLight}`);
    console.log(`   最近日志：${sample.log.join(' / ')}`);
    reportLines.push(`未结束样本 ${index + 1}（步数 ${sample.steps}，第 ${sample.depth} 层，节点 ${sample.nodes}）`);
    reportLines.push(`  地图：${sample.kinds}`);
    reportLines.push(`  当前：${sample.current} · 城镇=${sample.inTown} · 火把=${sample.torches} · HP=${sample.hp} · 有光源=${sample.hasLight}`);
    reportLines.push(`  最近日志：${sample.log.join(' / ')}`);
  }

  if (failures.length) {
    console.error(`\n发现 ${failures.length} 处状态异常：`);
    for (const failure of failures.slice(0, 20)) console.error(`  - ${failure}`);
    reportLines.push(`[FAIL] ${failures.length} 处状态异常`);
    for (const failure of failures.slice(0, 20)) reportLines.push(`  - ${failure}`);
    if (process.env.SIM_REPORT) fs.writeFileSync(process.env.SIM_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
    process.exit(1);
  }
  console.log('\n状态校验通过（没有 NaN、没有负资源、没有越界）。');
  reportLines.push('[OK] 状态校验通过');
  if (process.env.SIM_REPORT) fs.writeFileSync(process.env.SIM_REPORT, `${reportLines.join('\n')}\n`, 'utf8');
}

main().catch((error) => {
  console.error('\n模拟器异常:', error);
  process.exit(1);
});