'use client';

/**
 * 行动面板：当前片段要做什么、战斗中怎么打、回城镇怎么补给。
 *
 * 所有操作都走 engine.applyAction（纯函数），面板只负责把状态摆出来、把按钮排好。
 * 规则不允许的按钮会直接 disabled，理由写在按钮下方的提示里（引擎的 notice 也会冒泡到顶部）。
 */

import { useState } from 'react';
import Icon from './Icon';
import { aliveMonsters, heroHooks, monsterLabel, nodeBlocksActions, weaponUsable } from '@/lib/notequest/engine';
import { CORE, RULES, getDungeonType } from '@/lib/notequest/data';
import type { GameAction } from '@/lib/notequest/engine';
import type { RunState } from '@/lib/notequest/types';

interface ActionPanelProps {
  state: RunState;
  busy: boolean;
  onAction: (action: GameAction) => void;
  onOpenTables: () => void;
  onOpenRuns: () => void;
  onOpenGraves: () => void;
}

export default function ActionPanel({ state, busy, onAction, onOpenTables, onOpenRuns, onOpenGraves }: ActionPanelProps) {
  const [targetUid, setTargetUid] = useState<string | null>(null);
  const node = state.dungeon.nodes.find((item) => item.id === state.dungeon.currentId) ?? state.dungeon.nodes[0];
  const type = getDungeonType(state.dungeon.typeId);
  const alive = aliveMonsters(node);
  const blocked = nodeBlocksActions(node);
  const combat = state.combat;
  const inTown = state.town.inTown;
  const hero = state.hero;
  const isOver = state.status !== 'active';
  const reachable = state.dungeon.nodes.filter((item) => item.id !== node.id && state.dungeon.nodes.some((from) =>
    from.doors.some((door) => door.to === item.id && (door.status === 'open' || door.status === 'broken'))));

  return (
    <div className="nq-panel nq-actions">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title">{state.dungeon.name}</p>
          <p className="nq-panel-sub">{type.name} · 第 {state.dungeon.depth} 层 · 回合 {state.stats.turns}</p>
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
          <p className="nq-muted">击杀 {state.stats.kills} · 财宝 {state.stats.treasures} · 金币 {state.hero.coins} · 探到第 {state.stats.deepestDepth} 层</p>
        </div>
      )}

      {inTown && !isOver && (
        <section className="nq-section">
          <h3 className="nq-section-title">城镇</h3>
          <div className="nq-grid-2">
            <button type="button" className="nq-button" disabled={busy || hero.coins < RULES.restCost} onClick={() => onAction({ type: 'town-rest' })}>
              休息（{RULES.restCost} 金币）<em>回满 HP + 恢复全部咒语</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.torches >= RULES.maxTorches || hero.coins < RULES.torchPrice} onClick={() => onAction({ type: 'town-buy-torch', count: 3 })}>
              买 3 个火把（{RULES.torchPrice * 3} 金币）<em>最多带 {RULES.maxTorches} 个</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.treasure <= 0} onClick={() => onAction({ type: 'town-reward-treasure', count: 1 })}>
              兑换财宝（掷奖励表）<em>1 个财宝 = 1 次奖励表</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.treasure <= 1} onClick={() => onAction({ type: 'town-reward-treasure', count: hero.treasure })}>
              兑换全部财宝（{hero.treasure}）
            </button>
          </div>
          <button type="button" className="nq-button nq-button-primary" disabled={busy} onClick={() => onAction({ type: 'return-dungeon' })}>
            返回地牢 <em>消耗 1 个火把；重进每个空房间都要再掷怪物表</em>
          </button>
          <p className="nq-muted">出售物品在右侧角色面板的背包里；装备护甲也能在那里修理。</p>
        </section>
      )}

      {combat && !isOver && (
        <section className="nq-section nq-combat">
          <h3 className="nq-section-title">
            战斗 · 第 {combat.round} 回合 · {combat.phase === 'player' ? '你的回合' : '怪物回合'}
          </h3>
          <div className="nq-monsters">
            {alive.map((monster) => (
              <button
                key={monster.uid}
                type="button"
                className={`nq-monster${(targetUid ?? alive[0]?.uid) === monster.uid ? ' is-target' : ''}`}
                onClick={() => setTargetUid(monster.uid)}
              >
                <Icon name={monster.isBoss ? 'boss' : 'monster'} className="h-5 w-5" />
                <span className="nq-monster-name">{monsterLabel(monster)}</span>
                <span className="nq-monster-hp">{monster.hp} / {monster.maxHp} HP · 伤害 {monster.damage + monster.bonusDamage}</span>
                {monster.killsOnHit && <span className="nq-badge-danger">下一次攻击必杀你</span>}
                {monster.stunned && <span className="nq-badge-info">冰冻中</span>}
              </button>
            ))}
          </div>

          {combat.awaitingDamageTarget ? (
            <div className="nq-damage-choice">
              <p className="nq-note nq-note-warn">
                {combat.pendingDamageFrom} 造成 {combat.pendingDamage} 点伤害
                {combat.pendingDamageUnabsorbable ? '（剧毒：护甲无法吸收）' : ''}，选一边承受：
              </p>
              <div className="nq-grid-2">
                <button type="button" className="nq-button" disabled={busy} onClick={() => onAction({ type: 'allocate-damage', target: 'hp' })}>
                  由 HP 承受（{hero.hp} HP）
                </button>
                {hero.armors.map((armor) => (
                  <button
                    key={armor.uid}
                    type="button"
                    className="nq-button"
                    disabled={busy || combat.pendingDamageUnabsorbable}
                    onClick={() => onAction({ type: 'allocate-damage', target: 'armor', armorUid: armor.uid })}
                  >
                    {armor.name} 承受（{armor.hp} HP）
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="nq-button nq-button-primary"
                disabled={busy || !weaponUsable(hero, hero.weapon)}
                onClick={() => onAction({ type: 'attack', targetUid: targetUid ?? alive[0]?.uid ?? '' })}
              >
                攻击 {alive.find((monster) => monster.uid === (targetUid ?? alive[0]?.uid))?.name ?? ''}
                <em>{hero.weapon.name} {hero.weapon.damage}{weaponUsable(hero, hero.weapon) ? '' : '（双手武器现在用不了）'}</em>
              </button>
              <div className="nq-spell-row">
                {hero.spells.map((spell, index) => (
                  <button
                    key={`${spell.spellId}-${index}`}
                    type="button"
                    className="nq-mini"
                    disabled={busy || spell.spent}
                    onClick={() => onAction({ type: 'cast-spell', spellIndex: index, targetUid: targetUid ?? alive[0]?.uid })}
                  >
                    {spell.name}{spell.spent ? '（已用）' : ''}
                  </button>
                ))}
              </div>
              {hero.items.some((item) => item.use && item.use !== 'none') && (
                <div className="nq-spell-row">
                  {hero.items.filter((item) => item.use && item.use !== 'none').map((item) => (
                    <button key={item.uid} type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'use-item', itemUid: item.uid })}>
                      用 {item.name}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {!inTown && !isOver && (
        <section className="nq-section">
          <h3 className="nq-section-title">
            {node.kind === 'boss' ? '最终房间'
              : node.kind === 'room' ? `房间（${{ small: '小', medium: '中等', wide: '宽', large: '大' }[node.size ?? 'medium']}）`
                : node.kind === 'stairs' ? '向下的楼梯'
                  : node.kind === 'entrance' ? '地牢入口' : '走廊'}
          </h3>
          {node.contentText && <p className="nq-note">{node.contentText}</p>}
          {node.chest && !node.chest.opened && <p className="nq-note">房间里有一个{node.chest.big ? '大' : ''}宝箱。</p>}
          {node.hasSecretPassage && !node.secretPassageSearched && <p className="nq-note">这里的结构不太对劲：可能有密道。</p>}
          {node.corpse && !node.corpse.devoured && <p className="nq-note">地上留着 {node.corpse.name} 的尸体。</p>}
          {node.sneaked && alive.length > 0 && <p className="nq-note">这里还有 {alive.length} 个怪物，但你安静地绕过了它们。</p>}
          {blocked && <p className="nq-note nq-note-warn">先解决这个片段里的怪物：在打倒它们之前，开门和搜刮都不行。</p>}
          {node.doors.some((door) => door.status === 'closed' || door.status === 'locked') && (
            <p className="nq-muted">这个片段还有没处理的门：点地图上的门标记，掷开门表看看门后是什么。</p>
          )}

          {!combat && (
            <div className="nq-grid-2">
              <button type="button" className="nq-button" disabled={busy || alive.length === 0 || hero.torches <= 0}
                onClick={() => onAction({ type: 'enter-node', nodeId: node.id, sneak: true })}>
                安静移动穿过这里（1 火把）<em>每个怪物掷 1d6，掷出 1 就被发现</em>
              </button>
              <button type="button" className="nq-button" disabled={busy || !node.hasSecretPassage || node.secretPassageSearched || hero.torches <= 0}
                onClick={() => onAction({ type: 'search-secret-passage', nodeId: node.id })}>
                寻找密道（1 火把）
              </button>
              <button type="button" className="nq-button" disabled={busy || !node.chest || node.chest.opened}
                onClick={() => onAction({ type: 'open-chest', nodeId: node.id })}>
                打开宝箱<em>2d6：高值是金币、低值是财宝，双 1 会触发陷阱</em>
              </button>
              <button type="button" className="nq-button" disabled={busy || node.kind !== 'stairs'}
                onClick={() => onAction({ type: 'descend', nodeId: node.id })}>
                走下楼梯<em>第 {RULES.finalRoomDepth} 层就是最终房间（Boss）</em>
              </button>
              {alive.length === 0 && (
                <button type="button" className="nq-button" disabled={busy} onClick={() => onAction({ type: 'to-town' })}>
                  回城镇补给<em>回城路上必须没有怪物</em>
                </button>
              )}
              <button type="button" className="nq-button" disabled={busy || !node.corpse || node.corpse.devoured || !heroHooks(hero).healFullOnDevour}
                onClick={() => onAction({ type: 'devour', nodeId: node.id })}>
                吞噬尸体<em>{heroHooks(hero).healFullOnDevour ? '史莱姆人：回满 HP' : '只有史莱姆人能吞噬尸体'}</em>
              </button>
            </div>
          )}

          {reachable.length > 0 && (
            <>
              <h3 className="nq-section-title">走到相邻片段</h3>
              {reachable.map((item) => (
                <div key={item.id} className="nq-row nq-row-action">
                  <Icon name={item.kind === 'room' ? 'room' : item.kind === 'stairs' ? 'stairs' : item.kind === 'boss' ? 'boss' : 'corridor'} className="h-4 w-4" />
                  <span className="nq-row-main">
                    {item.kind === 'room' ? '房间' : item.kind === 'stairs' ? '楼梯' : item.kind === 'boss' ? '最终房间' : '走廊'}
                    <em>{item.visited ? (aliveMonsters(item).length ? `${aliveMonsters(item).length} 个怪物` : '已经探索过') : '还没进去过'}</em>
                  </span>
                  <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'enter-node', nodeId: item.id })}>进入</button>
                  <button type="button" className="nq-mini nq-mini-ghost" disabled={busy || hero.torches <= 0}
                    onClick={() => onAction({ type: 'enter-node', nodeId: item.id, sneak: true })}>安静进入</button>
                </div>
              ))}
            </>
          )}

          <details className="nq-details">
            <summary>行动规则速查</summary>
            {CORE.dungeonActions.map((action) => (
              <p key={action.id} className="nq-muted"><strong>{action.name}</strong>（{action.torches} 火把）：{action.text}</p>
            ))}
            {CORE.combat.map((rule) => (
              <p key={rule.id} className="nq-muted"><strong>{rule.name}</strong>：{rule.text}</p>
            ))}
          </details>
        </section>
      )}
    </div>
  );
}