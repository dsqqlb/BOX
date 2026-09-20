'use client';

/**
 * 表格速查：把 core.json / dungeons.json 里所有表铺开看。
 *
 * 玩到一半想确认"3 号格到底是什么"时不用翻规则书；同时也是这份数据的可视化文档，
 * 改完 JSON 刷新页面就能看到新内容（数据驱动，不用改这个组件）。
 */

import { useState } from 'react';
import Icon from './Icon';
import { CORE, listDungeonTypes, segmentsFor, secretPassagesFor, armorsFor, weaponsFor } from '@/lib/notequest/data';
import type { DungeonType } from '@/lib/notequest/types';

function Row({ head, cells }: { head?: boolean; cells: (string | number)[] }) {
  return (
    <tr className={head ? 'nq-table-head' : undefined}>
      {cells.map((cell, index) => (
        <td key={index}>{cell}</td>
      ))}
    </tr>
  );
}

export default function TableViewer({ onClose }: { onClose: () => void }) {
  const types = listDungeonTypes();
  const [typeId, setTypeId] = useState(types[0]?.id ?? 'palace');
  const type: DungeonType = types.find((item) => item.id === typeId) ?? types[0];
  const segments = segmentsFor(type);

  return (
    <div className="nq-modal" role="dialog" aria-modal="true">
      <div className="nq-modal-card">
        <header className="nq-modal-head">
          <div>
            <p className="nq-panel-title">表格速查</p>
            <p className="nq-panel-sub">数据来自 resources/content/notequest/*.json（服务端与前端共用同一份）</p>
          </div>
          <button type="button" className="nq-mini" onClick={onClose}>关闭</button>
        </header>

        <div className="nq-tabs">
          {types.map((item) => (
            <button key={item.id} type="button" className={`nq-tab${item.id === typeId ? ' is-active' : ''}`} onClick={() => setTypeId(item.id)}>
              <Icon name={item.icon ?? 'dungeon'} className="h-4 w-4" /> {item.name}
            </button>
          ))}
        </div>

        <div className="nq-modal-body">
          <section className="nq-table-section">
            <h3 className="nq-section-title">{type.name}（原书第 {type.pageRef} 页）</h3>
            <p className="nq-muted">{type.intro}</p>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">地牢片段 1d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '从楼梯开门', '从走廊开门', '从房间开门']} /></thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((roll) => (
                  <Row key={roll} cells={[
                    roll,
                    segments.stairs.find((entry) => entry.roll === roll)?.text ?? '',
                    segments.corridor.find((entry) => entry.roll === roll)?.text ?? '',
                    segments.room.find((entry) => entry.roll === roll)?.text ?? '',
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">密道 1d6 / 陷阱 1d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '密道', '1d6', '陷阱']} /></thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((roll) => (
                  <Row key={roll} cells={[
                    roll,
                    secretPassagesFor(type).find((entry) => entry.roll === roll)?.text ?? '',
                    roll,
                    type.traps.find((entry) => entry.roll === roll)?.text ?? '',
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">房间内容 2d6 / 怪物 2d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['2d6', '房间内容', '2d6', '怪物']} /></thead>
              <tbody>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((roll) => (
                  <Row key={roll} cells={[
                    roll,
                    type.roomContent.find((entry) => entry.roll === roll)?.text ?? '',
                    roll,
                    (() => {
                      const monster = type.monsters.find((entry) => (entry.roll !== undefined ? entry.roll === roll : roll >= (entry.rollMin ?? -1) && roll <= (entry.rollMax ?? -1)));
                      if (!monster) return '';
                      if (monster.none) return monster.text ?? '这个房间里没有怪物。';
                      const count = monster.countDice ?? (monster.count ?? 1);
                      return `${count} × ${monster.name}（${monster.hp} HP; ${monster.damage} 伤害${monster.affixes?.length ? `; ${monster.affixes.map((id) => CORE.monsterAffixes.find((affix) => affix.id === id)?.name ?? id).join('、')}` : ''}）`;
                    })(),
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">奖励 1d6（财宝 / 奇物 / 魔法物品）</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '财宝', '奇物', '魔法物品']} /></thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((roll) => (
                  <Row key={roll} cells={[
                    roll,
                    type.rewards.treasure.find((entry) => entry.roll === roll)?.text ?? '',
                    (() => {
                      const oddity = type.rewards.oddity.find((entry) => entry.roll === roll);
                      return oddity ? `${oddity.name ?? ''} ${oddity.text}` : '';
                    })(),
                    (() => {
                      const magic = type.rewards.magic.find((entry) => entry.roll === roll);
                      return magic ? `${magic.name ?? ''} ${magic.text}` : '';
                    })(),
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">Boss 1d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '地牢 Boss']} /></thead>
              <tbody>
                {type.boss.map((entry) => (
                  <Row key={entry.roll} cells={[
                    entry.roll,
                    `${entry.intro ?? ''}${entry.name}${entry.en ? ` ${entry.en}` : ''}${entry.count ? ` ×${entry.count}` : ''}${entry.flavor ?? ''}（${entry.hp} HP; ${entry.damage} 伤害${entry.affixes?.length ? `; ${entry.affixes.map((id) => CORE.monsterAffixes.find((affix) => affix.id === id)?.name ?? id).join('、')}` : ''}）`,
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">武器 1d6 / 护甲 1d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '武器', '1d6', '护甲']} /></thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((roll) => {
                  const weapon = weaponsFor(type).find((entry) => (entry.roll !== undefined ? entry.roll === roll : roll >= (entry.rollMin ?? -1) && roll <= (entry.rollMax ?? -1)));
                  const armor = armorsFor(type).find((entry) => entry.roll === roll);
                  return (
                    <Row key={roll} cells={[
                      roll,
                      weapon ? `${weapon.name}（${weapon.damage} 伤害${weapon.twoHanded ? '; 双手' : ''}）` : '',
                      roll,
                      armor ? `${armor.name}（${armor.hp} HP）` : '',
                    ]} />
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">核心表：种族 2d6 / 职业 2d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['2d6', '种族', 'HP / 能力', '职业', 'HP 修正 / 能力 / 起始武器']} /></thead>
              <tbody>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((roll) => {
                  const race = CORE.races.find((entry) => entry.roll === roll);
                  const klass = CORE.classes.find((entry) => entry.roll === roll);
                  return (
                    <Row key={roll} cells={[
                      roll,
                      race?.name ?? '',
                      race ? `${race.hp} HP；${race.ability.text}` : '',
                      klass?.name ?? '',
                      klass ? `${klass.hpBonus >= 0 ? '+' : ''}${klass.hpBonus} HP；${klass.ability.text}；${klass.weapon.name}（${klass.weapon.damage}）` : '',
                    ]} />
                  );
                })}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">咒语 1d6 / 开门 1d6 / 战利品 1d6</h3>
            <table className="nq-table">
              <thead><Row head cells={['1d6', '咒语', '开门', '战利品']} /></thead>
              <tbody>
                {[1, 2, 3, 4, 5, 6].map((roll) => (
                  <Row key={roll} cells={[
                    roll,
                    (() => {
                      const spell = CORE.spells.find((entry) => entry.roll === roll);
                      return spell ? `${spell.name}：${spell.effect}` : '';
                    })(),
                    CORE.doors.find((entry) => entry.roll === roll)?.text ?? '',
                    CORE.loot.find((entry) => roll >= entry.rollMin && roll <= entry.rollMax)?.text ?? '',
                  ]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">怪物词缀（{CORE.monsterAffixes.length} 条）</h3>
            <table className="nq-table">
              <tbody>
                {CORE.monsterAffixes.map((affix) => (
                  <Row key={affix.id} cells={[affix.name, affix.en ?? '', affix.text]} />
                ))}
              </tbody>
            </table>
          </section>

          <section className="nq-table-section">
            <h3 className="nq-section-title">宝箱与城镇</h3>
            <p className="nq-muted">{CORE.chest.text}</p>
            {CORE.townActions.map((action) => (
              <p key={action.id} className="nq-muted"><strong>{action.name}</strong>（{action.cost} 金币）：{action.text}</p>
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}