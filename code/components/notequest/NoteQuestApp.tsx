'use client';

/**
 * NoteQuest 单人地牢探索（/tools/notequest）——容器。
 *
 * 三层结构：
 *   1. 引擎（lib/notequest/engine.ts）：纯函数状态机，一次动作立刻算完，返回新状态 + 刚才的掷骰；
 *   2. 这个容器：三屏切换（人物池 → 城镇 → 地牢）、防抖保存（存档 + 永久地牢 + 人物池）、掷骰回放；
 *   3. 面板组件：StartScreen / CharacterCreator / TownView / MapBoard / StatusPanel / BackpackPanel / RoomPanel。
 *
 * 持久化三件套（都按账户隔离）：
 *   NoteQuestRun        一局 = 一条存档（完整快照，刷新/换设备接着玩）
 *   NoteQuestDungeon    一座永久地牢 = 一张永久地图（含遗体与掉落，换角色进来还是这张图）
 *   NoteQuestCharacter  人物池 = 每个角色一份快照（装备、咒语、金币随身带）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import BackpackPanel from './BackpackPanel';
import CharacterCreator from './CharacterCreator';
import DiceStage from './DiceStage';
import Icon from './Icon';
import MapBoard from './MapBoard';
import RoomPanel from './RoomPanel';
import RunManager from './RunManager';
import StartScreen from './StartScreen';
import StatusPanel from './StatusPanel';
import TableViewer from './TableViewer';
import TownView from './TownView';
import { applyAction, createRun, migrateRun, summarizeDungeon, type GameAction } from '@/lib/notequest/engine';
import {
  RunSync, clearSlotServer, createCharacterServer, deleteCharacterServer, deleteDungeonServer, deleteRunServer,
  fetchCharacters, fetchDungeon, fetchDungeonByType, fetchDungeons, fetchGraves, fetchRun, fetchRuns, fetchSlots,
  saveDungeonServer, updateCharacterServer, type SyncStatus,
} from '@/lib/notequest/api';
import type {
  DungeonNode, DungeonRecordSummary, DoorState, GraveSummary, Hero, HeroRecord, RollRecord, RunState, RunSummary,
  SlotSummary,
} from '@/lib/notequest/types';

const DICE_SCALE_KEY = 'notequest-dice-scale';
const SLOT_KEY = 'notequest-slot';
/** 掷骰记录留多少条（画面上的「掷骰记录」面板 + 3D 回放共用同一份数据结构）。 */
const MAX_ROLL_HISTORY = 40;

const SYNC_LABELS: Record<SyncStatus, string> = {
  idle: '已同步',
  saving: '保存中…',
  saved: '已保存',
  offline: '离线（改动还在浏览器里）',
};

type Screen = 'start' | 'creator' | 'town' | 'dungeon';

export default function NoteQuestApp() {
  const [slot, setSlot] = useState(0);
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [graves, setGraves] = useState<GraveSummary[]>([]);
  const [characters, setCharacters] = useState<HeroRecord[]>([]);
  const [dungeons, setDungeons] = useState<DungeonRecordSummary[]>([]);
  const [rolls, setRolls] = useState<RollRecord[]>([]);
  /** 掷骰记录（目的 + 结果）：一直留在画面上，随时能翻刚才掷了什么。 */
  const [rollHistory, setRollHistory] = useState<RollRecord[]>([]);
  const [editing, setEditing] = useState<HeroRecord | null>(null);
  const [creatorMode, setCreatorMode] = useState<'roll' | 'custom'>('roll');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTables, setShowTables] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [managerTab, setManagerTab] = useState<'runs' | 'graves'>('runs');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [diceScale, setDiceScale] = useState(1);
  const [screen, setScreen] = useState<Screen>('start');

  const syncRef = useRef<RunSync | null>(null);
  const runRef = useRef<RunState | null>(null);
  const slotRef = useRef(0);
  const worldTimerRef = useRef<number | null>(null);
  const worldPendingRef = useRef<RunState | null>(null);
  if (!syncRef.current) syncRef.current = new RunSync(setSyncStatus);
  slotRef.current = slot;

  const playing = rolls.length > 0;
  const blocked = busy || playing;

  /** 三屏切换：没存档就在人物池；人在城镇就是城镇屏；其余是地牢 HUD。 */
  const activeScreen: Screen = !run ? screen : (run.status === 'active' && run.town.inTown && screen !== 'dungeon' ? 'town' : 'dungeon');

  const refreshLists = useCallback(async (target = slotRef.current) => {
    try {
      const [runList, graveList, characterList, dungeonList, slotList] = await Promise.all([
        fetchRuns(target), fetchGraves(target), fetchCharacters(target), fetchDungeons(target), fetchSlots(),
      ]);
      setRuns(runList);
      setGraves(graveList);
      setCharacters(characterList);
      setDungeons(dungeonList);
      setSlots(slotList.slots);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取数据失败。');
    }
  }, []);

  /* ── 首次进入：先读存档栏位，再恢复该栏位里进行中的那一局 ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const storedSlot = Number(window.localStorage.getItem(SLOT_KEY));
        const initialSlot = Number.isInteger(storedSlot) && storedSlot >= 0 && storedSlot < 3 ? storedSlot : 0;
        const scale = Number(window.localStorage.getItem(DICE_SCALE_KEY));
        if (Number.isFinite(scale) && scale > 0) setDiceScale(Math.min(1.6, Math.max(0.5, scale)));
        setSlot(initialSlot);
        slotRef.current = initialSlot;
        syncRef.current?.setSlot(initialSlot);
        const [runList, graveList, characterList, dungeonList, slotList] = await Promise.all([
          fetchRuns(initialSlot), fetchGraves(initialSlot), fetchCharacters(initialSlot), fetchDungeons(initialSlot), fetchSlots(),
        ]);
        if (cancelled) return;
        setRuns(runList);
        setGraves(graveList);
        setCharacters(characterList);
        setDungeons(dungeonList);
        setSlots(slotList.slots);
        const target = runList.find((item) => item.status === 'active');
        if (target) {
          const detail = await fetchRun(target.id);
          if (!cancelled && detail.state) {
            const state = migrateRun(detail.state);
            runRef.current = state;
            syncRef.current?.markCreated(true);
            setRun(state);
          }
        }
      } catch (error) {
        if (!cancelled) setNotice(error instanceof Error ? error.message : '读取存档失败。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** 切换存档栏位：先把当前改动落库，再整套换掉（栏位之间完全隔离）。 */
  const switchSlot = useCallback(async (next: number) => {
    if (next === slotRef.current) return;
    setBusy(true);
    try {
      await syncRef.current?.flush();
      await flushWorld();
      setSlot(next);
      slotRef.current = next;
      syncRef.current?.setSlot(next);
      try { window.localStorage.setItem(SLOT_KEY, String(next)); } catch { /* 忽略 */ }
      runRef.current = null;
      setRun(null);
      setRolls([]);
      setRollHistory([]);
      setScreen('start');
      await refreshLists(next);
      setNotice(`已切换到存档栏位 ${next + 1}：这个栏位里的一切都是独立的。`);
    } finally {
      setBusy(false);
    }
  }, [refreshLists]);
  /* ── 世界同步：永久地牢（含遗体与掉落）+ 人物池快照 ── */
  const flushWorld = useCallback(async () => {
    const pending = worldPendingRef.current;
    worldPendingRef.current = null;
    if (!pending) return;
    try {
      const summary = summarizeDungeon(pending);
      const saved = await saveDungeonServer({
        id: pending.dungeonId,
        typeId: summary.typeId,
        name: summary.name,
        depth: summary.depth,
        rooms: summary.rooms,
        corpses: summary.corpses,
        nodes: summary.nodes,
      }, slotRef.current);
      if (saved.id !== pending.dungeonId) {
        // 首次保存才拿到地牢 id：回填进存档，之后一直更新同一张图
        const next = { ...runRef.current, dungeonId: saved.id } as RunState;
        runRef.current = next;
        setRun(next);
        setDungeons((list) => [saved, ...list.filter((item) => item.id !== saved.id)]);
      }
      if (pending.characterId) {
        await updateCharacterServer(pending.characterId, {
          hero: pending.hero,
          status: pending.status === 'dead' ? 'dead' : 'active',
          lastOutcome: pending.outcome?.text ?? '',
        });
      }
    } catch {
      setSyncStatus('offline');
    }
  }, []);

  const scheduleWorld = useCallback((state: RunState) => {
    worldPendingRef.current = state;
    if (worldTimerRef.current) window.clearTimeout(worldTimerRef.current);
    worldTimerRef.current = window.setTimeout(() => { void flushWorld(); }, 800);
  }, [flushWorld]);

  /* ── 动作分发：引擎算完 → 更新 UI → 排队保存 → 回放掷骰 ── */
  const dispatch = useCallback((action: GameAction) => {
    const current = runRef.current;
    if (!current) return;
    const outcome = applyAction(current, action);
    runRef.current = outcome.state;
    setRun(outcome.state);
    setNotice(outcome.notice ?? '');
    if (outcome.rolls.length) {
      setRolls(outcome.rolls);
      // 每一颗骰子的「目的 + 结果」都留在画面上（掷骰记录面板）
      setRollHistory((history) => [...outcome.rolls.slice().reverse(), ...history].slice(0, MAX_ROLL_HISTORY));
    }
    syncRef.current?.queue(outcome.state);
    scheduleWorld(outcome.state);
    // 城镇 ↔ 地牢的自动切屏
    if (outcome.state.status === 'active') setScreen(outcome.state.town.inTown ? 'town' : 'dungeon');
    if (current.status === 'active' && outcome.state.status !== 'active') {
      void refreshLists();
      if (outcome.state.status === 'dead' && outcome.state.characterId) {
        void updateCharacterServer(outcome.state.characterId, {
          hero: outcome.state.hero,
          status: 'dead',
          lastOutcome: outcome.state.outcome?.text ?? '',
          incrementDeaths: true,
        }).catch(() => undefined);
      }
    }
  }, [refreshLists, scheduleWorld]);

  /* ── 人物池：掷骰建角 / 自定义建角（可改已有角色） ── */
  const handleSaveCharacter = useCallback(async (hero: Hero, editingId?: string) => {
    setBusy(true);
    try {
      if (editingId) {
        const saved = await updateCharacterServer(editingId, { hero });
        setCharacters((list) => list.map((item) => (item.id === saved.id ? saved : item)));
        setNotice(`「${saved.name}」的自定义改动已经保存。`);
      } else {
        const created = await createCharacterServer(hero, slotRef.current);
        setCharacters((list) => [created, ...list]);
        setNotice(`「${created.name}」已经进入人物池（存档栏位 ${slotRef.current + 1}）。`);
      }
      setEditing(null);
      setScreen('start');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存角色失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDeleteCharacter = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await deleteCharacterServer(id);
      setCharacters((list) => list.filter((item) => item.id !== id));
      if (runRef.current?.characterId === id) setNotice('这个角色已从人物池删除，当前存档仍然可以继续玩。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除角色失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDeleteDungeon = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await deleteDungeonServer(id);
      setDungeons((list) => list.filter((item) => item.id !== id));
      setNotice('这张地牢图已经丢弃：下次进入会重新生成一座新的。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除地牢失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  /* ── 出发：挑好角色与地牢 → 建局 → 直接进城镇准备 ── */
  const handleStart = useCallback(async (options: { character: HeroRecord; dungeonTypeId: string; dungeonId?: string }) => {
    setBusy(true);
    try {
      const existing = options.dungeonId
        ? await fetchDungeon(options.dungeonId)
        : await fetchDungeonByType(options.dungeonTypeId, slotRef.current);
      const outcome = createRun({
        hero: options.character.hero,
        characterId: options.character.id,
        name: options.character.name,
        dungeonTypeId: existing?.typeId ?? options.dungeonTypeId,
        dungeon: existing ? { id: existing.id, typeId: existing.typeId, name: existing.name, nodes: existing.nodes } : undefined,
      });
      const state = outcome.state;
      runRef.current = state;
      setRun(state);
      setRolls(outcome.rolls);
      if (outcome.rolls.length) setRollHistory((history) => [...outcome.rolls.slice().reverse(), ...history].slice(0, MAX_ROLL_HISTORY));
      setNotice(existing
        ? `「${state.dungeon.name}」还是上次那张图：${existing.rooms} 个房间、${existing.corpses} 具遗体在等你。`
        : '新的地牢已经画好第一笔：先在城镇里买火把，然后出发。');
      setScreen('town');
      syncRef.current?.markCreated(false);
      syncRef.current?.queue(state);
      scheduleWorld(state);
      await updateCharacterServer(options.character.id, { incrementRuns: true, hero: options.character.hero }).catch(() => undefined);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '创建存档失败。');
    } finally {
      setBusy(false);
    }
  }, [scheduleWorld]);
  /* ── 存档操作 ── */
  const handleLoad = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const detail = await fetchRun(id);
      if (detail.state) {
        const state = migrateRun(detail.state);
        runRef.current = state;
        setRun(state);
        setRolls([]);
        setNotice(state.town.inTown ? '存档已读取：你人在城镇里。' : '存档已读取：你还在第 ' + state.dungeon.depth + ' 层。');
        setShowManager(false);
        setScreen(state.town.inTown ? 'town' : 'dungeon');
        syncRef.current?.markCreated(true);
      } else {
        setNotice('这条存档里的快照读不出来。');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取存档失败。');
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await deleteRunServer(id);
      if (runRef.current?.id === id) {
        runRef.current = null;
        setRun(null);
        setScreen('start');
      }
      await refreshLists();
      setNotice('存档已删除（地牢地图与人物池不受影响）。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  }, [refreshLists]);

  /** 清空存档栏位：该栏位的存档、人物池、地牢图与墓地一起删掉。 */
  const handleClearSlot = useCallback(async (target: number) => {
    setBusy(true);
    try {
      await clearSlotServer(target);
      if (target === slotRef.current) {
        runRef.current = null;
        setRun(null);
        setRolls([]);
        setRollHistory([]);
        setScreen('start');
      }
      await refreshLists();
      setNotice(`存档栏位 ${target + 1} 已清空（其它栏位不受影响）。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '清空栏位失败。');
    } finally {
      setBusy(false);
    }
  }, [refreshLists]);

  /** 回人物池：把当前这一局交还给服务器，然后切换屏幕。 */
  const handleBackToMenu = useCallback(async () => {
    await syncRef.current?.flush();
    await flushWorld();
    setRolls([]);
    setNotice('');
    setScreen('start');
    await refreshLists();
  }, [flushWorld, refreshLists]);

  /* ── 地图交互 ── */
  const handleSelectNode = useCallback((node: DungeonNode) => {
    if (blocked) return;
    if (node.id === runRef.current?.dungeon.currentId) return;
    dispatch({ type: 'enter-node', nodeId: node.id });
  }, [blocked, dispatch]);

  const handleDoor = useCallback((node: DungeonNode, door: DoorState) => {
    if (blocked) return;
    // 锁着的门不弹窗：房间面板里已经排好了「开锁 / 砸开 / 用钥匙」三个按钮
    if (door.status === 'closed') dispatch({ type: 'open-door', nodeId: node.id, doorId: door.id });
    else if (door.status === 'locked') dispatch({ type: 'lockpick', nodeId: node.id, doorId: door.id });
  }, [blocked, dispatch]);
  if (loading) {
    return (
      <main className="nq-app">
        <div className="nq-loading"><Icon name="dice" className="h-6 w-6" /> 正在读取存档…</div>
      </main>
    );
  }

  return (
    <main className="nq-app">
      <header className="nq-topbar">
        <div className="nq-topbar-main">
          <Link href="/" className="nq-back">← 工具箱</Link>
          <h1 className="nq-title"><Icon name="dungeon" className="h-5 w-5" /> NoteQuest 地牢笔记</h1>
          {run && <span className="nq-chip">{run.dungeon.name}</span>}
          {run && <span className="nq-chip nq-chip-soft">第 {run.dungeon.depth} 层</span>}
          {run && <span className="nq-chip nq-chip-soft">{run.hero.name}</span>}
          {run && run.hero.hasLight && <span className="nq-chip nq-chip-soft">有光源</span>}
          <span className="nq-slot-switch" title="存档栏位：一个账号三个，栏位之间完全隔离">
            存档
            {[0, 1, 2].map((index) => (
              <button
                key={index}
                type="button"
                className={`nq-slot-dot${index === slot ? ' is-on' : ''}`}
                disabled={busy}
                onClick={() => { void switchSlot(index); }}
                title={slots[index]?.latestRun ? `栏位 ${index + 1}：${slots[index]?.latestRun?.heroName ?? ''}` : `栏位 ${index + 1}（空）`}
              >
                {index + 1}
              </button>
            ))}
          </span>
        </div>
        <div className="nq-topbar-side">
          <span className={`nq-sync nq-sync-${syncStatus}`}>{SYNC_LABELS[syncStatus]}</span>
          <label className="nq-scale">
            骰子
            <input
              type="range" min={0.6} max={1.4} step={0.1} value={diceScale}
              onChange={(event) => {
                const value = Number(event.target.value);
                setDiceScale(value);
                try { window.localStorage.setItem(DICE_SCALE_KEY, String(value)); } catch { /* 忽略 */ }
              }}
            />
          </label>
          {run && run.status === 'active' && run.town.inTown && (
            <button type="button" className="nq-mini" onClick={() => setScreen('dungeon')}>看地图</button>
          )}
          {run && run.status === 'active' && !run.town.inTown && (
            <button type="button" className="nq-mini" disabled={busy} onClick={() => dispatch({ type: 'to-town' })}>回城镇</button>
          )}
          <button type="button" className="nq-mini" onClick={() => setShowTables(true)}>表格速查</button>
          <button type="button" className="nq-mini" onClick={() => { setShowManager(true); void refreshLists(); }}>存档 / 墓地</button>
          <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => { void handleBackToMenu(); }}>人物池</button>
        </div>
      </header>

      {notice && (
        <div className="nq-notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {activeScreen === 'start' && (
        <StartScreen
          characters={characters}
          dungeons={dungeons}
          graves={graves}
          slots={slots}
          slot={slot}
          busy={busy}
          loading={loading}
          onStart={handleStart}
          onSelectSlot={(next) => { void switchSlot(next); }}
          onClearSlot={(target) => { void handleClearSlot(target); }}
          onNewCharacter={(mode) => { setEditing(null); setCreatorMode(mode); setScreen('creator'); }}
          onEditCharacter={(character) => { setEditing(character); setCreatorMode('custom'); setScreen('creator'); }}
          onDeleteCharacter={handleDeleteCharacter}
          onDeleteDungeon={handleDeleteDungeon}
          onOpenTables={() => setShowTables(true)}
          onOpenRuns={() => { setManagerTab('runs'); setShowManager(true); void refreshLists(); }}
        />
      )}

      {activeScreen === 'creator' && (
        <CharacterCreator
          busy={busy}
          initial={editing ? editing.hero : null}
          editingName={editing ? editing.name : ''}
          initialMode={creatorMode}
          onSave={(hero) => { void handleSaveCharacter(hero, editing ? editing.id : undefined); }}
          onRoll={setRolls}
          onClose={() => { setEditing(null); setScreen('start'); }}
        />
      )}

      {activeScreen === 'town' && run && (
        <TownView
          state={run}
          busy={blocked}
          onAction={dispatch}
          onOpenTables={() => setShowTables(true)}
          onOpenRuns={() => { setManagerTab('runs'); setShowManager(true); void refreshLists(); }}
          onBackToMenu={() => { void handleBackToMenu(); }}
        />
      )}

      {activeScreen === 'dungeon' && run && (
        <div className="nq-hud-grid">
          <section className="nq-panel nq-hud nq-hud-map">
            <header className="nq-panel-head">
              <div>
                <p className="nq-panel-title"><Icon name="map" className="h-4 w-4" /> 地牢地图</p>
                <p className="nq-panel-sub">
                  {run.dungeon.nodes.filter((node) => node.visited).length} / {run.dungeon.nodes.length} 个片段已探索 ·
                  遗体 {run.dungeon.nodes.filter((node) => node.heroGrave && !node.heroGrave.looted).length} 具
                </p>
              </div>
            </header>
            <MapBoard
              nodes={run.dungeon.nodes}
              currentId={run.dungeon.currentId}
              onSelect={handleSelectNode}
              onDoor={handleDoor}
            />
            <p className="nq-muted">
              点房间走进去 · 点门标记掷开门表 · 每个房间都是格子上的占地（小 2×2、中 3×3、宽 4×3、大 4×4），
              相邻房间用墙上的门直接紧贴相连，虚线格子就是原版让你手绘的那张方格纸。地图可以拖拽平移、滚轮缩放。
            </p>
            <details className="nq-details">
              <summary>地牢据说长这样</summary>
              <p className="nq-muted">{run.dungeon.intro}</p>
            </details>
          </section>

          <StatusPanel state={run} busy={blocked} onAction={dispatch} />
          <BackpackPanel state={run} busy={blocked} onAction={dispatch} />
          <RoomPanel
            state={run}
            busy={blocked}
            rolls={rollHistory}
            onAction={dispatch}
            onOpenTables={() => setShowTables(true)}
            onOpenRuns={() => { setManagerTab('runs'); setShowManager(true); void refreshLists(); }}
            onOpenGraves={() => { setManagerTab('graves'); setShowManager(true); void refreshLists(); }}
          />
        </div>
      )}

      {showTables && <TableViewer onClose={() => setShowTables(false)} />}
      {showManager && (
        <RunManager
          runs={runs}
          graves={graves}
          tab={managerTab}
          busy={busy}
          currentId={run?.id ?? null}
          onTabChange={setManagerTab}
          onClose={() => setShowManager(false)}
          onLoad={handleLoad}
          onDelete={handleDelete}
          onCreate={() => { setShowManager(false); setScreen('start'); }}
          onRefresh={() => { void refreshLists(); }}
        />
      )}
      {playing && <DiceStage rolls={rolls} diceScale={diceScale} onDone={() => setRolls([])} />}
    </main>
  );
}