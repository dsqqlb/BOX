'use client';

/**
 * EDH 指挥官记血器（/tools/edh-life）
 *
 * 一张方桌四个人：2×2 中心对称，**贴近自己这一排是正的，对面那一排上下颠倒**。
 *   - 每人一个随机配色色块，大号血量居中
 *   - 色块**分左右两半**：点左半 −1、点右半 +1；按住 1 秒 −5 / +5
 *   - 色块**中央正方形**：双击打开记录面板；按住 2 秒弹「掉血 / 回血 + 记录项目」
 *   - 血量归零或中毒满 10 → 整块变灰 + 骷髅头
 *   - 中间一条窄缝隙：公共的设置 / 骰子 / 硬币 / 历史 / 计时（毛玻璃按钮 + 流光）
 *   - 骰子复用先攻主屏的 3D 引擎；硬币是金色「正 / 反」两面，投掷力度拉满
 *   - 数据：localStorage 立即保存 + SQLite 防抖同步（一个账户一条记录 = 当前这张桌子，含计时与掷骰历史）
 *   - 没有存档系统：不开局、不结束、不读档，状态随时跟着账户走
 *
 * 移动端：禁用一切系统手势（捏合/双击/长按菜单/文本选择/下拉刷新），整页一屏显示不滚动。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DisableZoom from '@/components/common/DisableZoom';
import SeatBlock from '@/components/edh-life/SeatBlock';
import DiceOverlay, { type ActiveRoll } from '@/components/edh-life/DiceOverlay';
import AmountPad, { type AmountPadRequest } from '@/components/edh-life/AmountPad';
import ExpressionPad from '@/components/edh-life/ExpressionPad';
import HistoryPanel from '@/components/edh-life/HistoryPanel';
import CounterPanel from '@/components/edh-life/CounterPanel';
import RotatableModal from '@/components/edh-life/RotatableModal';
import type { DiceRollRequest } from '@/components/dnd/DiceRoller';
import {
  evaluateRecipe, flattenExpression, flattenToRecipe, parseDiceExpression,
  type ExprNode, type FlattenedRecipe,
} from '@/lib/diceExpression';
import {
  COIN_NOTATION, COIN_ROLL_NOTATION, COUNTER_BY_KEY, DEFAULT_DICE_PRESETS, DEFAULT_STARTING_LIFE,
  MAX_DICE_PRESETS, MAX_PLAYERS, MIN_PLAYERS,
  applyElimination, createGame, createPlayer, elapsedSeconds, formatDuration, newId, resizeGame, seatRotation,
  type CounterKey, type GameState, type PlayerState, type RollRecord,
} from '@/lib/edh-life/types';
import {
  GameSync, fetchRunningGame, loadCurrentGameId, loadGameLocal, saveGameLocal,
  setCurrentGameId, type SyncStatus,
} from '@/lib/edh-life/storage';
import { prewarmCoinTextures } from '@/lib/edh-life/coin-textures';

const DICE_SCALE_KEY = 'edh-life-dice-scale';
const PRESETS_KEY = 'edh-life-dice-presets';
const MODAL_FONT_SCALE_KEY = 'edh-life-modal-font-scale';
const MODAL_PANEL_SCALE_KEY = 'edh-life-modal-panel-scale';
const ROTATE_SCALE_KEY = 'edh-life-rotate-icon-scale';
const LIFE_DELTA_VISIBLE_MS = 5000;
/** 先攻定完之后，「1st」这块牌子的高亮再多留一会儿，然后只留名次数字。 */
const FIRST_HIGHLIGHT_MS = 2000;
const DEFAULT_MODAL_FONT_SCALE = 1;
const DEFAULT_MODAL_PANEL_SCALE = 1;
const DEFAULT_ROTATE_SCALE = 1;
const MIN_ROTATE_SCALE = 0.5;
const MAX_ROTATE_SCALE = 2;

function readNumberSetting(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function readPresets(): string[] {
  try {
    const raw = window.localStorage.getItem(PRESETS_KEY);
    if (!raw) return [...DEFAULT_DICE_PRESETS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_DICE_PRESETS];
    const list = parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    return list.length ? list.slice(0, MAX_DICE_PRESETS) : [...DEFAULT_DICE_PRESETS];
  } catch { return [...DEFAULT_DICE_PRESETS]; }
}

function writeSetting(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* 忽略 */ }
}

export default function EdhLifePage() {
  const [game, setGame] = useState<GameState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle');
  const [clock, setClock] = useState(() => Date.now());
  const [amountPad, setAmountPad] = useState<AmountPadRequest | null>(null);
  const [counterPanelSeat, setCounterPanelSeat] = useState<number | null>(null);
  const [historySeat, setHistorySeat] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [showDicePicker, setShowDicePicker] = useState(false);
  const [showExpressionPad, setShowExpressionPad] = useState(false);
  const [diceError, setDiceError] = useState('');
  const [diceScale, setDiceScale] = useState(1);
  const [modalFontScale, setModalFontScale] = useState(DEFAULT_MODAL_FONT_SCALE);
  const [modalPanelScale, setModalPanelScale] = useState(DEFAULT_MODAL_PANEL_SCALE);
  const [rotateScale, setRotateScale] = useState(DEFAULT_ROTATE_SCALE);
  const [presets, setPresets] = useState<string[]>(() => [...DEFAULT_DICE_PRESETS]);

  const [diceRequest, setDiceRequest] = useState<DiceRollRequest | null>(null);
  const [activeRoll, setActiveRoll] = useState<ActiveRoll | null>(null);
  const [lifeDeltas, setLifeDeltas] = useState<Record<number, number>>({});
  const [firstOrder, setFirstOrder] = useState<number[]>([]);
  const [firstHighlight, setFirstHighlight] = useState<number | null>(null);
  const [firstRolling, setFirstRolling] = useState(false);

  const syncRef = useRef<GameSync | null>(null);
  const lifeDeltaTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const lifeDeltaRevisionRef = useRef<Record<number, number>>({});
  const firstDecisionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstDecisionRunRef = useRef(0);
  if (!syncRef.current) syncRef.current = new GameSync((status) => setSyncStatus(status));

  /* ── 本机设置（骰子大小 / 预设骰式）── */
  useEffect(() => {
    setDiceScale(readNumberSetting(DICE_SCALE_KEY, 1));
    setModalFontScale(Math.min(1.4, Math.max(0.8, readNumberSetting(MODAL_FONT_SCALE_KEY, DEFAULT_MODAL_FONT_SCALE))));
    setModalPanelScale(Math.min(1.2, Math.max(0.8, readNumberSetting(MODAL_PANEL_SCALE_KEY, DEFAULT_MODAL_PANEL_SCALE))));
    setRotateScale(Math.min(MAX_ROTATE_SCALE, Math.max(MIN_ROTATE_SCALE, readNumberSetting(ROTATE_SCALE_KEY, DEFAULT_ROTATE_SCALE))));
    setPresets(readPresets());
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--edh-modal-font-scale', String(modalFontScale));
    document.documentElement.style.setProperty('--edh-modal-panel-scale', String(modalPanelScale));
    document.documentElement.style.setProperty('--edh-modal-rotate-scale', String(rotateScale));
  }, [modalFontScale, modalPanelScale, rotateScale]);

  const updateDiceScale = useCallback((value: number) => {
    setDiceScale(value);
    writeSetting(DICE_SCALE_KEY, String(value));
  }, []);

  const updateModalFontScale = useCallback((value: number) => {
    const next = Math.min(1.4, Math.max(0.8, value));
    setModalFontScale(next);
    writeSetting(MODAL_FONT_SCALE_KEY, String(next));
  }, []);

  const updateModalPanelScale = useCallback((value: number) => {
    const next = Math.min(1.2, Math.max(0.8, value));
    setModalPanelScale(next);
    writeSetting(MODAL_PANEL_SCALE_KEY, String(next));
  }, []);

  const updateRotateScale = useCallback((value: number) => {
    const next = Math.min(MAX_ROTATE_SCALE, Math.max(MIN_ROTATE_SCALE, value));
    setRotateScale(next);
    writeSetting(ROTATE_SCALE_KEY, String(next));
  }, []);

  const updatePresets = useCallback((next: string[]) => {
    const clean = next.map((item) => item.trim()).filter(Boolean).slice(0, MAX_DICE_PRESETS);
    const finalList = clean.length ? clean : [...DEFAULT_DICE_PRESETS];
    setPresets(finalList);
    writeSetting(PRESETS_KEY, finalList);
  }, []);

  /* ── 初始化：先本机快照，再尝试服务器恢复；两者都没有就开一局新的 ── */
  useEffect(() => {
    let cancelled = false;
    const localId = loadCurrentGameId();
    const local = localId ? loadGameLocal(localId) : null;
    if (local) setGame(local);

    void (async () => {
      const server = await fetchRunningGame();
      if (cancelled) return;
      if (server) {
        const localStarted = local ? local.startedAt : 0;
        if (!local || server.startedAt >= localStarted) {
          setGame(server);
          saveGameLocal(server);
          setCurrentGameId(server.id);
        }
        syncRef.current?.setCreated(true, server.id);
        setSyncStatus('saved');
        return;
      }
      if (!local) {
        setGame(createGame(MAX_PLAYERS, DEFAULT_STARTING_LIFE));
        setSyncStatus('offline');
        return;
      }
      syncRef.current?.setCreated(false);
      setSyncStatus('offline');
    })();

    return () => { cancelled = true; };
  }, []);

  /* ── 硬币贴图预热 ── */
  useEffect(() => {
    let cancelled = false;
    void prewarmCoinTextures().catch((error) => {
      if (!cancelled) console.error('[edh-life] 硬币贴图预热失败：', error);
    });
    return () => { cancelled = true; };
  }, []);

  /* ── 落盘：本机立即写，服务器防抖同步 ── */
  useEffect(() => {
    if (!game) return;
    saveGameLocal(game);
    setCurrentGameId(game.id);
    syncRef.current?.queue(game);
  }, [game]);

  /* 离开页面（切走/刷新/关页）就暂停计时：回来时点「开始对局」继续。
     同时把没同步完的进度推上去，避免丢掉最后几次记血。 */
  useEffect(() => {
    const pauseAndFlush = () => {
      void syncRef.current?.flush();
      setGame((current) => {
        if (!current || !current.timer.running) return current;
        const now = Date.now();
        return {
          ...current,
          timer: {
            base: current.timer.base + Math.max(0, now - current.timer.startedAtMs),
            running: false,
            startedAtMs: now,
          },
        };
      });
    };
    window.addEventListener('pagehide', pauseAndFlush);
    window.addEventListener('beforeunload', pauseAndFlush);
    return () => {
      window.removeEventListener('pagehide', pauseAndFlush);
      window.removeEventListener('beforeunload', pauseAndFlush);
    };
  }, []);

  /* ── 计时：每秒刷新显示 ── */
  useEffect(() => {
    if (!game) return;
    setClock(Date.now());
    if (!game.timer.running) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [game]);

  /* ── 状态更新助手 ── */
  const updatePlayers = useCallback((updater: (players: PlayerState[]) => PlayerState[]) => {
    setGame((current) => (current ? { ...current, players: updater(current.players).map(applyElimination) } : current));
  }, []);

  const clearLifeDeltas = useCallback(() => {
    Object.values(lifeDeltaTimersRef.current).forEach(clearTimeout);
    lifeDeltaTimersRef.current = {};
    lifeDeltaRevisionRef.current = {};
    setLifeDeltas({});
  }, []);

  const resetFirstDecision = useCallback(() => {
    firstDecisionRunRef.current += 1;
    if (firstDecisionTimerRef.current !== null) {
      clearTimeout(firstDecisionTimerRef.current);
      firstDecisionTimerRef.current = null;
    }
    if (firstHighlightTimerRef.current !== null) {
      clearTimeout(firstHighlightTimerRef.current);
      firstHighlightTimerRef.current = null;
    }
    setFirstOrder([]);
    setFirstHighlight(null);
    setFirstRolling(false);
  }, []);

  useEffect(() => () => {
    Object.values(lifeDeltaTimersRef.current).forEach(clearTimeout);
    if (firstDecisionTimerRef.current !== null) clearTimeout(firstDecisionTimerRef.current);
    if (firstHighlightTimerRef.current !== null) clearTimeout(firstHighlightTimerRef.current);
  }, []);

  const changeLife = useCallback((seat: number, delta: number) => {
    if (delta === 0) return;
    const previousTimer = lifeDeltaTimersRef.current[seat];
    if (previousTimer !== undefined) clearTimeout(previousTimer);
    const revision = (lifeDeltaRevisionRef.current[seat] ?? 0) + 1;
    lifeDeltaRevisionRef.current[seat] = revision;
    setLifeDeltas((current) => ({ ...current, [seat]: (current[seat] ?? 0) + delta }));
    lifeDeltaTimersRef.current[seat] = setTimeout(() => {
      if (lifeDeltaRevisionRef.current[seat] !== revision) return;
      delete lifeDeltaTimersRef.current[seat];
      delete lifeDeltaRevisionRef.current[seat];
      setLifeDeltas((current) => {
        if (!(seat in current)) return current;
        const next = { ...current };
        delete next[seat];
        return next;
      });
    }, LIFE_DELTA_VISIBLE_MS);
    updatePlayers((players) => players.map((player) => (player.seat === seat ? { ...player, life: player.life + delta } : player)));
  }, [updatePlayers]);

  /* ── 先攻决定：按桌面视觉顺序轮盘高亮，随机方向、随机落点。 ── */
  const decideFirst = useCallback(() => {
    if (!game) return;
    if (firstDecisionTimerRef.current !== null) clearTimeout(firstDecisionTimerRef.current);
    firstDecisionRunRef.current += 1;
    const run = firstDecisionRunRef.current;

    const allSeats = game.players.map((player) => player.seat);
    const visualOrder = game.playerCount === 4
      ? [0, 1, 3, 2].filter((seat) => allSeats.includes(seat))
      : allSeats;
    const count = visualOrder.length;
    if (count < 2) return;

    const startIndex = Math.floor(Math.random() * count);
    const targetIndex = Math.floor(Math.random() * count);
    const direction = Math.random() < 0.5 ? 1 : -1;
    const cycles = 3 + Math.floor(Math.random() * 2);
    const distance = (((targetIndex - startIndex) * direction) % count + count) % count;
    const totalSteps = cycles * count + distance;
    let step = 0;

    setFirstOrder([]);
    setFirstRolling(true);

    const tick = () => {
      if (run !== firstDecisionRunRef.current) return;
      const index = ((startIndex + direction * step) % count + count) % count;
      const seat = visualOrder[index];
      setFirstHighlight(seat);

      if (step >= totalSteps) {
        const ranking = Array.from({ length: count }, (_, rankIndex) => {
          const rankPosition = ((index + direction * rankIndex) % count + count) % count;
          return visualOrder[rankPosition];
        });
        setFirstOrder(ranking);
        setFirstRolling(false);
        firstDecisionTimerRef.current = null;
        // 名次徽标一直留着，但「先手」的高亮只再亮一小会儿，之后只剩数字。
        setFirstHighlight(ranking[0]);
        if (firstHighlightTimerRef.current !== null) clearTimeout(firstHighlightTimerRef.current);
        firstHighlightTimerRef.current = setTimeout(() => {
          firstHighlightTimerRef.current = null;
          setFirstHighlight(null);
        }, FIRST_HIGHLIGHT_MS);
        return;
      }

      const progress = step / Math.max(1, totalSteps);
      const delay = 42 + progress * progress * 300;
      step += 1;
      firstDecisionTimerRef.current = setTimeout(tick, delay);
    };

    tick();
  }, [game]);

  const changeCounter = useCallback((seat: number, key: CounterKey, delta: number) => {
    updatePlayers((players) => players.map((player) => (
      player.seat === seat ? { ...player, [key]: player[key] + delta } : player
    )));
  }, [updatePlayers]);

  const renamePlayer = useCallback((seat: number, name: string) => {
    updatePlayers((players) => players.map((player) => (player.seat === seat ? { ...player, name } : player)));
  }, [updatePlayers]);

  const changePlayerCount = useCallback((count: number) => {
    clearLifeDeltas();
    resetFirstDecision();
    setGame((current) => (current ? resizeGame(current, count) : current));
  }, [clearLifeDeltas, resetFirstDecision]);

  /* ── 任意数值弹窗（掉血 / 回血合并）── */
  const openAmountMenu = useCallback((seat: number) => {
    setGame((current) => {
      if (current) {
        const player = current.players.find((entry) => entry.seat === seat);
        if (player) {
          setAmountPad({
            title: `${player.name} · 调整生命`,
            mode: 'sub',
            currentLife: player.life,
            showCounters: true,
            seat,
            initialRotation: seatRotation(current.playerCount, seat),
            onConfirm: (mode, value) => changeLife(seat, mode === 'add' ? value : -value),
          });
        }
      }
      return current;
    });
  }, [changeLife]);

  const openCounterInput = useCallback((seat: number, key: CounterKey) => {
    setGame((current) => {
      if (current) {
        const player = current.players.find((entry) => entry.seat === seat);
        if (player) {
          const meta = COUNTER_BY_KEY[key];
          setAmountPad({
            title: `${player.name} · ${meta.label}`,
            mode: 'add',
            currentLife: player[key],
            showCounters: true,
            seat,
            initialRotation: seatRotation(current.playerCount, seat),
            layer: 'confirm',
            onConfirm: (mode, value) => {
              const next = mode === 'add' ? player[key] + value : Math.max(0, player[key] - value);
              updatePlayers((players) => players.map((entry) => (entry.seat === seat ? { ...entry, [key]: next } : entry)));
            },
          });
        }
      }
      return current;
    });
  }, [updatePlayers]);

  /* ── 骰子 ──
     两个引擎脾气要照顾：
     1) 引擎只认 NdS，不认识 kh/kl：带 kh/kl 的表达式先用 lib/diceExpression 解析成纯 NdS，
        摇完再用 evaluateRecipe 按取高取低重新分账。
     2) 引擎把裸常数当"施加次数"，且它自己的"修正值"实现是错的（2d6+3 会被当成掷 2 个 d3），
        所以常数由我们自己拼成末尾的带符号纯数字。 */
  const toSafeEngineNotation = useCallback((node: ExprNode): string => {
    const dice = flattenExpression(node).map((group) => `${group.count}d${group.sides}`).join('+');
    const constant = flattenToRecipe(node).modifierConstant;
    if (!dice) return '';
    return constant === 0 ? dice : `${dice}${constant > 0 ? '+' : '-'}${Math.abs(constant)}`;
  }, []);

  const rollExpression = useCallback((input: string, seat: number | null) => {
    const parsed = parseDiceExpression(input);
    if (!parsed.ok) {
      setDiceError(parsed.error || '骰式无法解析。');
      return;
    }
    const notation = toSafeEngineNotation(parsed.node);
    if (!notation) {
      setDiceError('骰式里没有可投的骰子。');
      return;
    }
    const custom = flattenToRecipe(parsed.node);
    const needsEvaluate = custom.recipes.some((recipe) => Boolean(recipe.keep));
    const request: DiceRollRequest = { id: newId('roll'), notation };
    const nextRoll: ActiveRoll = {
      kind: 'dice',
      notation: input,
      engineNotation: notation,
      seat,
      recipe: needsEvaluate ? custom : undefined,
      exprNode: needsEvaluate ? parsed.node : undefined,
    };
    setActiveRoll(nextRoll);
    setDiceRequest(request);
    setDiceError('');
    setShowDicePicker(false);
  }, [toSafeEngineNotation]);

  const rollCoin = useCallback((seat: number | null) => {
    const request: DiceRollRequest = {
      id: newId('roll'),
      notation: COIN_ROLL_NOTATION,
    };
    setActiveRoll({ kind: 'coin', notation: COIN_NOTATION, engineNotation: COIN_ROLL_NOTATION, seat });
    setDiceRequest(request);
  }, []);

  const onRollComplete = useCallback((result: unknown, rollInfo: ActiveRoll, record: RollRecord) => {
    void result;
    void rollInfo;
    // 掷骰历史属于当前状态：改完由 state 走 localStorage 立即保存 + 防抖同步，不再单独写一份记录。
    setGame((current) => (current ? { ...current, rolls: [...current.rolls, record].slice(-200) } : current));
  }, []);

  /* ── 计时与桌面控制 ──
     这套记血器没有存档、没有读档：状态随时跟着账户同步，按钮只负责计时和重置桌面。 */
  const toggleTimer = useCallback(() => {
    setGame((current) => {
      if (!current) return current;
      const now = Date.now();
      return {
        ...current,
        timer: current.timer.running
          ? { base: current.timer.base + Math.max(0, now - current.timer.startedAtMs), running: false, startedAtMs: now }
          : { base: current.timer.base, running: true, startedAtMs: now },
      };
    });
  }, []);

  const changeRound = useCallback((delta: number) => {
    setGame((current) => (current ? { ...current, round: Math.max(1, current.round + delta) } : current));
  }, []);

  const rerollColors = useCallback(() => {
    setGame((current) => {
      if (!current) return current;
      const colors = createGame(current.players.length, current.startingLife).players.map((player) => player.color);
      return { ...current, players: current.players.map((player, index) => ({ ...player, color: colors[index] })) };
    });
  }, []);

  /**
   * 重新开始对局：只把桌面放回开局状态。
   *   - 每位玩家的血量回到起始值、六个计数器清零、出局状态解除（名字与配色保留）；
   *   - 回合回到 1、掷骰历史清空；
   *   - **计时不动**：中间缝隙里的计时是一个独立的小秒表，要停要走在那边点。
   * 状态仍然写回同一条记录（id 不变），所以不会在数据库里多出任何"存档"。
   */
  const resetTable = useCallback(() => {
    setGame((current) => {
      if (!current) return current;
      const players = current.players.map((player) => ({
        ...createPlayer(player.seat, player.color, current.startingLife),
        name: player.name,
        color: player.color,
      }));
      return {
        ...current,
        round: 1,
        status: 'running',
        endedAt: null,
        winnerSeat: null,
        rolls: [],
        players,
      };
    });
    clearLifeDeltas();
    resetFirstDecision();
    setPendingReset(false);
    setResetNotice('已重新开始：血量、计数器与掷骰历史都归零，计时继续。');
  }, [clearLifeDeltas, resetFirstDecision]);

  /* ── 调试接口：无头浏览器验证用 ── */
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__edhLife = {
      getState: () => game,
      changeLife,
      changeCounter,
      rollExpression,
      rollCoin,
      openAmountMenu,
      decideFirst,
      resetTable,
      rerollColors,
      toggleTimer,
      changeRound,
      updateDiceScale,
      updateRotateScale,
      updatePresets,
      getDiceScale: () => diceScale,
      getRotateScale: () => rotateScale,
      getPresets: () => presets,
      elapsed: () => (game ? elapsedSeconds(game, Date.now()) : 0),
    };
  }, [changeCounter, changeLife, changeRound, decideFirst, diceScale, game, openAmountMenu, presets, resetTable, rerollColors, rotateScale, rollCoin, rollExpression, toggleTimer, updateDiceScale, updatePresets, updateRotateScale]);

  const elapsed = game ? elapsedSeconds(game, clock) : 0;
  const seats = useMemo(() => (game ? game.players : []), [game]);
  const nearRotation = game ? (seatRotation(game.playerCount, 0) as 0 | 180) : 0;
  const counterPanelPlayer = counterPanelSeat === null
    ? null
    : game?.players.find((player) => player.seat === counterPanelSeat) ?? null;
  const amountPadPlayer = amountPad?.seat === null || amountPad?.seat === undefined
    ? null
    : game?.players.find((player) => player.seat === amountPad.seat) ?? null;

  if (!game) {
    return (
      <div className="edh-root edh-loading">
        <DisableZoom />
        <span>正在准备记血器…</span>
      </div>
    );
  }

  return (
    <div className={`edh-root edh-players-${game.playerCount}`}>
      <DisableZoom />

      <div className="edh-grid">
        {seats.map((player) => (
          <SeatBlock
            key={player.seat}
            player={player}
            rotation={seatRotation(game.playerCount, player.seat) as 0 | 180}
            onLifeChange={changeLife}
            onOpenAmountMenu={openAmountMenu}
            onOpenCounters={setCounterPanelSeat}
            onRename={renamePlayer}
            lifeDelta={lifeDeltas[player.seat] ?? null}
            firstRank={firstOrder.indexOf(player.seat) >= 0 ? firstOrder.indexOf(player.seat) + 1 : null}
            rolling={firstHighlight === player.seat}
          />
        ))}

        {/* 中间缝隙：只有一排公共按钮。贴近自己这一排的方向为正。 */}
        <div className="edh-center" style={{ transform: nearRotation === 180 ? 'rotate(180deg)' : undefined }}>
          <CenterBar
            running={game.timer.running}
            syncStatus={syncStatus}
            firstRolling={firstRolling}
            onRollDice={() => { setDiceError(''); setShowDicePicker(true); }}
            onRollCoin={() => rollCoin(null)}
            onDecideFirst={decideFirst}
            onOpenHistory={() => { setHistorySeat(null); setShowHistory(true); }}
            onOpenSettings={() => {
              setResetNotice('');
              setPendingReset(false);
              setShowSettings(true);
            }}
            onToggleTimer={toggleTimer}
          />
        </div>
      </div>

      <DiceOverlay
        request={diceRequest}
        activeRoll={activeRoll}
        diceScale={diceScale}
        onComplete={onRollComplete}
        onDismiss={() => setActiveRoll(null)}
      />

      <AmountPad
        request={amountPad}
        player={amountPadPlayer}
        onCounterChange={amountPadPlayer
          ? (key, delta) => changeCounter(amountPadPlayer.seat, key, delta)
          : undefined}
        onClose={() => setAmountPad(null)}
      />

      {counterPanelPlayer && (
        <CounterPanel
          player={counterPanelPlayer}
          initialRotation={seatRotation(game.playerCount, counterPanelPlayer.seat)}
          onChange={(key, delta) => changeCounter(counterPanelPlayer.seat, key, delta)}
          onOpenInput={(key) => openCounterInput(counterPanelPlayer.seat, key)}
          onClose={() => setCounterPanelSeat(null)}
        />
      )}

      {showExpressionPad && (
        <ExpressionPad
          initialRotation={nearRotation}
          onClose={() => setShowExpressionPad(false)}
          onConfirm={(expression) => rollExpression(expression, null)}
        />
      )}

      {showHistory && (
        <HistoryPanel
          game={game}
          seat={historySeat}
          initialRotation={nearRotation}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showDicePicker && (
        <RotatableModal
          label="投骰子"
          panelClassName="edh-panel edh-dice-panel"
          width={440}
          initialRotation={nearRotation}
          persistKey="dice"
          onBackdrop={() => { setShowDicePicker(false); setDiceError(''); }}
        >
            <div className="edh-panel-head">
              <span>投骰子</span>
              <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); setShowDicePicker(false); setDiceError(''); }} aria-label="关闭">✕</button>
            </div>

            <div className="edh-picker-shortcuts">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="edh-picker-key"
                  data-preset={preset}
                  onPointerDown={(e) => { e.preventDefault(); rollExpression(preset, null); }}
                >{preset.toUpperCase()}</button>
              ))}
            </div>

            <button
              type="button"
              className="edh-ghost-btn"
              data-open-expression
              onPointerDown={(e) => { e.preventDefault(); setShowDicePicker(false); setShowExpressionPad(true); }}
            >⌨ 输入任意表达式</button>

            {diceError && <div className="edh-picker-error">{diceError}</div>}
        </RotatableModal>
      )}

      {showSettings && (
        <RotatableModal
          label="设置"
          panelClassName="edh-panel edh-settings-panel"
          width={780}
          initialRotation={nearRotation}
          persistKey="settings"
          scrollable
          onBackdrop={() => setShowSettings(false)}
        >
            <div className="edh-panel-head">
              <span>设置</span>
              <span className="edh-panel-sub">{game.timer.running ? '计时中' : '计时已暂停'}</span>
              <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); setShowSettings(false); }} aria-label="关闭">✕</button>
            </div>

            <div className="edh-settings-columns">
            <div className="edh-settings-column">
            <div className="edh-settings-section">
              <div className="edh-settings-label">人数</div>
              <div className="edh-settings-row">
                {[MIN_PLAYERS, 3, MAX_PLAYERS].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`edh-settings-chip${game.playerCount === count ? ' is-active' : ''}`}
                    onPointerDown={(e) => { e.preventDefault(); changePlayerCount(count); }}
                  >{count} 人</button>
                ))}
              </div>
            </div>

            <div className="edh-settings-section">
              <div className="edh-settings-label">配色</div>
              <div className="edh-settings-row">
                <button type="button" className="edh-settings-chip" onPointerDown={(e) => { e.preventDefault(); rerollColors(); }}>重新随机</button>
                <span className="edh-settings-swatches">
                  {game.players.map((player) => (
                    <i key={player.seat} className="edh-swatch" style={{ background: player.color }} title={player.color} />
                  ))}
                </span>
              </div>
            </div>

            <div className="edh-settings-section">
              <div className="edh-settings-label">计时</div>
              <div className="edh-settings-row">
                <button type="button" className="edh-settings-chip" onPointerDown={(e) => { e.preventDefault(); toggleTimer(); }}>
                  {game.timer.running ? '暂停计时' : '继续计时'}
                </button>
                <span className="edh-settings-hint">已计时 {formatDuration(elapsed)}</span>
              </div>
              <div className="edh-settings-row">
                <span className="edh-settings-hint">回合</span>
                <button type="button" className="edh-settings-chip" data-round-minus onPointerDown={(e) => { e.preventDefault(); changeRound(-1); }}>－</button>
                <span className="edh-slider-value" data-round-value>{game.round}</span>
                <button type="button" className="edh-settings-chip" data-round-plus onPointerDown={(e) => { e.preventDefault(); changeRound(1); }}>＋</button>
              </div>
            </div>

            <div className="edh-settings-section">
              <div className="edh-settings-label">界面</div>
              <div className="edh-slider-row">
                <span className="edh-settings-hint">字号</span>
                <input
                  className="edh-slider"
                  data-modal-font-scale
                  type="range"
                  min="0.8"
                  max="1.4"
                  step="0.05"
                  value={modalFontScale}
                  onChange={(e) => updateModalFontScale(Number(e.target.value))}
                />
                <span className="edh-slider-value" data-modal-font-scale-value>{Math.round(modalFontScale * 100)}%</span>
              </div>
              <div className="edh-slider-row">
                <span className="edh-settings-hint">面板</span>
                <input
                  className="edh-slider"
                  data-modal-panel-scale
                  type="range"
                  min="0.8"
                  max="1.2"
                  step="0.05"
                  value={modalPanelScale}
                  onChange={(e) => updateModalPanelScale(Number(e.target.value))}
                />
                <span className="edh-slider-value" data-modal-panel-scale-value>{Math.round(modalPanelScale * 100)}%</span>
              </div>
              <div className="edh-slider-row">
                <span className="edh-settings-hint">图标</span>
                <input
                  className="edh-slider"
                  data-rotate-scale
                  type="range"
                  min="0.5"
                  max="2"
                  step="0.05"
                  value={rotateScale}
                  onChange={(e) => updateRotateScale(Number(e.target.value))}
                />
                <span className="edh-slider-value" data-rotate-scale-value>{Math.round(rotateScale * 100)}%</span>
              </div>
              <div className="edh-settings-hint">
                「图标」调的是各弹窗右上角那个旋转按钮的大小，锚点固定在右上角（放大只往左下长）；字号影响弹窗文字，面板大小影响弹窗的横向排布。
              </div>
            </div>

            <div className="edh-settings-section">
              <div className="edh-settings-label">骰子</div>
              <div className="edh-slider-row">
                <span className="edh-settings-hint">大小</span>
                <input
                  className="edh-slider"
                  data-dice-scale
                  type="range"
                  min="0.4"
                  max="2"
                  step="0.05"
                  value={diceScale}
                  onChange={(e) => updateDiceScale(Number(e.target.value))}
                />
                <span className="edh-slider-value" data-dice-scale-value>{diceScale.toFixed(2)}×</span>
              </div>
              <div className="edh-settings-hint">骰子弹窗里的快捷骰式（最多 {MAX_DICE_PRESETS} 个）</div>
              <div className="edh-preset-list">
              {presets.map((preset, index) => (
                <div className="edh-preset-row" key={`preset-${index}`}>
                  <input
                    className="edh-preset-input"
                    data-preset-input={index}
                    value={preset}
                    onChange={(e) => {
                      const next = [...presets];
                      next[index] = e.target.value;
                      setPresets(next);
                    }}
                    onBlur={() => updatePresets(presets)}
                  />
                  <button
                    type="button"
                    className="edh-preset-remove"
                    data-preset-remove={index}
                    onPointerDown={(e) => { e.preventDefault(); updatePresets(presets.filter((_, i) => i !== index)); }}
                    aria-label="删除这个预设"
                  >✕</button>
                </div>
              ))}
              </div>
              <button
                type="button"
                className="edh-ghost-btn"
                data-preset-add
                disabled={presets.length >= MAX_DICE_PRESETS}
                onPointerDown={(e) => { e.preventDefault(); updatePresets([...presets, '2d6']); }}
              >＋ 添加一个预设</button>
            </div>

            </div>
            <div className="edh-settings-column">
            <div className="edh-settings-section">
              <div className="edh-settings-label">对局</div>
              <div className="edh-settings-row">
                <button
                  type="button"
                  className="edh-settings-chip is-wide"
                  data-reset-table
                  disabled={pendingReset}
                  onPointerDown={(e) => { e.preventDefault(); setResetNotice(''); setPendingReset(true); }}
                >重新开始对局</button>
              </div>

              {pendingReset && (
                <div className="edh-match-confirm" role="group" aria-label="确认重新开始">
                  <div className="edh-match-confirm-text">
                    确定重新开始？所有玩家的血量与状态回到开局、掷骰历史清空；计时照常走，也不会产生任何存档。
                  </div>
                  <div className="edh-match-confirm-actions">
                    <button
                      type="button"
                      className="edh-settings-chip"
                      data-reset-cancel
                      onPointerDown={(e) => { e.preventDefault(); setPendingReset(false); }}
                    >取消</button>
                    <button
                      type="button"
                      className="edh-settings-chip is-warning"
                      data-reset-confirm
                      onPointerDown={(e) => { e.preventDefault(); resetTable(); }}
                    >确认重新开始</button>
                  </div>
                </div>
              )}

              {resetNotice && <div className="edh-panel-note">{resetNotice}</div>}

              <div className="edh-settings-hint">
                血量、状态、计时与掷骰历史随账户实时同步；一个账户只有这一份当前状态，没有存档列表。
              </div>
            </div>
            </div>
            </div>

            <div className="edh-settings-footer">
              <span className={`edh-sync edh-sync-${syncStatus}`}>
                {syncStatus === 'saved' ? '✓ 已同步到数据库'
                  : syncStatus === 'saving' ? '同步中…'
                    : syncStatus === 'offline' ? '仅本机保存（服务器不可用）'
                      : syncStatus === 'error' ? '同步出错' : '待同步'}
              </span>
            </div>
        </RotatableModal>
      )}
    </div>
  );
}

/* ── 中间缝隙里那一排公共按钮 ── */

interface CenterBarProps {
  running: boolean;
  syncStatus: SyncStatus;
  firstRolling: boolean;
  onRollDice: () => void;
  onRollCoin: () => void;
  onDecideFirst: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onToggleTimer: () => void;
}

function CenterBar({
  running, syncStatus, firstRolling,
  onRollDice, onRollCoin, onDecideFirst, onOpenHistory, onOpenSettings, onToggleTimer,
}: CenterBarProps) {
  return (
    <div className="edh-center-half">
      <button type="button" className="edh-center-btn" title="设置" onPointerDown={(e) => { e.preventDefault(); onOpenSettings(); }}>⚙ 设置</button>
      <button
        type="button"
        className={`edh-center-btn edh-first-btn${firstRolling ? ' is-rolling' : ''}`}
        title="随机决定先手和行动顺序"
        disabled={firstRolling}
        onPointerDown={(e) => { e.preventDefault(); onDecideFirst(); }}
      >{firstRolling ? '决定中…' : '先攻决定'}</button>
      <button type="button" className="edh-center-btn" title="投骰子" onPointerDown={(e) => { e.preventDefault(); onRollDice(); }}>🎲 骰子</button>
      <button type="button" className="edh-center-btn" title="投硬币" onPointerDown={(e) => { e.preventDefault(); onRollCoin(); }}>🪙 硬币</button>
      <button type="button" className="edh-center-btn" title="掷骰历史" onPointerDown={(e) => { e.preventDefault(); onOpenHistory(); }}>🕘 历史</button>
      <button
        type="button"
        className={`edh-center-btn${running ? '' : ' is-paused'}`}
        title={running ? '点击暂停计时' : '点击继续计时'}
        onPointerDown={(e) => { e.preventDefault(); onToggleTimer(); }}
      >
        <i className="edh-center-timer-dot" />
        {running ? '计时中' : '已暂停'}
      </button>
      <span className={`edh-center-sync edh-sync-${syncStatus}`} title="数据同步状态">
        {syncStatus === 'saved' ? '✓' : syncStatus === 'saving' ? '…' : syncStatus === 'offline' ? '⚠' : '·'}
      </span>
    </div>
  );
}
