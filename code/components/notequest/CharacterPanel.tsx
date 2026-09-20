'use client';

/**
 * 角色面板：HP、火把、金币、财宝、钥匙、武器、五部位护甲、咒语与背包。
 *
 * 所有按钮都只把动作交给上层 dispatch（engine.applyAction），
 * 面板自己不做规则判断——规则不成立时引擎会回一句 notice。
 */

import Icon from './Icon';
import type { GameAction } from '@/lib/notequest/engine';
import { RULES } from '@/lib/notequest/data';
import type { Item, RunState } from '@/lib/notequest/types';

interface CharacterPanelProps {
  state: RunState;
  busy: boolean;
  onAction: (action: GameAction) => void;
}

const SLOT_LABELS: Record<string, string> = {
  ring: '指环', arm: '臂甲', boots: '靴子', shoulder: '肩甲', helmet: '头盔', chest: '胸甲',
};

const SLOTS = ['ring', 'arm', 'boots', 'shoulder', 'helmet', 'chest'];

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

export default function CharacterPanel({ state, busy, onAction }: CharacterPanelProps) {
  const hero = state.hero;
  const hpRatio = Math.max(0, Math.min(1, hero.hp / Math.max(1, hero.maxHp)));
  const inTown = state.town.inTown;
  const twoHandedBlocked = Boolean(hero.weapon.twoHanded) && !hero.hasLight;
  const bagItems = hero.items.filter((item) => item.kind !== 'key');

  return (
    <div className="nq-panel nq-character">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title">{hero.name}</p>
          <p className="nq-panel-sub">
            {hero.raceName} · {hero.className}{hero.lostArm ? ' · 断臂' : ''}{hero.hasLight ? ' · 有光源' : ''}
          </p>
        </div>
        <span className="nq-chip">
          {state.status === 'active' ? `第 ${state.dungeon.depth} 层` : state.status === 'dead' ? '已阵亡' : '已通关'}
        </span>
      </header>

      <div className="nq-hp">
        <div className="nq-hp-bar"><span className={`nq-hp-fill${hpRatio < 0.3 ? ' is-low' : ''}`} style={{ width: `${hpRatio * 100}%` }} /></div>
        <span className="nq-hp-text"><Icon name="heart" className="h-4 w-4" /> {hero.hp} / {hero.maxHp}</span>
      </div>

      <div className="nq-stats">
        <div className="nq-stat"><Icon name="torch" className="h-4 w-4" /><span>{hero.torches} / {RULES.maxTorches}</span><em>火把</em></div>
        <div className="nq-stat"><Icon name="coin" className="h-4 w-4" /><span>{hero.coins}</span><em>金币</em></div>
        <div className="nq-stat"><Icon name="spark" className="h-4 w-4" /><span>{hero.treasure}</span><em>财宝</em></div>
        <div className="nq-stat"><Icon name="key" className="h-4 w-4" /><span>{hero.keys}</span><em>钥匙</em></div>
      </div>

      {hero.stunned > 0 && <p className="nq-note nq-note-warn">被瘫痪：还要等 {hero.stunned} 个回合。</p>}
      {hero.trapShield > 0 && <p className="nq-note">幸运药水：接下来 {hero.trapShield} 个陷阱会被无视。</p>}
      {twoHandedBlocked && <p className="nq-note nq-note-warn">双手武器要两只手，你却还得举着火把：先用光亮术或找一盏油灯。</p>}

      <section className="nq-section">
        <h3 className="nq-section-title">武器</h3>
        <div className="nq-row">
          <Icon name="sword" className="h-4 w-4" />
          <span className="nq-row-main">
            {hero.weapon.name}
            <em>{hero.weapon.damage}{hero.weapon.twoHanded ? ' · 双手' : ''}{hero.weapon.damageBonus ? ` · +${hero.weapon.damageBonus}` : ''}</em>
          </span>
        </div>
        {hero.items.filter((item) => item.kind === 'weapon').map((item) => (
          <div key={item.uid} className="nq-row nq-row-action">
            <Icon name="sword" className="h-4 w-4" />
            <span className="nq-row-main">{item.name} <em>{item.damage}{item.twoHanded ? ' · 双手' : ''}</em></span>
            <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'equip-weapon', itemUid: item.uid })}>换上</button>
          </div>
        ))}
      </section>

      <section className="nq-section">
        <h3 className="nq-section-title">护甲（每件都有自己的 HP）</h3>
        <div className="nq-armor-grid">
          {SLOTS.map((slot) => {
            const armor = hero.armors.find((item) => item.slot === slot);
            return (
              <div key={slot} className={`nq-armor${armor ? ' is-on' : ''}`}>
                <span className="nq-armor-slot">{SLOT_LABELS[slot]}</span>
                {armor ? (
                  <>
                    <span className="nq-armor-name">{armor.name}</span>
                    <span className="nq-armor-hp">{armor.hp} / {armor.maxHp ?? armor.hp} HP</span>
                    {inTown && (
                      <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'town-repair', itemUid: armor.uid })}>修理</button>
                    )}
                  </>
                ) : (
                  <span className="nq-armor-name nq-muted">空</span>
                )}
              </div>
            );
          })}
        </div>
        {hero.items.filter((item) => item.kind === 'armor').map((item) => (
          <div key={item.uid} className="nq-row nq-row-action">
            <Icon name="shield" className="h-4 w-4" />
            <span className="nq-row-main">{item.name} <em>{item.text}</em></span>
            <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'equip-armor', itemUid: item.uid })}>装备</button>
          </div>
        ))}
      </section>

      <section className="nq-section">
        <h3 className="nq-section-title">咒语</h3>
        {hero.spells.length === 0 && <p className="nq-muted">这个角色没有咒语。</p>}
        {hero.spells.map((spell, index) => (
          <div key={`${spell.spellId}-${index}`} className={`nq-row nq-row-action${spell.spent ? ' is-spent' : ''}`}>
            <Icon name={spell.spellId === 'light' ? 'torch' : spell.spellId === 'heal' ? 'heart' : 'spark'} className="h-4 w-4" />
            <span className="nq-row-main">{spell.name} <em>{spell.effect}</em></span>
            <button type="button" className="nq-mini" disabled={busy || spell.spent} onClick={() => onAction({ type: 'cast-spell', spellIndex: index })}>
              {spell.spent ? '已用' : '施放'}
            </button>
          </div>
        ))}
      </section>

      <section className="nq-section">
        <h3 className="nq-section-title">背包（{bagItems.length} / {RULES.maxItems}）</h3>
        {bagItems.length === 0 && <p className="nq-muted">背包是空的。</p>}
        {bagItems.map((item) => (
          <div key={item.uid} className="nq-row nq-row-action">
            <Icon name={itemIcon(item)} className="h-4 w-4" />
            <span className="nq-row-main">{item.name}{item.magic ? ' ✦' : ''} <em>{item.text}</em></span>
            {item.use && item.use !== 'none' ? (
              <button type="button" className="nq-mini" disabled={busy} onClick={() => onAction({ type: 'use-item', itemUid: item.uid })}>
                {USE_LABELS[item.use] ?? '使用'}
              </button>
            ) : null}
            {inTown && (
              <button type="button" className="nq-mini nq-mini-ghost" disabled={busy} onClick={() => onAction({ type: 'town-sell', itemUid: item.uid })}>
                卖
              </button>
            )}
          </div>
        ))}
      </section>

      <section className="nq-section">
        <h3 className="nq-section-title">能力</h3>
        {hero.abilityNotes.map((note) => <p key={note} className="nq-muted">{note}</p>)}
      </section>
    </div>
  );
}