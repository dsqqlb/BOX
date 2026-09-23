'use client';

/**
 * 背包面板（HUD 左下）：10 格上限的背包、财宝与钥匙、可使用的道具。
 *
 * 装备（武器/护甲）在这里也能换；在城里多一个「卖」按钮。
 * 规则判断全在引擎里，面板只负责把按钮排好（不成立的按钮交给引擎回一句 notice）。
 */

import Icon from './Icon';
import { bagCount, type GameAction } from '@/lib/notequest/engine';
import { RULES } from '@/lib/notequest/data';
import type { Item, RunState } from '@/lib/notequest/types';

const USE_LABELS: Record<string, string> = {
  heal: '饮用', spells: '饮用', light: '点亮', luck: '饮用', rage: '饮用', arm: '饮用',
  torch: '使用', 'learn-spell': '研读', scroll: '展开',
};

function itemIcon(item: Item): string {
  if (item.kind === 'armor') return 'shield';
  if (item.kind === 'weapon') return 'sword';
  if (item.kind === 'treasure') return 'spark';
  if (item.kind === 'key') return 'key';
  if (item.kind === 'scroll') return 'scroll';
  if (item.kind === 'potion') return 'potion';
  if (item.light) return 'torch';
  return 'bag';
}

interface BackpackPanelProps {
  state: RunState;
  busy: boolean;
  onAction: (action: GameAction) => void;
}

export default function BackpackPanel({ state, busy, onAction }: BackpackPanelProps) {
  const hero = state.hero;
  const inTown = state.town.inTown;
  const items = hero.items.filter((item) => item.kind !== 'key');

  return (
    <div className="nq-panel nq-hud nq-hud-bag">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title"><Icon name="bag" className="h-4 w-4" /> 背包</p>
          <p className="nq-panel-sub">{bagCount(hero)} / {RULES.maxItems} 格 · 财宝 {hero.treasure} · 钥匙 {hero.keys}</p>
        </div>
        {inTown && hero.treasure > 0 && (
          <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => onAction({ type: 'town-reward-treasure', count: 1 })}>
            兑换 1 个财宝
          </button>
        )}
      </header>

      {items.length === 0 && <p className="nq-muted">背包是空的：地牢里的宝物、遗体和宝箱都会往这里装。</p>}

      <div className="nq-bag-grid">
        {items.map((item) => (
          <div key={item.uid} className={`nq-bag-item nq-bag-${item.kind}`}>
            <span className="nq-bag-icon"><Icon name={itemIcon(item)} className="h-5 w-5" /></span>
            <div className="nq-bag-main">
              <p className="nq-bag-name">{item.name}{item.magic ? ' ✦' : ''}</p>
              <p className="nq-bag-text">
                {item.kind === 'armor' ? `${item.hp ?? 0} / ${item.maxHp ?? item.hp ?? 0} HP · ` : ''}
                {item.text}
              </p>
            </div>
            <div className="nq-bag-actions">
              {item.kind === 'armor' && (
                <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'equip-armor', itemUid: item.uid })}>装备</button>
              )}
              {item.kind === 'weapon' && (
                <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'equip-weapon', itemUid: item.uid })}>换上</button>
              )}
              {item.use && item.use !== 'none' && (
                <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => onAction({ type: 'use-item', itemUid: item.uid })}>
                  {USE_LABELS[item.use] ?? '使用'}
                </button>
              )}
              {inTown && (
                <button type="button" className="nq-mini nq-mini-ghost" disabled={busy} onClick={() => onAction({ type: 'town-sell', itemUid: item.uid })}>
                  卖 {item.kind === 'potion' || item.kind === 'scroll' || item.magic ? '（1d6-1）' : `（${item.value || RULES.itemSellPrice}）`}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {hero.spareWeapons.length > 0 && (
        <section className="nq-section">
          <h3 className="nq-section-title">备用武器</h3>
          {hero.spareWeapons.map((weapon, index) => (
            <p key={`${weapon.name}-${index}`} className="nq-muted">{weapon.name}（{weapon.damage}{weapon.twoHanded ? '，双手' : ''}）</p>
          ))}
        </section>
      )}
    </div>
  );
}