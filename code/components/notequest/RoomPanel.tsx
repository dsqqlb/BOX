'use client';

/**
 * 房间面板（HUD 右下）：当前片段的详细信息 + 所有「在这里能做的事」。
 *
 * 这一块是玩家的操作台：
 *   房间内容 → 怪物与战斗 → 宝箱/密道 → 遗体搜刮 → 门 → 走到相邻片段 → 下楼梯/回城 → 日志。
 * 按钮都直接交给 engine.applyAction，面板不做规则判断（不成立时引擎回一句 notice）。
 */

import { useState } from 'react';
import Icon from './Icon';
import LogPanel from './LogPanel';
import { aliveMonsters, dungeonType, heroHooks, monsterLabel } from '@/lib/notequest/engine';
import { CORE } from '@/lib/notequest/data';
import type { GameAction } from '@/lib/notequest/engine';
import type { RollRecord, RunState } from '@/lib/notequest/types';

const KIND_LABEL: Record<string, string> = { room: '房间', corridor: '走廊', stairs: '楼梯', entrance: '入口', boss: '最终房间' };
const SIZE_LABEL: Record<string, string> = { small: '小 2×2', medium: '中 3×3', wide: '宽 4×3', large: '大 4×4' };
const STATUS_LABEL: Record<string, string> = { closed: '关着', open: '已打开', locked: '锁着', broken: '砸开' };

/** 掷骰标签里常常已经带了骰式（「房间内容 2d6」）：记录里把骰式分出去，只留「目的」。 */
function goalOf(roll: RollRecord): string {
  const text = roll.label.replace(/\d*\s*d\s*\d+/i, '').replace(/\s{2,}/g, ' ').replace(/（\s+/g, '（').trim();
  return text || '掷骰';
}

interface RoomPanelProps {
  state: RunState;
  busy: boolean;
  /** 掷骰记录（最新的在前）：每一次掷骰的目的与结果都留在这里，不随着回放消失 */
  rolls: RollRecord[];
  onAction: (action: GameAction) => void;
  onOpenTables: () => void;
  onOpenRuns: () => void;
  onOpenGraves: () => void;
}

export default function RoomPanel({ state, busy, rolls, onAction, onOpenTables, onOpenRuns, onOpenGraves }: RoomPanelProps) {
  const [targetUid, setTargetUid] = useState<string | null>(null);
  const [showRolls, setShowRolls] = useState(true);
  const node = state.dungeon.nodes.find((item) => item.id === state.dungeon.currentId) ?? state.dungeon.nodes[0];
  const type = dungeonType(state);
  const alive = aliveMonsters(node);
  const combat = state.combat;
  const isOver = state.status !== 'active';
  const grave = node.heroGrave && !node.heroGrave.looted ? node.heroGrave : null;

  return (
    <div className="nq-panel nq-hud nq-hud-room">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title"><Icon name="map" className="h-4 w-4" /> {state.dungeon.name}</p>
          <p className="nq-panel-sub">{type.name} · 第 {state.dungeon.depth} 层 · 回合 {state.stats.turns} · 击杀 {state.stats.kills}</p>
        </div>
        <div className="nq-head-buttons">
          <button type="button" className="nq-mini" onClick={onOpenTables}>表格速查</button>
          <button type="button" className="nq-mini" onClick={onOpenRuns}>存档</button>
          <button type="button" className="nq-mini" onClick={onOpenGraves}>墓地</button>
        </div>
      </header>

      {isOver && (
        <div className={`nq-outcome${state.status === 'cleared' ? ' is-win' : ''}`}>
          <p className="nq-outcome-title">{state.status === 'cleared' ? '🎉 通关' : '☠️ 角色阵亡'}</p>
          <p>{state.outcome?.text}</p>
          <p className="nq-muted">
            击杀 {state.stats.kills} · 财宝 {state.stats.treasures} · 金币 {state.stats.coinsFound} · 探到第 {state.stats.deepestDepth} 层
            {state.status === 'dead' ? ' · 遗体与装备留在原地，换个角色可以回来取' : ''}
          </p>
        </div>
      )}

      <section className="nq-section">
        <h3 className="nq-section-title">
          当前片段：{KIND_LABEL[node.kind] ?? '片段'}
          {node.kind === 'room' && node.size ? `（${SIZE_LABEL[node.size]}）` : ''}
        </h3>
        {node.contentText ? (
          <p className="nq-room-text">{node.contentText}</p>
        ) : (
          <p className="nq-muted">
            {node.visited ? '这个片段里没有特别的东西。' : '还没进去过：点地图上的这间屋子走进去，房间内容会掷 2d6 决定。'}
          </p>
        )}
        {node.chest && <p className="nq-note">{node.chest.opened ? '这里有个空宝箱（已经打开过）。' : `这里有一个${node.chest.big ? '大' : ''}宝箱。`}</p>}
        {node.hasSecretPassage && <p className="nq-note">墙上可能有暗门：花 1 个火把找一找。</p>}
        {node.trapsActive && <p className="nq-note nq-note-warn">这个片段的陷阱还没处理。</p>}
      </section>

      {alive.length > 0 && (
        <section className="nq-section">
          <h3 className="nq-section-title">
            怪物（{node.sneaked ? '已被绕过' : combat ? `战斗中 · 第 ${combat.round} 回合` : '还没动手'}）
          </h3>
          <div className="nq-monsters">
            {alive.map((monster) => (
              <button
                key={monster.uid}
                type="button"
                className={`nq-monster${monster.uid === (targetUid ?? alive[0]?.uid) ? ' is-target' : ''}`}
                onClick={() => setTargetUid(monster.uid)}
              >
                <Icon name={monster.isBoss ? 'boss' : 'monster'} className="h-4 w-4" />
                <span className="nq-monster-name">{monsterLabel(monster)}</span>
                <span className="nq-monster-hp">{Math.max(0, monster.hp)} / {monster.maxHp} HP</span>
                <span className="nq-monster-hp">伤害 {monster.damage}</span>
                {monster.stunned && <span className="nq-badge-info">本回合无法攻击</span>}
                {monster.killsOnHit && <span className="nq-badge-danger">命中即杀</span>}
              </button>
            ))}
          </div>
        </section>
      )}
      {/* 战斗：先手/后手、目标、伤害分配 */}
      {combat && !isOver && (
        <section className="nq-section">
          <h3 className="nq-section-title">战斗</h3>
          {combat.awaitingDamageTarget ? (
            <div className="nq-damage-choice">
              <p className="nq-note nq-note-warn">
                怪物这一击被 {combat.pendingDamageFrom || '某种攻击'} 打了 {combat.pendingDamage} 点：让谁承受？
              </p>
              <div className="nq-head-buttons">
                <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => onAction({ type: 'allocate-damage', target: 'hp' })}>
                  自己硬扛（HP {state.hero.hp}）
                </button>
                {state.hero.armors.map((armor) => (
                  <button
                    key={armor.uid}
                    type="button"
                    className="nq-mini"
                    disabled={busy || combat.pendingDamageUnabsorbable}
                    onClick={() => onAction({ type: 'allocate-damage', target: 'armor', armorUid: armor.uid })}
                  >
                    让 {armor.name} 挡（{armor.hp} HP）
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="nq-head-buttons">
              <button
                type="button"
                className="nq-mini nq-mini-strong"
                disabled={busy}
                onClick={() => onAction({ type: 'attack', targetUid: targetUid ?? alive[0]?.uid ?? '' })}
              >
                攻击{targetUid ? '' : '（第一个）'}（{state.hero.weapon.damage}
                {state.hero.weapon.damageBonus ? `+${state.hero.weapon.damageBonus}` : ''}）
              </button>
              {state.hero.spells.map((spell, index) => (
                <button
                  key={`${spell.spellId}-${index}`}
                  type="button"
                  className="nq-mini"
                  disabled={busy || spell.spent}
                  onClick={() => onAction({ type: 'cast-spell', spellIndex: index, targetUid: targetUid ?? undefined })}
                >
                  {spell.name}{spell.spent ? '（已用）' : ''}
                </button>
              ))}
              {combat.raging && <span className="nq-badge-danger">狂怒：本场 +2 伤害</span>}
            </div>
          )}
        </section>
      )}

      {grave && !isOver && (
        <section className="nq-section">
          <h3 className="nq-section-title">遗体：{grave.name}（{grave.raceName}·{grave.className}）</h3>
          <p className="nq-muted">
            {grave.cause} · {new Date(grave.diedAt).toLocaleString('zh-CN')} ·
            留下 {grave.items.length + grave.armors.length} 件装备
            {grave.weapon ? `、${grave.weapon.name}` : ''}
            {grave.coins > 0 ? `、${grave.coins} 金币` : ''}
            {grave.treasure > 0 ? `、${grave.treasure} 个财宝` : ''}
          </p>
          <div className="nq-head-buttons">
            <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => onAction({ type: 'loot-grave', nodeId: node.id })}>
              能拿的都拿走
            </button>
          </div>
          {[...grave.items, ...grave.armors].map((item) => (
            <div key={item.uid} className="nq-row nq-row-action">
              <Icon name={item.kind === 'armor' ? 'shield' : item.kind === 'weapon' ? 'sword' : 'bag'} className="h-4 w-4" />
              <span className="nq-row-main">{item.name} <em>{item.text}</em></span>
              <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'loot-grave', nodeId: node.id, itemUid: item.uid })}>
                取走
              </button>
            </div>
          ))}
        </section>
      )}
      {!combat && !isOver && (
        <section className="nq-section">
          <h3 className="nq-section-title">这里能做的事</h3>
          <div className="nq-grid-2">
            <button type="button" className="nq-button" disabled={busy || !node.chest || node.chest.opened}
              onClick={() => onAction({ type: 'open-chest', nodeId: node.id })}>
              打开宝箱<em>2d6：高值是金币、低值是财宝，双 1 会触发陷阱</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || !node.hasSecretPassage || node.secretPassageSearched || state.hero.torches <= 0}
              onClick={() => onAction({ type: 'search-secret-passage', nodeId: node.id })}>
              寻找密道（1 火把）
            </button>
            <button type="button" className="nq-button" disabled={busy || alive.length === 0 || state.hero.torches <= 0}
              onClick={() => onAction({ type: 'enter-node', nodeId: node.id, sneak: true })}>
              安静移动穿过这里（1 火把）<em>每个怪物掷 1d6，掷出 1 就被发现</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || node.kind !== 'stairs'}
              onClick={() => onAction({ type: 'descend', nodeId: node.id })}>
              走下楼梯<em>第 {CORE.rules.finalRoomDepth} 层就是最终房间（Boss）</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || !node.corpse || node.corpse.devoured || !heroHooks(state.hero).healFullOnDevour}
              onClick={() => onAction({ type: 'devour', nodeId: node.id })}>
              吞噬尸体<em>{heroHooks(state.hero).healFullOnDevour ? '史莱姆人：回满 HP' : '只有史莱姆人能吞噬尸体'}</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || alive.length > 0}
              onClick={() => onAction({ type: 'to-town' })}>
              回城镇补给<em>回城路上必须没有活怪</em>
            </button>
          </div>
        </section>
      )}

      {!isOver && node.doors.length > 0 && (
        <section className="nq-section">
          <h3 className="nq-section-title">门（{node.doors.length}）</h3>
          {node.doors.map((door) => {
            const target = door.to ? state.dungeon.nodes.find((item) => item.id === door.to) : undefined;
            return (
              <div key={door.id} className="nq-row nq-row-action">
                <Icon name={door.status === 'locked' ? 'door-locked' : door.status === 'broken' ? 'door-broken' : 'door'} className="h-4 w-4" />
                <span className="nq-row-main">
                  {STATUS_LABEL[door.status] ?? '门'}
                  {target ? <em>通向{KIND_LABEL[target.kind] ?? '片段'}{target.visited ? '' : '（还没进去过）'}</em> : <em>门后还不知道有什么</em>}
                </span>
                {door.status === 'closed' && (
                  <button type="button" className="nq-mini nq-mini-strong" disabled={busy}
                    onClick={() => onAction({ type: 'open-door', nodeId: node.id, doorId: door.id })}>打开（1d6）</button>
                )}
                {door.status === 'locked' && (
                  <>
                    <button type="button" className="nq-mini nq-mini-strong" disabled={busy}
                      onClick={() => onAction({ type: 'lockpick', nodeId: node.id, doorId: door.id })}>开锁（1 火把）</button>
                    <button type="button" className="nq-mini" disabled={busy}
                      onClick={() => onAction({ type: 'smash', nodeId: node.id, doorId: door.id })}>砸开</button>
                    <button type="button" className="nq-mini" disabled={busy || state.hero.keys <= 0}
                      onClick={() => onAction({ type: 'use-key', nodeId: node.id, doorId: door.id })}>用钥匙</button>
                  </>
                )}
                {target && door.status !== 'locked' && (
                  <button type="button" className="nq-mini" disabled={busy}
                    onClick={() => onAction({ type: 'enter-node', nodeId: target.id })}>走进去</button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* 掷骰记录：每一次掷骰的目的 + 结果都留在画面上（3D 回放结束后也不消失） */}
      <section className="nq-section">
        <h3 className="nq-section-title">
          掷骰记录（{rolls.length}）
          <button type="button" className="nq-mini nq-mini-ghost" onClick={() => setShowRolls((value) => !value)}>
            {showRolls ? '收起' : '展开'}
          </button>
        </h3>
        {rolls.length === 0 && (
          <p className="nq-muted">还没掷过骰子：打开门、走进新房间、决定房间内容、决定地牢名字时，目的与结果都会记在这里。</p>
        )}
        {showRolls && rolls.length > 0 && (
          <ol className="nq-roll-list">
            {rolls.slice(0, 12).map((roll) => (
              <li key={roll.id} className="nq-roll-row">
                <span className="nq-roll-goal" title={roll.label}>{goalOf(roll)}</span>
                <span className="nq-roll-dice">
                  {roll.values && roll.values.length ? roll.values.join(' + ') : roll.notation}
                  <em>= {roll.total}</em>
                </span>
                <span className="nq-roll-detail">
                  <code className="nq-roll-notation">{roll.notation}</code> {roll.detail}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <LogPanel log={state.log} />
    </div>
  );
}