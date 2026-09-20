'use client';

/**
 * NoteQuest 单人地牢探索（/tools/notequest）
 *
 * 三层结构：
 *   1. 引擎（lib/notequest/engine.ts）：纯函数状态机，一次动作立刻算完，返回新状态 + 刚才的掷骰；
 *   2. 这个容器：把引擎结果放进 React state、用 RunSync 防抖写进 SQLite、把掷骰交给 3D 骰子回放；
 *   3. 面板组件：地图 / 行动 / 角色 / 日志 / 表格速查 / 存档墓地，全部不含规则逻辑。
 *
 * 存档：一局 = 一条 NoteQuestRun（含完整快照）。刷新、换设备都能接着玩；
 * 角色死亡时服务端会自动补一条墓地记录（原书第 24 页那张表）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ActionPanel from './ActionPanel';
import CharacterPanel from './CharacterPanel';
import DiceStage from './DiceStage';
import Icon from './Icon';
import LogPanel from './LogPanel';
import MapBoard from './MapBoard';
import RunManager from './RunManager';
import TableViewer from './TableViewer';
import { applyAction, createRun, type GameAction } from '@/lib/notequest/engine';
import { listDungeonTypes } from '@/lib/notequest/data';
import { RunSync, deleteRunServer, fetchGraves, fetchRun, fetchRuns, type SyncStatus } from '@/lib/notequest/api';
import type { DoorState, DungeonNode, GraveSummary, RollRecord, RunState, RunSummary } from '@/lib/notequest/types';

const DICE_SCALE_KEY = 'notequest-dice-scale';

const SYNC_LABELS: Record<SyncStatus, string> = {
  idle: '已同步',
  saving: '保存中…',
  saved: '已保存',
  offline: '离线（改动还在浏览器里）',
};

export default function NoteQuestApp() {
  const [run, setRun] = useState<RunState | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [graves, setGraves] = useState<GraveSummary[]>([]);
  const [rolls, setRolls] = useState<RollRecord[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showTables, setShowTables] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [managerTab, setManagerTab] = useState<'runs' | 'graves'>('runs');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [diceScale, setDiceScale] = useState(1);
  const [lockedDoor, setLockedDoor] = useState<{ node: DungeonNode; door: DoorState } | null>(null);

  const syncRef = useRef<RunSync | null>(null);
  const runRef = useRef<RunState | null>(null);
  if (!syncRef.current) syncRef.current = new RunSync(setSyncStatus);

  const playing = rolls.length > 0;
  const blocked = busy || playing;

  const refreshLists = useCallback(async () => {
    try {
      const [runList, graveList] = await Promise.all([fetchRuns(), fetchGraves()]);
      setRuns(runList);
      setGraves(graveList);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '读取存档失败。');
    }
  }, []);

  /* ── 首次进入：恢复最近一局进行中的存档 ── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const scale = Number(window.localStorage.getItem(DICE_SCALE_KEY));
        if (Number.isFinite(scale) && scale > 0) setDiceScale(Math.min(1.6, Math.max(0.5, scale)));
        const runList = await fetchRuns();
        if (cancelled) return;
        setRuns(runList);
        setGraves(await fetchGraves());
        const target = runList.find((item) => item.status === 'active') ?? runList[0];
        if (target) {
          const detail = await fetchRun(target.id);
          if (!cancelled && detail.state) {
            runRef.current = detail.state;
            syncRef.current?.markCreated(true);
            setRun(detail.state);
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

  /* ── 动作分发：引擎算完 → 更新 UI → 排队保存 → 回放掷骰 ── */
  const dispatch = useCallback((action: GameAction) => {
    const current = runRef.current;
    if (!current) return;
    const outcome = applyAction(current, action);
    runRef.current = outcome.state;
    setRun(outcome.state);
    setNotice(outcome.notice ?? '');
    setLockedDoor(null);
    if (outcome.rolls.length) setRolls(outcome.rolls);
    syncRef.current?.queue(outcome.state);
    if (current.status === 'active' && outcome.state.status !== 'active') void refreshLists();
  }, [refreshLists]);

  /* ── 存档操作 ── */
  const handleCreate = useCallback(() => {
    setBusy(true);
    try {
      const outcome = createRun({});
      runRef.current = outcome.state;
      setRun(outcome.state);
      setRolls(outcome.rolls);
      setNotice('掷骰决定了你的种族、职业与这次要探索的地牢。');
      setShowManager(false);
      syncRef.current?.markCreated(false);
      syncRef.current?.queue(outcome.state);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleLoad = useCallback(async (id: string) => {
    setBusy(true);
    try {
      const detail = await fetchRun(id);
      if (detail.state) {
        runRef.current = detail.state;
        setRun(detail.state);
        setRolls([]);
        setNotice('');
        setShowManager(false);
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
      }
      await refreshLists();
      setNotice('存档已删除。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除失败。');
    } finally {
      setBusy(false);
    }
  }, [refreshLists]);

  /* ── 地图交互 ── */
  const handleSelectNode = useCallback((node: DungeonNode) => {
    if (blocked) return;
    if (node.id === runRef.current?.dungeon.currentId) return;
    dispatch({ type: 'enter-node', nodeId: node.id });
  }, [blocked, dispatch]);

  const handleDoor = useCallback((node: DungeonNode, door: DoorState) => {
    if (blocked) return;
    if (door.status === 'locked') {
      setLockedDoor({ node, door });
      return;
    }
    if (door.status === 'closed') dispatch({ type: 'open-door', nodeId: node.id, doorId: door.id });
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
          {run && run.hero.hasLight && <span className="nq-chip nq-chip-soft">有光源</span>}
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
          <button type="button" className="nq-mini" onClick={() => setShowTables(true)}>表格速查</button>
          <button type="button" className="nq-mini" onClick={() => { setShowManager(true); void refreshLists(); }}>存档 / 墓地</button>
          <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={handleCreate}>新的一局</button>
        </div>
      </header>

      {run && (
        <div className="nq-titlebar">
          <input
            className="nq-title-input"
            value={run.title}
            maxLength={60}
            onChange={(event) => dispatch({ type: 'rename', title: event.target.value })}
            aria-label="存档标题"
          />
          <span className="nq-muted">种族 {run.hero.raceName} · 职业 {run.hero.className} · 回合 {run.stats.turns} · 击杀 {run.stats.kills}</span>
        </div>
      )}

      {notice && (
        <div className="nq-notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      {lockedDoor && (
        <div className="nq-locked">
          <p className="nq-locked-title">这扇门是锁着的，你想怎么办？</p>
          <div className="nq-head-buttons">
            <button type="button" className="nq-mini nq-mini-strong" disabled={blocked}
              onClick={() => dispatch({ type: 'lockpick', nodeId: lockedDoor.node.id, doorId: lockedDoor.door.id })}>
              开锁（1 火把）
            </button>
            <button type="button" className="nq-mini" disabled={blocked}
              onClick={() => dispatch({ type: 'smash', nodeId: lockedDoor.node.id, doorId: lockedDoor.door.id })}>
              砸开（怪物会先手）
            </button>
            <button type="button" className="nq-mini" disabled={blocked || !run?.hero.keys}
              onClick={() => dispatch({ type: 'use-key', nodeId: lockedDoor.node.id, doorId: lockedDoor.door.id })}>
              用钥匙（{run?.hero.keys ?? 0}）
            </button>
            <button type="button" className="nq-mini nq-mini-ghost" onClick={() => setLockedDoor(null)}>先不管</button>
          </div>
        </div>
      )}

      {run && run.status === 'active' && run.town.inTown && (
        <div className="nq-townbar">
          <span>你还在城镇里：买火把、休息、修护甲都在行动面板里。准备好了就出发——进入地牢会消耗 1 个火把。</span>
          <button type="button" className="nq-mini nq-mini-strong" disabled={blocked} onClick={() => dispatch({ type: 'return-dungeon' })}>
            返回地牢
          </button>
        </div>
      )}

      {!run ? (
        <section className="nq-intro">
          <h2>掷骰进入地牢</h2>
          <p>
            单人地牢探索游戏：掷 2d6 决定种族与职业，进入一座随你开门而逐步出现的地牢，
            用火把换时间、用运气换财宝。角色死亡会永久消失（只留下尸体和背包），
            所以先去酒馆听个传闻、再决定要不要往下走。
          </p>
          <div className="nq-grid-2">
            <button type="button" className="nq-button nq-button-primary" disabled={busy} onClick={handleCreate}>
              掷骰开始新的一局<em>随机种族、职业、咒语与地牢名</em>
            </button>
            <button type="button" className="nq-button" onClick={() => { setShowManager(true); void refreshLists(); }}>
              读取存档（{runs.length}）
            </button>
          </div>
          <h3 className="nq-section-title">可能的六类地牢（由地牢名的第三部分决定）</h3>
          <ul className="nq-intro-list">
            {listDungeonTypes().map((type) => (
              <li key={type.id}>
                <Icon name={type.icon ?? 'dungeon'} className="h-5 w-5" />
                <div>
                  <p className="nq-row-main">{type.name} <em>原书第 {type.pageRef} 页</em></p>
                  <p className="nq-muted">{type.intro}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="nq-muted">
            规则数据来自参考文件里的《NoteQuest 中文版核心规则书》；想加内容直接改
            resources/content/notequest/*.json（同目录的 README.md 有扩展说明）。
          </p>
        </section>
      ) : (
        <div className="nq-grid">
          <section className="nq-col nq-col-map">
            <MapBoard
              nodes={run.dungeon.nodes}
              currentId={run.dungeon.currentId}
              onSelect={handleSelectNode}
              onDoor={handleDoor}
            />
            <p className="nq-muted">
              点门标记掷开门表（1 = 陷阱、2-3 = 锁住、4-6 = 没锁）；点已经探索过的片段可以走回去。
            </p>
            <details className="nq-details">
              <summary>地牢据说长这样</summary>
              <p className="nq-muted">{run.dungeon.intro}</p>
            </details>
          </section>

          <section className="nq-col">
            <ActionPanel
              state={run}
              busy={blocked}
              onAction={dispatch}
              onOpenTables={() => setShowTables(true)}
              onOpenRuns={() => { setManagerTab('runs'); setShowManager(true); void refreshLists(); }}
              onOpenGraves={() => { setManagerTab('graves'); setShowManager(true); void refreshLists(); }}
            />
          </section>

          <section className="nq-col">
            <CharacterPanel state={run} busy={blocked} onAction={dispatch} />
            <LogPanel log={run.log} />
          </section>
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
          onCreate={handleCreate}
          onRefresh={() => { void refreshLists(); }}
        />
      )}
      {playing && <DiceStage rolls={rolls} diceScale={diceScale} onDone={() => setRolls([])} />}
    </main>
  );
}