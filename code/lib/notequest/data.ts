/**
 * NoteQuest 规则数据访问层。
 *
 * JSON 直接 import 进来（`@content` 指向 resources/content），服务端与前端读的是同一份文件，
 * 规则不会两头走样（和 content/scratch/ 的做法一致）。想加内容不用改这里，改 JSON 即可。
 */

import coreJson from '@content/notequest/core.json';
import dungeonsJson from '@content/notequest/dungeons.json';
import type {
  AffixDef, ArmorTableEntry, ClassDef, CoreData, DungeonType, DungeonsData, NoteQuestRules,
  RaceDef, SecretPassageEntry, SegmentsTable, SpellDef, WeaponEntry,
} from './types';

export const CORE = coreJson as unknown as CoreData;
export const DUNGEONS = dungeonsJson as unknown as DungeonsData;
export const RULES: NoteQuestRules = CORE.rules;

export const DUNGEON_NAME_TABLE = (coreJson as unknown as {
  dungeonName: {
    note?: string;
    prefix: { roll: number; text: string }[];
    middle: { roll: number; text: string }[];
    suffix: { roll: number; text: string; typeId: string }[];
  };
}).dungeonName;

export function listDungeonTypes(): DungeonType[] {
  return DUNGEONS.types;
}

export function getDungeonType(id: string): DungeonType {
  return DUNGEONS.types.find((type) => type.id === id) ?? DUNGEONS.types[0];
}

/** 地牢片段表：某一类地牢自己写了就用它的，否则用 core 里共用的那张。 */
export function segmentsFor(type: DungeonType): SegmentsTable {
  return type.segments ?? CORE.segments;
}

export function secretPassagesFor(type: DungeonType): SecretPassageEntry[] {
  return type.secretPassages ?? CORE.secretPassages;
}

export function armorsFor(type: DungeonType): ArmorTableEntry[] {
  return type.armors ?? CORE.armors;
}

export function weaponsFor(type: DungeonType): WeaponEntry[] {
  return type.weapons;
}

const AFFIX_BY_ID = new Map<string, AffixDef>(CORE.monsterAffixes.map((affix) => [affix.id, affix]));

export function affixById(id: string): AffixDef | undefined {
  return AFFIX_BY_ID.get(id);
}

export function affixNames(ids: string[]): string[] {
  return ids.map((id) => affixById(id)?.name ?? id);
}

const SPELL_BY_ID = new Map<string, SpellDef>(CORE.spells.map((spell) => [spell.id, spell]));

export function spellById(id: string): SpellDef | undefined {
  return SPELL_BY_ID.get(id);
}

export function raceById(id: string): RaceDef | undefined {
  return CORE.races.find((race) => race.id === id);
}

export function classById(id: string): ClassDef | undefined {
  return CORE.classes.find((item) => item.id === id);
}

export function doorEntryFor(roll: number) {
  return CORE.doors.find((entry) => entry.roll === roll) ?? CORE.doors[CORE.doors.length - 1];
}

export function lootEntryFor(roll: number) {
  return CORE.loot.find((entry) => roll >= entry.rollMin && roll <= entry.rollMax) ?? CORE.loot[CORE.loot.length - 1];
}

/** 图标名（给 Icon.tsx 用）：地牢类型自带 icon，缺失时回退到通用地牢图标。 */
export function iconForDungeon(type: DungeonType | undefined): string {
  return type?.icon || 'dungeon';
}