'use client';

/**
 * 开始界面（游戏首页）：存档栏位 + 人物池 + 永久地牢 + 墓地。
 *
 * 流程就是游戏里常见的那套：
 *   0. 先选存档栏位（一个账号三个，栏位之间完全隔离）：栏位里的一切——人物、地牢、遗体、存档——都只属于它；
 *   1. 在人物池里挑一个角色（「掷骰建角」或「自定义建角」，已有角色还能点「自定义」再改）；
 *   2. 再决定去哪：回到某座已经探索过的地牢（地图还是上次的样子，遗体也在），
 *      或者按地牢类型开一座新的；
 *   3. 出发 → 进城镇画面准备，然后进地牢。
 */

import { useState } from 'react';
import Icon from './Icon';
import { listDungeonTypes } from '@/lib/notequest/data';
import type { DungeonRecordSummary, GraveSummary, HeroRecord, SlotSummary } from '@/lib/notequest/types';

interface StartScreenProps {
  characters: HeroRecord[];
  dungeons: DungeonRecordSummary[];
  graves: GraveSummary[];
  slots: SlotSummary[];
  slot: number;
  busy: boolean;
  loading: boolean;
  onStart: (options: { character: HeroRecord; dungeonTypeId: string; dungeonId?: string }) => void;
  onSelectSlot: (slot: number) => void;
  onClearSlot: (slot: number) => void;
  onNewCharacter: (mode: 'roll' | 'custom') => void;
  onEditCharacter: (character: HeroRecord) => void;
  onDeleteCharacter: (id: string) => void;
  onDeleteDungeon: (id: string) => void;
  onOpenTables: () => void;
  onOpenRuns: () => void;
}

const STATUS_LABEL: Record<string, string> = { active: '可出战', dead: '已阵亡', retired: '已退役' };

function stamp(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function StartScreen(props: StartScreenProps) {
  const { characters, dungeons, graves, slots, slot, busy, loading } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(listDungeonTypes()[0].id);
  const selected = characters.find((item) => item.id === selectedId)
    ?? characters.find((item) => item.status === 'active')
    ?? null;

  return (
    <div className="nq-start">
      <section className="nq-panel">
        <header className="nq-panel-head">
          <div>
            <p className="nq-panel-title"><Icon name="scroll" className="h-4 w-4" /> 存档栏位（一个账号三个）</p>
            <p className="nq-panel-sub">先选一个栏位：在这个栏位里做的任何事——人物、地牢地图、遗体、存档——都只属于它，切走就整套换掉</p>
          </div>
        </header>
        <div className="nq-slot-grid">
          {[0, 1, 2].map((index) => {
            const info = slots.find((item) => item.slot === index);
            const active = info?.activeRun ?? null;
            const latest = info?.latestRun ?? null;
            return (
              <article key={index} className={`nq-slot-card${index === slot ? ' is-on' : ''}`}>
                <header>
                  <p className="nq-hero-name">存档 {index + 1}</p>
                  <span className={`nq-run-status ${active ? 'nq-status-active' : 'nq-status-retired'}`}>
                    {active ? '进行中' : latest ? '有历史' : '空'}
                  </span>
                </header>
                {active ? (
                  <p className="nq-muted">
                    {active.heroName} · {active.dungeonName} 第 {active.depth} 层
                    <br />
                    火把 {active.torches} · HP {active.hp}/{active.maxHp} · {stamp(active.updatedAt)}
                  </p>
                ) : latest ? (
                  <p className="nq-muted">上一局：{latest.heroName} · {latest.dungeonName}（{latest.status === 'dead' ? '阵亡' : latest.status === 'victory' ? '凯旋' : '结束'}）· {stamp(latest.updatedAt)}</p>
                ) : (
                  <p className="nq-muted">还没有开局：在这里新建角色、选地牢类型，然后出发。</p>
                )}
                <p className="nq-muted">
                  人物 {info?.characters ?? 0} · 地牢图 {info?.dungeons ?? 0} · 墓地 {info?.graves ?? 0} · 存档 {info?.runs ?? 0}
                  {info?.updatedAt ? ` · 更新 ${stamp(info.updatedAt)}` : ''}
                </p>
                <div className="nq-head-buttons">
                  <button
                    type="button"
                    className={`nq-mini${index === slot ? ' nq-mini-strong' : ''}`}
                    disabled={busy || index === slot}
                    onClick={() => props.onSelectSlot(index)}
                  >
                    {index === slot ? '当前栏位' : '切换到这里'}
                  </button>
                  <button
                    type="button"
                    className="nq-mini nq-mini-ghost"
                    disabled={busy || (!info || (info.runs === 0 && info.characters === 0 && info.dungeons === 0 && info.graves === 0))}
                    onClick={() => props.onClearSlot(index)}
                  >
                    清空栏位
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="nq-panel">
        <header className="nq-panel-head">
          <div>
            <p className="nq-panel-title"><Icon name="skull" className="h-4 w-4" /> 人物池（{characters.length}）</p>
            <p className="nq-panel-sub">每个角色都是独立的：装备、咒语、金币随身带；死了就永久消失，只剩遗体留在地牢里</p>
          </div>
          <div className="nq-head-buttons">
            <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => props.onNewCharacter('roll')}>掷骰建角</button>
            <button type="button" className="nq-mini" disabled={busy} onClick={() => props.onNewCharacter('custom')}>自定义建角</button>
            <button type="button" className="nq-mini" onClick={props.onOpenRuns}>存档</button>
            <button type="button" className="nq-mini" onClick={props.onOpenTables}>表格速查</button>
          </div>
        </header>

        {loading && <p className="nq-muted">正在读取人物池…</p>}
        {!loading && characters.length === 0 && (
          <p className="nq-muted">这个栏位的人物池是空的：点「掷骰建角」随机一个，或者「自定义建角」自己填名字、种族、职业与装备。</p>
        )}
        <div className="nq-card-grid">
          {characters.map((character) => {
            const isSelected = selected?.id === character.id;
            return (
              <article key={character.id} className={`nq-hero-card${isSelected ? ' is-selected' : ''}${character.status !== 'active' ? ' is-down' : ''}`}>
                <header>
                  <p className="nq-hero-name">{character.name}</p>
                  <span className={`nq-run-status nq-status-${character.status === 'dead' ? 'dead' : 'active'}`}>{STATUS_LABEL[character.status]}</span>
                </header>
                <p className="nq-muted">
                  {character.raceName} · {character.className} · {character.maxHp} HP
                </p>
                <p className="nq-muted">
                  下过 {character.runs} 次地牢{character.deaths > 0 ? ` · 阵亡 ${character.deaths} 次` : ''}
                  {character.hero?.torches !== undefined ? ` · 火把 ${character.hero.torches} · 金币 ${character.hero.coins}` : ''}
                </p>
                {character.lastOutcome && <p className="nq-run-outcome">{character.lastOutcome}</p>}
                <p className="nq-muted">
                  {character.hero?.weapon ? `武器：${character.hero.weapon.name}` : '武器：徒手'}
                  {character.hero?.armors?.length ? ` · 护甲：${character.hero.armors[0].name}` : ' · 护甲：布衣'}
                  {character.hero?.coins !== undefined ? ` · 金币 ${character.hero.coins}` : ''}
                </p>
                {(character.hero?.spells?.length ?? 0) > 0 && (
                  <p className="nq-muted">咒语：{character.hero?.spells?.map((spell) => spell.name).join('、')}</p>
                )}
                {(character.hero?.abilityNotes?.length ?? 0) > 0 && (
                  <p className="nq-muted">能力：{character.hero?.abilityNotes?.join('、')}</p>
                )}
                <div className="nq-head-buttons">
                  <button
                    type="button"
                    className={`nq-mini${isSelected ? ' nq-mini-strong' : ''}`}
                    disabled={busy || character.status !== 'active'}
                    onClick={() => setSelectedId(character.id)}
                  >
                    {isSelected ? '已选中' : character.status === 'active' ? '选他/她' : '不能出战'}
                  </button>
                  <button
                    type="button"
                    className="nq-mini"
                    disabled={busy}
                    onClick={() => props.onEditCharacter(character)}
                    title="打开建角器，改名字、种族、职业、属性与装备咒语"
                  >
                    自定义
                  </button>
                  <button type="button" className="nq-mini nq-mini-ghost" disabled={busy} onClick={() => props.onDeleteCharacter(character.id)}>删除</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
      <section className="nq-panel nq-depart">
        <header className="nq-panel-head">
          <div>
            <p className="nq-panel-title"><Icon name="dungeon" className="h-4 w-4" /> 出发</p>
            <p className="nq-panel-sub">
              {selected ? `当前选中：${selected.name}（${selected.raceName}·${selected.className}）` : '先在人物池里点一个「选他/她」'}
            </p>
          </div>
        </header>

        <div className="nq-depart-grid">
          <section className="nq-section">
            <h3 className="nq-section-title">回到已经画过的地牢（{dungeons.length}）</h3>
            <p className="nq-muted">同一张地图、同一批遗体与掉落：换个角色进去也能接着探索。</p>
            {dungeons.length === 0 && <p className="nq-muted">还没有探索过的地牢：下面选一座新的开始。</p>}
            {dungeons.map((dungeon) => (
              <div key={dungeon.id} className="nq-row nq-row-action">
                <Icon name="dungeon" className="h-4 w-4" />
                <span className="nq-row-main">
                  {dungeon.name}
                  <em>
                    {listDungeonTypes().find((type) => type.id === dungeon.typeId)?.name ?? dungeon.typeId} ·
                    房间 {dungeon.rooms} · 最深第 {dungeon.depth} 层
                    {dungeon.corpses > 0 ? ` · 遗体 ${dungeon.corpses}` : ''} · {stamp(dungeon.updatedAt)}
                  </em>
                </span>
                <button
                  type="button"
                  className="nq-mini nq-mini-strong"
                  disabled={busy || !selected}
                  onClick={() => selected && props.onStart({ character: selected, dungeonTypeId: dungeon.typeId, dungeonId: dungeon.id })}
                >
                  进入
                </button>
                <button type="button" className="nq-mini nq-mini-ghost" disabled={busy} onClick={() => props.onDeleteDungeon(dungeon.id)}>弃图</button>
              </div>
            ))}
          </section>

          <section className="nq-section">
            <h3 className="nq-section-title">开一座新地牢</h3>
            <p className="nq-muted">地牢名与布局由骰子决定；同一类型的名字会一直跟着这张图。</p>
            <div className="nq-head-buttons">
              {listDungeonTypes().map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={`nq-mini${typeId === type.id ? ' nq-mini-strong' : ''}`}
                  onClick={() => setTypeId(type.id)}
                >
                  <Icon name={type.icon ?? 'dungeon'} className="h-4 w-4" /> {type.name}
                </button>
              ))}
            </div>
            <p className="nq-muted">{listDungeonTypes().find((type) => type.id === typeId)?.intro}</p>
            <div className="nq-head-buttons">
              <button
                type="button"
                className="nq-button nq-button-primary"
                disabled={busy || !selected}
                onClick={() => selected && props.onStart({ character: selected, dungeonTypeId: typeId })}
              >
                带着 {selected?.name ?? '角色'} 出发<em>进入城镇准备，然后下地牢</em>
              </button>
            </div>
          </section>
        </div>

        <section className="nq-section">
          <h3 className="nq-section-title">墓地（最近的 {Math.min(graves.length, 6)} 条）</h3>
          {graves.length === 0 && <p className="nq-muted">还没有人死在这里：愿你的冒险者活得久一些。</p>}
          {graves.slice(0, 6).map((grave) => (
            <p key={grave.id} className="nq-muted">
              <Icon name="grave" className="h-4 w-4" /> {grave.characterName}（{grave.raceName}·{grave.className}）死在「{grave.dungeonName}」第 {grave.depth} 层 —— {grave.cause}
            </p>
          ))}
        </section>
      </section>
    </div>
  );
}