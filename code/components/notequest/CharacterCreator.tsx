'use client';

/**
 * 建角器：一个独立的人物界面，可以「掷骰」也可以「自定义」，建好存进人物池。
 *
 *   - 掷骰：2d6 决定种族与职业，咒语按能力掷出来（掷骰交给上层用 3D 骰子回放）；
 *   - 自定义：自己挑种族 / 职业 / 咒语，自己起名，还能决定开局火把与金币；
 *   - 右边永远是同一个「结果预览」，两种模式建出来的角色长得一模一样。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { buildHero } from '@/lib/notequest/engine';
import { CORE, RULES } from '@/lib/notequest/data';
import type { Hero, RollRecord } from '@/lib/notequest/types';

interface CharacterCreatorProps {
  busy: boolean;
  /** 编辑已有角色时带进来的快照（null = 新建） */
  initial: Hero | null;
  /** 编辑已有角色时的原名字（只用来显示标题） */
  editingName: string;
  /** 打开时默认停在哪个模式 */
  initialMode: 'roll' | 'custom';
  onSave: (hero: Hero) => void;
  onRoll: (rolls: RollRecord[]) => void;
  onClose: () => void;
}

export default function CharacterCreator({ busy, initial, editingName, initialMode, onSave, onRoll, onClose }: CharacterCreatorProps) {
  const [mode, setMode] = useState<'roll' | 'custom'>(initialMode);
  const [name, setName] = useState(initial?.name ?? '');
  const [raceId, setRaceId] = useState(initial?.raceId ?? CORE.races[0].id);
  const [classId, setClassId] = useState(initial?.classId ?? CORE.classes[0].id);
  const [spellIds, setSpellIds] = useState<string[]>(initial?.spells.map((spell) => spell.spellId) ?? []);
  const [torches, setTorches] = useState(initial?.torches ?? RULES.startingTorches);
  const [coins, setCoins] = useState(initial?.coins ?? RULES.startingCoins);
  const [draft, setDraft] = useState<Hero | null>(initial ?? null);

  /** 掷骰建角：结果直接进预览，掷骰记录交给上层回放。 */
  const roll = useCallback(() => {
    const outcome = buildHero({});
    setDraft(outcome.hero);
    setRaceId(outcome.hero.raceId);
    setClassId(outcome.hero.classId);
    setName(outcome.hero.name);
    setSpellIds(outcome.hero.spells.map((spell) => spell.spellId));
    onRoll(outcome.rolls);
  }, [onRoll]);

  /** 自定义建角：全部参数自己给，一次骰子都不掷（名字也是自己写）。 */
  const preview = useMemo(() => {
    if (mode === 'roll') return draft;
    return buildHero({ name, raceId, classId, spellIds, torches, coins }).hero;
  }, [mode, draft, name, raceId, classId, spellIds, torches, coins]);

  useEffect(() => {
    if (mode === 'roll' && !draft) roll();
  }, [mode, draft, roll]);

  const race = CORE.races.find((item) => item.id === raceId) ?? CORE.races[0];
  const klass = CORE.classes.find((item) => item.id === classId) ?? CORE.classes[0];

  return (
    <div className="nq-panel nq-creator">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title"><Icon name="die" className="h-4 w-4" /> {initial ? `自定义角色：${editingName || initial.name}` : '新建人物'}</p>
          <p className="nq-panel-sub">
            {initial
              ? '改名字、种族、职业、咒语与开局火把金币，保存后覆盖人物池里的这一位（存档与遗体不受影响）'
              : '掷骰或自定义都行；建好存进人物池，任何一局都能挑他/她下地牢'}
          </p>
        </div>
        <div className="nq-head-buttons">
          <button type="button" className={`nq-mini${mode === 'roll' ? ' nq-mini-strong' : ''}`} onClick={() => setMode('roll')}>掷骰建角</button>
          <button type="button" className={`nq-mini${mode === 'custom' ? ' nq-mini-strong' : ''}`} onClick={() => setMode('custom')}>自定义建角</button>
          <button type="button" className="nq-mini nq-mini-ghost" onClick={onClose}>返回</button>
        </div>
      </header>

      <div className="nq-creator-grid">
        <section className="nq-section">
          {mode === 'roll' ? (
            <>
              <h3 className="nq-section-title">掷骰决定命运</h3>
              <p className="nq-muted">
                掷 2d6 决定种族，再掷 2d6 决定职业；咒语随种族/职业能力而定。不满意就再掷一次。
              </p>
              <div className="nq-head-buttons">
                <button type="button" className="nq-button nq-button-primary" disabled={busy} onClick={roll}>掷骰</button>
                {draft && (
                  <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => onSave(draft)}>
                    {initial ? '保存改动' : '保存到人物池'}
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h3 className="nq-section-title">自己决定</h3>
              <label className="nq-field">
                <span>名字</span>
                <input value={name} maxLength={24} placeholder={`${race.name}${klass.name}`} onChange={(event) => setName(event.target.value)} />
              </label>
              <label className="nq-field">
                <span>种族（HP 与种族能力）</span>
                <select value={raceId} onChange={(event) => setRaceId(event.target.value)}>
                  {CORE.races.map((item) => <option key={item.id} value={item.id}>{item.name}（{item.hp} HP）</option>)}
                </select>
              </label>
              <label className="nq-field">
                <span>职业（HP 修正、能力与起始武器）</span>
                <select value={classId} onChange={(event) => setClassId(event.target.value)}>
                  {CORE.classes.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}（{item.hpBonus >= 0 ? '+' : ''}{item.hpBonus} HP · {item.weapon.name}）</option>
                  ))}
                </select>
              </label>
              <div className="nq-field">
                <span>咒语（不选就按种族/职业能力来）</span>
                <div className="nq-spell-row">
                  {CORE.spells.map((spell) => {
                    const picked = spellIds.includes(spell.id);
                    return (
                      <button
                        key={spell.id}
                        type="button"
                        className={`nq-mini${picked ? ' nq-mini-strong' : ''}`}
                        onClick={() => setSpellIds(picked ? spellIds.filter((id) => id !== spell.id) : [...spellIds, spell.id])}
                      >
                        {spell.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="nq-field-row">
                <label className="nq-field">
                  <span>开局火把（最多 {RULES.maxTorches}）</span>
                  <input type="number" min={0} max={RULES.maxTorches} value={torches}
                    onChange={(event) => setTorches(Math.max(0, Math.min(RULES.maxTorches, Number(event.target.value) || 0)))} />
                </label>
                <label className="nq-field">
                  <span>开局金币</span>
                  <input type="number" min={0} max={999} value={coins}
                    onChange={(event) => setCoins(Math.max(0, Math.min(999, Number(event.target.value) || 0)))} />
                </label>
              </div>
              <div className="nq-head-buttons">
                <button type="button" className="nq-mini nq-mini-strong" disabled={busy || !preview} onClick={() => preview && onSave(preview)}>
                  {initial ? '保存改动' : '保存到人物池'}
                </button>
              </div>
            </>
          )}
        </section>
        <section className="nq-section nq-creator-preview">
          <h3 className="nq-section-title">结果预览</h3>
          {preview ? (
            <>
              <p className="nq-preview-name">{preview.name}</p>
              <p className="nq-muted">
                {preview.raceName} · {preview.className} · {preview.maxHp} HP · 火把 {preview.torches} · 金币 {preview.coins}
              </p>
              <p className="nq-muted">武器：{preview.weapon.name}（{preview.weapon.damage}{preview.weapon.twoHanded ? '，双手' : ''}）</p>
              {preview.spells.length > 0 && (
                <p className="nq-muted">咒语：{preview.spells.map((spell) => spell.name).join('、')}</p>
              )}
              {preview.abilityNotes.map((note) => <p key={note} className="nq-muted">· {note}</p>)}
            </>
          ) : (
            <p className="nq-muted">先掷一次骰子，或者切到「自定义建角」。</p>
          )}
        </section>
      </div>
    </div>
  );
}