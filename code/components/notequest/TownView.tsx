'use client';

/**
 * 城镇画面：从地牢回到镇上时切到这一屏（地图、房间都收起来，只剩镇子与商店）。
 *
 * 左列是「商店」——火把、旅馆休息、护甲修理、财宝兑换，全部走引擎的 town-* 动作；
 * 右列是同一个背包面板（在城里多出「卖」按钮）与日志。
 * 准备好之后点「出发」进地牢：会消耗 1 个火把（有替代光源则免费）。
 */

import Icon from './Icon';
import BackpackPanel from './BackpackPanel';
import LogPanel from './LogPanel';
import { RULES } from '@/lib/notequest/data';
import { heroHooks, type GameAction } from '@/lib/notequest/engine';
import type { RunState } from '@/lib/notequest/types';

interface TownViewProps {
  state: RunState;
  busy: boolean;
  onAction: (action: GameAction) => void;
  onOpenTables: () => void;
  onOpenRuns: () => void;
  onBackToMenu: () => void;
}

export default function TownView({ state, busy, onAction, onOpenTables, onOpenRuns, onBackToMenu }: TownViewProps) {
  const hero = state.hero;
  const hooks = heroHooks(hero);
  const torchPrice = RULES.torchPrice;
  const room = Math.max(0, RULES.maxTorches - hero.torches);
  const isOver = state.status !== 'active';

  return (
    <div className="nq-town">
      <div className="nq-town-scene" aria-hidden="true">
        <svg viewBox="0 0 1200 220" preserveAspectRatio="none">
          <defs>
            <linearGradient id="nq-town-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1b2436" />
              <stop offset="55%" stopColor="#2a2130" />
              <stop offset="100%" stopColor="#3a2a22" />
            </linearGradient>
          </defs>
          <rect width="1200" height="220" fill="url(#nq-town-sky)" />
          <circle cx="980" cy="52" r="26" className="nq-town-moon" />
          <path className="nq-town-hill" d="M0 168c120-26 220-8 320 6s200 24 320 8 260-30 360-14 200 20 200 20v32H0z" />
          <g className="nq-town-houses">
            <path d="M120 168V104h56v64zM108 104h80l-40-30z" />
            <path d="M206 168V92h48v76zM196 92h68l-34-26z" />
            <path d="M286 168V116h64v52zM276 116h84l-42-28z" />
            <path d="M410 168V96h52v72zM404 96h64l-32-24z" />
            <path d="M700 168V108h58v60zM690 108h78l-39-28z" />
            <path d="M800 168V86h46v82zM788 86h70l-35-26z" />
            <path d="M880 168V120h70v48zM870 120h90l-45-30z" />
          </g>
          <g className="nq-town-tower">
            <path d="M520 168V64h44v104zM512 64h60l-30-26zM534 40V20h-20V8h20v12z" />
          </g>
          <path className="nq-town-ground" d="M0 168h1200v52H0z" />
        </svg>
        <div className="nq-town-caption">
          <p className="nq-town-title"><Icon name="town" className="h-5 w-5" /> 城镇 · 出发前的准备</p>
          <p className="nq-muted">买火把、休息、修护甲、把财宝换成实物；卖掉不需要的东西再进地牢。</p>
        </div>
      </div>

      <div className="nq-town-grid">
        <section className="nq-panel">
          <header className="nq-panel-head">
            <div>
              <p className="nq-panel-title"><Icon name="coin" className="h-4 w-4" /> 商店</p>
              <p className="nq-panel-sub">
                {hero.name} · 金币 {hero.coins} · 火把 {hero.torches} / {RULES.maxTorches} · HP {hero.hp} / {hero.maxHp}
              </p>
            </div>
            <div className="nq-head-buttons">
              <button type="button" className="nq-mini" onClick={onOpenTables}>表格速查</button>
              <button type="button" className="nq-mini" onClick={onOpenRuns}>存档</button>
              <button type="button" className="nq-mini nq-mini-ghost" onClick={onBackToMenu}>回到人物池</button>
            </div>
          </header>

          {isOver && (
            <div className={`nq-outcome${state.status === 'cleared' ? ' is-win' : ''}`}>
              <p className="nq-outcome-title">{state.status === 'cleared' ? '🎉 通关' : '☠️ 角色阵亡'}</p>
              <p>{state.outcome?.text}</p>
              <p className="nq-muted">回人物池挑下一个角色，或者去存档里看看这条记录。</p>
            </div>
          )}

          <div className="nq-shop-grid">
            <button type="button" className="nq-button" disabled={busy || room <= 0 || hero.coins < torchPrice}
              onClick={() => onAction({ type: 'town-buy-torch', count: 1 })}>
              <Icon name="torch" className="h-4 w-4" /> 买 1 个火把（{torchPrice} 金币）<em>还能再带 {room} 个</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || room <= 0 || hero.coins < torchPrice * 3}
              onClick={() => onAction({ type: 'town-buy-torch', count: 3 })}>
              <Icon name="torch" className="h-4 w-4" /> 买 3 个火把（{torchPrice * 3} 金币）
            </button>
            <button type="button" className="nq-button" disabled={busy || room <= 0 || hero.coins < torchPrice * room}
              onClick={() => onAction({ type: 'town-buy-torch', count: room })}>
              <Icon name="torch" className="h-4 w-4" /> 买满（{torchPrice * room} 金币）<em>装满 {RULES.maxTorches} 个</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.coins < RULES.restCost}
              onClick={() => onAction({ type: 'town-rest' })}>
              <Icon name="heart" className="h-4 w-4" /> 旅馆休息（{RULES.restCost} 金币）<em>回满 HP + 恢复全部咒语</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.treasure <= 0}
              onClick={() => onAction({ type: 'town-reward-treasure', count: 1 })}>
              <Icon name="spark" className="h-4 w-4" /> 兑换 1 个财宝<em>掷奖励表换物品（现有 {hero.treasure} 个）</em>
            </button>
            <button type="button" className="nq-button" disabled={busy || hero.treasure <= 1}
              onClick={() => onAction({ type: 'town-reward-treasure', count: hero.treasure })}>
              <Icon name="spark" className="h-4 w-4" /> 全部兑换（{hero.treasure} 个）
            </button>
          </div>
          <section className="nq-section">
            <h3 className="nq-section-title">护甲修理（每件都有自己的 HP）</h3>
            {hero.armors.length === 0 && <p className="nq-muted">身上没有护甲。地牢里的奖励表能给到护甲。</p>}
            {hero.armors.map((armor) => (
              <div key={armor.uid} className="nq-row nq-row-action">
                <Icon name="shield" className="h-4 w-4" />
                <span className="nq-row-main">{armor.name} <em>{armor.hp} / {armor.maxHp ?? armor.hp} HP</em></span>
                <button
                  type="button"
                  className="nq-mini"
                  disabled={busy || (hooks.repairArmorWithTorch ? hero.torches < RULES.torchPerArmorRepair : hero.coins < RULES.armorRepairCost)}
                  onClick={() => onAction({ type: 'town-repair', itemUid: armor.uid })}
                >
                  {hooks.repairArmorWithTorch ? `用 ${RULES.torchPerArmorRepair} 个火把修` : `修理（${RULES.armorRepairCost} 金币）`}
                </button>
              </div>
            ))}
          </section>

          <section className="nq-section">
            <h3 className="nq-section-title">出发</h3>
            <p className="nq-muted">
              进地牢会消耗 {RULES.torchPerDungeonEntry} 个火把（照亮术/油灯在身就不消耗），
              回到地牢后每个空房间会重新掷怪物表。
            </p>
            <div className="nq-head-buttons">
              <button
                type="button"
                className="nq-button nq-button-primary"
                disabled={busy || isOver || (hero.torches <= 0 && !hero.hasLight)}
                onClick={() => onAction({ type: 'return-dungeon' })}
              >
                <Icon name="dungeon" className="h-4 w-4" /> 进入「{state.dungeon.name}」
                <em>火把 {hero.torches} 个 · 目标第 {state.dungeon.depth} 层（最深 {state.stats.deepestDepth} 层）</em>
              </button>
              <button type="button" className="nq-button" disabled={busy || isOver} onClick={() => onAction({ type: 'abandon' })}>
                放弃这次探索<em>角色会记入墓地，遗体留在原地</em>
              </button>
            </div>
          </section>
        </section>
        <section className="nq-town-side">
          <BackpackPanel state={state} busy={busy} onAction={onAction} />
          <LogPanel log={state.log} />
        </section>
      </div>
    </div>
  );
}