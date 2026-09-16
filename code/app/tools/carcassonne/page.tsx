'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import Link from 'next/link';
import DiceRoller, { type DiceRollRequest, type DiceRollResult } from '@/components/dnd/DiceRoller';
import {
  createCarcassonneSave,
  createDefaultState,
  deleteCarcassonneSave,
  fetchCarcassonneSaves,
  ITEM_LABELS,
  type CarcassonneSave,
  type CarcassonneState,
  type Side,
} from '@/lib/carcassonne';

const STORAGE_KEY = 'box-carcassonne-current-v1';
const SETTINGS_KEY = 'box-carcassonne-settings-v1';
const ITEM_SRC = ['/carcassonne-assets/item1.webp', '/carcassonne-assets/item2.webp', '/carcassonne-assets/item3.webp'];
const TOKEN_SRC = { king: '/carcassonne-assets/king.webp', thief: '/carcassonne-assets/thief.webp' } as const;

type ScoreSize = 's' | 'm' | 'l';
type ArtSize = 's' | 'm' | 'l';
type FontStyle = 'default' | 'serif' | 'mono';

interface CarcassonneSettings {
  scoreSize: ScoreSize;
  fontStyle: FontStyle;
  artSize: ArtSize;
  clickStep: number;
  holdStep: number;
  d6Texture: string;
}

const DEFAULT_SETTINGS: CarcassonneSettings = {
  scoreSize: 'm',
  fontStyle: 'default',
  artSize: 'm',
  clickStep: 1,
  holdStep: 10,
  d6Texture: '',
};

const SCORE_SIZE_CLASS: Record<ScoreSize, string> = {
  s: 'clamp(3rem, 11vmin, 8.5rem)',
  m: 'clamp(4.5rem, 17vmin, 13rem)',
  l: 'clamp(6rem, 22vmin, 17rem)',
};

const ART_SIZE_CLASS: Record<ArtSize, string> = {
  s: 'h-9 w-9 sm:h-12 sm:w-12',
  m: 'h-12 w-12 sm:h-16 sm:w-16',
  l: 'h-14 w-14 sm:h-20 sm:w-20',
};

const FONT_CLASS: Record<FontStyle, string> = {
  default: '',
  serif: 'font-serif',
  mono: 'font-mono',
};

const DICE_TEXTURES: { key: string; label: string; swatch: string }[] = [
  { key: '', label: '经典白', swatch: 'bg-slate-100 text-slate-900' },
  { key: 'fire', label: '烈焰红', swatch: 'bg-gradient-to-br from-orange-400 to-red-600 text-white' },
  { key: 'ice', label: '冰霜蓝', swatch: 'bg-gradient-to-br from-sky-300 to-blue-600 text-white' },
  { key: 'astral', label: '星辰紫', swatch: 'bg-gradient-to-br from-violet-400 to-purple-800 text-white' },
  { key: 'stainedglass', label: '彩窗', swatch: 'bg-gradient-to-br from-yellow-300 via-rose-400 to-violet-600 text-white' },
  { key: 'dragon', label: '龙鳞', swatch: 'bg-gradient-to-br from-emerald-400 to-teal-700 text-white' },
];

function loadSettings(): CarcassonneSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<CarcassonneSettings>;
    return {
      scoreSize: saved.scoreSize === 's' || saved.scoreSize === 'l' ? saved.scoreSize : saved.scoreSize === 'm' ? 'm' : DEFAULT_SETTINGS.scoreSize,
      fontStyle: saved.fontStyle === 'serif' || saved.fontStyle === 'mono' ? saved.fontStyle : 'default',
      artSize: saved.artSize === 's' || saved.artSize === 'm' || saved.artSize === 'l' ? saved.artSize : 'm',
      clickStep: Number.isFinite(Number(saved.clickStep)) && Number(saved.clickStep) > 0 ? Number(saved.clickStep) : 1,
      holdStep: Number.isFinite(Number(saved.holdStep)) && Number(saved.holdStep) > 0 ? Number(saved.holdStep) : 10,
      d6Texture: typeof saved.d6Texture === 'string' ? saved.d6Texture : '',
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function cleanTimers(timerRef: MutableRefObject<number | null>, intervalRef: MutableRefObject<number | null>) {
  if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
  timerRef.current = null;
  intervalRef.current = null;
}

// 单击 tap；长按 hold 触发一次后按 interval 持续重复。
function useTapHold(tap: () => void, hold: () => void, interval = 250) {
  const tapRef = useRef(tap);
  const holdRef = useRef(hold);
  tapRef.current = tap;
  holdRef.current = hold;
  const longFiredRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const clear = useCallback(() => cleanTimers(timerRef, intervalRef), []);

  useEffect(() => () => cleanTimers(timerRef, intervalRef), []);

  return useMemo(() => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      longFiredRef.current = false;
      clear();
      timerRef.current = window.setTimeout(() => {
        longFiredRef.current = true;
        holdRef.current();
        intervalRef.current = window.setInterval(() => holdRef.current(), interval);
      }, 500);
    },
    onPointerUp: () => {
      const wasLong = longFiredRef.current;
      clear();
      if (!wasLong) tapRef.current();
    },
    onPointerLeave: () => {
      longFiredRef.current = false;
      clear();
    },
    onPointerCancel: () => {
      longFiredRef.current = false;
      clear();
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  }), [clear, interval]);
}

// 争夺物品手势：单击 +1、长按 -1、300ms 内第二次点击 = 移给对方。
function useTokenGesture(
  increment: () => void,
  decrement: () => void,
  move: () => void,
) {
  const incrementRef = useRef(increment);
  const decrementRef = useRef(decrement);
  const moveRef = useRef(move);
  incrementRef.current = increment;
  decrementRef.current = decrement;
  moveRef.current = move;
  const longFiredRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);

  const clear = useCallback(() => cleanTimers(timerRef, intervalRef), []);

  useEffect(() => () => {
    cleanTimers(timerRef, intervalRef);
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  return useMemo(() => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      longFiredRef.current = false;
      clear();
      timerRef.current = window.setTimeout(() => {
        longFiredRef.current = true;
        decrementRef.current();
        intervalRef.current = window.setInterval(() => decrementRef.current(), 250);
      }, 500);
    },
    onPointerUp: () => {
      if (longFiredRef.current) {
        clear();
        return;
      }
      clear();
      const now = Date.now();
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        moveRef.current();
        return;
      }
      clickTimerRef.current = window.setTimeout(() => {
        clickTimerRef.current = null;
        incrementRef.current();
      }, 300);
    },
    onPointerLeave: () => {
      longFiredRef.current = false;
      clear();
    },
    onPointerCancel: () => {
      longFiredRef.current = false;
      clear();
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  }), [clear]);
}

function formatSaveTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function defaultSaveTitle(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function parseLocalState(raw: string | null): CarcassonneState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CarcassonneState;
    if (!parsed?.player1 || !parsed?.player2 || !parsed?.king || !parsed?.thief) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function CarcassonneScorePage() {
  const [state, setState] = useState<CarcassonneState>(createDefaultState);
  const [settings, setSettings] = useState<CarcassonneSettings>(DEFAULT_SETTINGS);
  const [changeTexts, setChangeTexts] = useState<[string, string]>(['', '']);
  const [bonusTexts, setBonusTexts] = useState<[string, string]>(['', '']);
  const [diceRollRequest, setDiceRollRequest] = useState<DiceRollRequest | null>(null);
  const [diceRollResult, setDiceRollResult] = useState<DiceRollResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 存档面板
  const [panelOpen, setPanelOpen] = useState(false);
  const [saves, setSaves] = useState<CarcassonneSave[]>([]);
  const [savesLoading, setSavesLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState(defaultSaveTitle);

  const changeTimerRef = useRef<[number | null, number | null]>([null, null]);
  const bonusTimerRef = useRef<[number | null, number | null]>([null, null]);
  const settingsLoadedRef = useRef(false);

  // 设置从浏览器恢复一次（不能在 useState 初始化时读 window，避免静态导出阶段报错）。
  useEffect(() => {
    if (settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    setSettings(loadSettings());
  }, []);

  useEffect(() => {
    if (!settingsLoadedRef.current) return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  // 浏览器内自动恢复当前这局（原项目行为），不依赖网络。
  useEffect(() => {
    const restored = parseLocalState(window.localStorage.getItem(STORAGE_KEY));
    if (restored) setState(restored);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => () => {
    changeTimerRef.current.forEach((timer) => timer && window.clearTimeout(timer));
    bonusTimerRef.current.forEach((timer) => timer && window.clearTimeout(timer));
  }, []);

  const flashScore = useCallback((side: Side, points: number) => {
    const index = side === 0 ? 0 : 1;
    setChangeTexts((previous) => {
      const next: [string, string] = [...previous];
      const delta = points > 0 ? `+${points}` : String(points);
      next[index] = delta;
      return next;
    });
    if (changeTimerRef.current[index]) window.clearTimeout(changeTimerRef.current[index]!);
    changeTimerRef.current[index] = window.setTimeout(() => {
      setChangeTexts((previous) => {
        const next: [string, string] = [...previous];
        next[index] = '';
        return next;
      });
      changeTimerRef.current[index] = null;
    }, 20000);
  }, []);

  const showBonus = useCallback((side: Side, text: string) => {
    const index = side === 0 ? 0 : 1;
    setBonusTexts((previous) => {
      const next: [string, string] = [...previous];
      next[index] = text;
      return next;
    });
    if (bonusTimerRef.current[index]) window.clearTimeout(bonusTimerRef.current[index]!);
    bonusTimerRef.current[index] = window.setTimeout(() => {
      setBonusTexts((previous) => {
        const next: [string, string] = [...previous];
        next[index] = '';
        return next;
      });
      bonusTimerRef.current[index] = null;
    }, 20000);
  }, []);

  const adjustScore = useCallback((side: Side, delta: number) => {
    setState((previous) => {
      const next = structuredClone(previous);
      const player = side === 0 ? next.player1 : next.player2;
      player.score = Math.max(0, player.score + delta);
      return next;
    });
    flashScore(side, delta);
  }, [flashScore]);

  const adjustItem = useCallback((side: Side, index: number, delta: number) => {
    setState((previous) => {
      const next = structuredClone(previous);
      const player = side === 0 ? next.player1 : next.player2;
      player.items[index] = Math.max(0, player.items[index] + delta);
      return next;
    });
  }, []);

  const adjustToken = useCallback((token: 'king' | 'thief', delta: number) => {
    setState((previous) => {
      const next = structuredClone(previous);
      next[token].count = Math.max(0, next[token].count + delta);
      return next;
    });
  }, []);

  const moveToken = useCallback((token: 'king' | 'thief') => {
    setState((previous) => {
      const next = structuredClone(previous);
      next[token].holder = next[token].holder === 0 ? 1 : 0;
      return next;
    });
  }, []);

  const rename = useCallback((side: Side, name: string) => {
    setState((previous) => {
      const next = structuredClone(previous);
      const player = side === 0 ? next.player1 : next.player2;
      player.name = name.slice(0, 12) || (side === 0 ? '秦' : '马');
      return next;
    });
  }, []);

  const calculateBonus = useCallback(() => {
    if (!window.confirm('确定要计算物品加分吗？\n计算完成后将清空所有物品计数！')) return;
    const details: [string[], string[]] = [[], []];
    for (let index = 0; index < 3; index += 1) {
      const left = state.player1.items[index];
      const right = state.player2.items[index];
      const label = ITEM_LABELS[index];
      if (left > right) details[0].push(`${label} +10`);
      else if (right > left) details[1].push(`${label} +10`);
      else if (left > 0) {
        details[0].push(`${label} +10`);
        details[1].push(`${label} +10`);
      }
    }
    for (const token of ['king', 'thief'] as const) {
      if (state[token].count > 0) {
        const side = state[token].holder;
        details[side].push(`${token === 'king' ? '国王' : '盗贼'} +10`);
      }
    }

    setState((previous) => {
      const next = structuredClone(previous);
      if (details[0].length) next.player1.score += details[0].length * 10;
      if (details[1].length) next.player2.score += details[1].length * 10;
      next.player1.items = [0, 0, 0];
      next.player2.items = [0, 0, 0];
      next.king = { count: 0, holder: 0 };
      next.thief = { count: 0, holder: 1 };
      return next;
    });
    if (details[0].length) {
      flashScore(0, details[0].length * 10);
      showBonus(0, details[0].join('，'));
    } else {
      showBonus(0, '');
    }
    if (details[1].length) {
      flashScore(1, details[1].length * 10);
      showBonus(1, details[1].join('，'));
    } else {
      showBonus(1, '');
    }
  }, [flashScore, showBonus, state]);

  const resetAll = useCallback(() => {
    if (!window.confirm('确定要清空两名玩家的分数、物品和争夺物品吗？')) return;
    setState(createDefaultState());
    setChangeTexts(['', '']);
    setBonusTexts(['', '']);
  }, []);

  const startDiceRoll = useCallback(() => {
    setDiceRollResult(null);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setDiceRollRequest({
      id,
      notation: '1d6',
      shapeTextures: settings.d6Texture ? { d6: settings.d6Texture } : {},
    });
  }, [settings.d6Texture]);

  const handleDiceRollComplete = useCallback((result: DiceRollResult) => {
    setDiceRollResult(result);
  }, []);

  const loadSaves = useCallback(async () => {
    setSavesLoading(true);
    try {
      setSaves(await fetchCarcassonneSaves());
    } catch {
      setSaves([]);
    } finally {
      setSavesLoading(false);
    }
  }, []);

  const saveCurrent = useCallback(async () => {
    try {
      await createCarcassonneSave(state, saveTitle.trim() || '未命名存档');
      await loadSaves();
      setSaveTitle(defaultSaveTitle());
    } catch {
      window.alert('保存失败：请确认服务器已启动且账户拥有卡卡颂工具权限。');
    }
  }, [loadSaves, saveTitle, state]);

  const removeSave = useCallback(async (save: CarcassonneSave) => {
    if (!window.confirm(`确定删除存档「${save.title}」吗？`)) return;
    try {
      await deleteCarcassonneSave(save.id);
      await loadSaves();
    } catch {
      window.alert('删除失败。');
    }
  }, [loadSaves]);

  const loadSave = useCallback((save: CarcassonneSave) => {
    if (!window.confirm(`加载存档「${save.title}」？\n当前状态将被覆盖。`)) return;
    setState(structuredClone(save.state));
    setChangeTexts(['', '']);
    setBonusTexts(['', '']);
    setPanelOpen(false);
  }, []);

  return (
    <main className="relative h-dvh w-full touch-none overflow-hidden bg-slate-950 text-white select-none">
      {/* 左上角回首页（避免盖住比分，做得非常小） */}
      <div className="absolute left-1 top-1 z-40 flex items-center gap-1">
        <Link href="/" className="inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-1 text-[11px] text-white/70 backdrop-blur hover:bg-black/50 hover:text-white" aria-label="返回首页">
          ←
        </Link>
      </div>

      <div className="absolute inset-0 flex">
        {/* 左玩家：秦 */}
        <PlayerPane
          side={0}
          state={state}
          changeText={changeTexts[0]}
          bonusText={bonusTexts[0]}
          gradient="from-sky-500 via-blue-600 to-blue-800"
          accent="text-sky-100"
          onScore={(delta) => adjustScore(0, delta)}
          onRename={(name) => rename(0, name)}
          onItem={(index, delta) => adjustItem(0, index, delta)}
          clickStep={settings.clickStep}
          holdStep={settings.holdStep}
          scoreSizeClass={SCORE_SIZE_CLASS[settings.scoreSize]}
          fontClass={FONT_CLASS[settings.fontStyle]}
          artSizeClass={ART_SIZE_CLASS[settings.artSize]}
          onToken={(token, action) => {
            if (action === 'adjust') adjustToken(token, -1);
            else moveToken(token);
          }}
        />

        {/* 中间操作列 */}
        <div className="relative z-20 flex w-[76px] flex-shrink-0 flex-col items-center justify-center gap-1.5 overflow-y-auto bg-black py-1 sm:w-[104px] sm:gap-2">
          <CenterButton label="重置" className="from-rose-600 to-red-700" onClick={resetAll} />
          <CenterButton label="1D6" className="from-amber-500 to-orange-600 text-lg" onClick={startDiceRoll} />
          <CenterButton label="结算" className="from-emerald-500 to-green-700" onClick={calculateBonus} />
          <CenterButton label="存档" className="from-sky-500 to-indigo-700" onClick={() => {
            setSaveTitle(defaultSaveTitle());
            setPanelOpen(true);
            loadSaves();
          }} />
          <CenterButton label="设置" className="from-slate-500 to-slate-700" onClick={() => setSettingsOpen(true)} />
          <p className="mt-1 max-w-[7rem] text-center text-[9px] leading-relaxed text-white/35">
            长按物品减数，双击国王/盗贼换边
          </p>
        </div>

        {/* 右玩家：马 */}
        <PlayerPane
          side={1}
          state={state}
          changeText={changeTexts[1]}
          bonusText={bonusTexts[1]}
          gradient="from-rose-500 via-pink-600 to-rose-800"
          accent="text-rose-100"
          onScore={(delta) => adjustScore(1, delta)}
          onRename={(name) => rename(1, name)}
          onItem={(index, delta) => adjustItem(1, index, delta)}
          clickStep={settings.clickStep}
          holdStep={settings.holdStep}
          scoreSizeClass={SCORE_SIZE_CLASS[settings.scoreSize]}
          fontClass={FONT_CLASS[settings.fontStyle]}
          artSizeClass={ART_SIZE_CLASS[settings.artSize]}
          onToken={(token, action) => {
            if (action === 'adjust') adjustToken(token, -1);
            else moveToken(token);
          }}
        />
      </div>

      {/* 3D D6 骰盘（沿用 DND 先攻轮盘的 dice-box 引擎） */}
      {diceRollRequest && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/85"
          onClick={() => {
            if (diceRollResult) {
              setDiceRollRequest(null);
              setDiceRollResult(null);
            }
          }}
        >
          <DiceRoller rollRequest={diceRollRequest} onRollComplete={handleDiceRollComplete} />
          {diceRollResult && (
            <div className="pointer-events-none fixed left-1/2 top-14 z-[80] -translate-x-1/2 text-center">
              <div className="rounded-2xl border-2 border-amber-400/70 bg-slate-950/90 px-8 py-4 shadow-2xl backdrop-blur">
                <div className="text-xs font-bold tracking-[0.3em] text-amber-200">D6 RESULT</div>
                <div className="mt-1 text-6xl font-black text-white sm:text-7xl">{diceRollResult.total}</div>
              </div>
            </div>
          )}
          <div className="pointer-events-none fixed inset-x-0 bottom-8 z-[80] text-center text-sm font-bold text-white/80">
            {diceRollResult ? '👆 点一下屏幕关闭骰盘' : '骰子滚动中…'}
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
          onReset={() => setSettings(DEFAULT_SETTINGS)}
        />
      )}

      {/* 存档面板 */}
      {panelOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setPanelOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl animate-pop-in" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-black text-white">💾 存档管理</h2>
              <button onClick={() => setPanelOpen(false)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
            </div>

            <div className="mb-5 flex gap-2">
              <input
                value={saveTitle}
                onChange={(event) => setSaveTitle(event.target.value)}
                placeholder="存档名称"
                maxLength={80}
                className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-sky-400"
              />
              <button onClick={saveCurrent} className="shrink-0 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:opacity-90">
                保存当前
              </button>
            </div>

            <div className="text-xs font-semibold tracking-wider text-slate-400">SQLite 云端存档（按当前账户隔离）</div>
            <div className="mt-2 space-y-2">
              {savesLoading && <p className="py-6 text-center text-sm text-slate-500">读取存档中…</p>}
              {!savesLoading && saves.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-500">还没有存档。点击“保存当前”写入第一条。</p>
              )}
              {saves.map((save) => (
                <div key={save.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5">
                  <button onClick={() => loadSave(save)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-bold text-white">{save.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-400">
                      {formatSaveTime(save.createdAt)} · {save.state.player1.name} {save.state.player1.score} : {save.state.player2.score} {save.state.player2.name}
                    </div>
                  </button>
                  <button onClick={() => loadSave(save)} className="shrink-0 rounded-lg bg-emerald-600/20 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-600/40">
                    加载
                  </button>
                  <button onClick={() => removeSave(save)} className="shrink-0 rounded-lg bg-rose-600/20 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-600/40">
                    删除
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-1 left-1/2 z-30 -translate-x-1/2 text-center text-[9px] text-white/30">
        每名玩家：右侧 +{settings.clickStep}、长按 +{settings.holdStep}；左侧 -{settings.clickStep}、长按 -{settings.holdStep} · 自动保存在此浏览器
      </div>
    </main>
  );
}

function SettingsPanel({
  settings,
  onChange,
  onClose,
  onReset,
}: {
  settings: CarcassonneSettings;
  onChange: (settings: CarcassonneSettings) => void;
  onClose: () => void;
  onReset: () => void;
}) {
  const patch = (part: Partial<CarcassonneSettings>) => onChange({ ...settings, ...part });

  const groupTitle = 'text-[11px] font-semibold tracking-wider text-slate-400';
  const chip = (active: boolean) => `rounded-lg px-3 py-1.5 text-xs font-bold transition ${active ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl animate-pop-in" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black text-white">⚙️ 显示与步长设置</h2>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-white">✕</button>
        </div>

        <div className="space-y-5">
          <div>
            <p className={groupTitle}>数字大小</p>
            <div className="mt-2 flex gap-2">
              {(['s', 'm', 'l'] as ScoreSize[]).map((size) => (
                <button key={size} onClick={() => patch({ scoreSize: size })} className={chip(settings.scoreSize === size)}>
                  {size === 's' ? '小' : size === 'm' ? '中' : '大'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={groupTitle}>数字字体</p>
            <div className="mt-2 flex gap-2">
              {(['default', 'serif', 'mono'] as FontStyle[]).map((font) => (
                <button key={font} onClick={() => patch({ fontStyle: font })} className={chip(settings.fontStyle === font)}>
                  {font === 'default' ? '默认' : font === 'serif' ? '衬线' : '等宽'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={groupTitle}>物品与争夺图案大小</p>
            <div className="mt-2 flex gap-2">
              {(['s', 'm', 'l'] as ArtSize[]).map((size) => (
                <button key={size} onClick={() => patch({ artSize: size })} className={chip(settings.artSize === size)}>
                  {size === 's' ? '小' : size === 'm' ? '中' : '大'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={groupTitle}>单击分数步长</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 5, 10].map((step) => (
                <button key={step} onClick={() => patch({ clickStep: step })} className={chip(settings.clickStep === step)}>
                  ±{step}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={groupTitle}>长按分数步长</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[5, 10, 20, 50].map((step) => (
                <button key={step} onClick={() => patch({ holdStep: step })} className={chip(settings.holdStep === step)}>
                  ±{step}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className={groupTitle}>1D6 骰子外观</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DICE_TEXTURES.map((texture) => (
                <button
                  key={texture.key || 'classic'}
                  onClick={() => patch({ d6Texture: texture.key })}
                  className={`rounded-xl border px-3 py-2 text-left text-xs font-bold transition ${
                    settings.d6Texture === texture.key
                      ? 'border-sky-400 bg-sky-500/20 text-white'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  <span className={`mb-1 flex h-8 w-8 items-center justify-center rounded-lg text-[10px] ${texture.swatch}`}>D6</span>
                  {texture.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <button onClick={onReset} className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-bold text-slate-300 hover:bg-white/10">
            恢复默认
          </button>
          <button onClick={onClose} className="flex-1 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-400">
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function CenterButton({ label, onClick, className }: { label: string; onClick: () => void; className: string }) {
  return (
    <button
      onClick={onClick}
      className={`h-11 w-11 rounded-2xl bg-gradient-to-br text-sm font-black text-white shadow-lg transition active:scale-95 sm:h-14 sm:w-14 ${className}`}
    >
      {label}
    </button>
  );
}

function PlayerPane({
  side,
  state,
  changeText,
  bonusText,
  gradient,
  accent,
  onScore,
  onRename,
  onItem,
  onToken,
  clickStep,
  holdStep,
  scoreSizeClass,
  fontClass,
  artSizeClass,
}: {
  side: Side;
  state: CarcassonneState;
  changeText: string;
  bonusText: string;
  gradient: string;
  accent: string;
  onScore: (delta: number) => void;
  onRename: (name: string) => void;
  onItem: (index: number, delta: number) => void;
  onToken: (token: 'king' | 'thief', action: 'adjust' | 'move') => void;
  clickStep: number;
  holdStep: number;
  scoreSizeClass: string;
  fontClass: string;
  artSizeClass: string;
}) {
  const player = side === 0 ? state.player1 : state.player2;
  const minusHold = useTapHold(() => onScore(-clickStep), () => onScore(-holdStep));
  const plusHold = useTapHold(() => onScore(clickStep), () => onScore(holdStep));

  return (
    <section className={`relative flex-1 overflow-hidden bg-gradient-to-br ${gradient}`}>
      {/* 点击区：左半屏减分、右半屏加分（叠加在分数下方，不影响文字展示） */}
      <div className="absolute inset-y-0 left-0 w-1/2 cursor-pointer" {...minusHold} aria-label={`${player.name} 减分`} />
      <div className="absolute inset-y-0 right-0 w-1/2 cursor-pointer" {...plusHold} aria-label={`${player.name} 加分`} />

      {/* 顶部物品 */}
      <div className={`absolute top-2 z-30 flex gap-1.5 sm:gap-2 ${side === 0 ? 'left-2' : 'right-2'}`}>
        {[0, 1, 2].map((index) => (
          <ItemButton key={index} index={index} count={player.items[index]} onItem={onItem} artClass={artSizeClass} />
        ))}
      </div>

      {/* 名字与分数 */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <input
          value={player.name}
          onChange={(event) => onRename(event.target.value)}
          aria-label={`${side === 0 ? '左' : '右'}方玩家名字`}
          className={`pointer-events-auto mt-20 w-32 rounded-xl bg-black/15 text-center text-2xl font-black text-white outline-none backdrop-blur-sm sm:mt-14 sm:w-44 sm:text-3xl ${accent} ${fontClass}`}
        />
        <div
          className={`mt-2 font-black leading-none tracking-tight text-white drop-shadow-[0_6px_18px_rgba(0,0,0,.35)] ${fontClass}`}
          style={{ fontSize: scoreSizeClass }}
        >
          {player.score}
        </div>

        <div className={`pointer-events-none mt-3 text-lg font-black sm:text-3xl ${changeText.startsWith('-') ? 'text-red-200' : 'text-emerald-300'}`}>
          {changeText}
        </div>
        {bonusText && <div className="mt-2 max-w-[85%] text-sm font-bold text-yellow-200 drop-shadow">{bonusText}</div>}

        <div className="mt-2 text-[9px] font-medium tracking-wider text-white/50 sm:text-[10px]">
          右侧长按 +10 · 左侧长按 -10
        </div>
      </div>

      {/* 争夺物品：同一侧持有多个时放在同一个容器里横排，避免互相重叠 */}
      <div className={`absolute bottom-2 z-30 flex max-w-[calc(100%-0.5rem)] flex-wrap items-center gap-1.5 ${side === 0 ? 'left-2' : 'right-2'}`}>
        {(['king', 'thief'] as const)
          .filter((token) => state[token].holder === side)
          .map((token) => (
            <TokenSlot
              key={token}
              token={token}
              count={state[token].count}
              onAdjust={() => onToken(token, 'adjust')}
              onMove={() => onToken(token, 'move')}
              artClass={artSizeClass}
            />
          ))}
      </div>
    </section>
  );
}

function ItemButton({
  index,
  count,
  onItem,
  artClass,
}: {
  index: number;
  count: number;
  onItem: (index: number, delta: number) => void;
  artClass: string;
}) {
  const adjust = useTapHold(() => onItem(index, 1), () => onItem(index, -1));
  return (
    <button
      type="button"
      {...adjust}
      className="relative cursor-pointer rounded-xl outline-none touch-none"
      aria-label={`${ITEM_LABELS[index]} 数量 ${count}`}
      title={`${ITEM_LABELS[index]}：点按 +1，长按 -1`}
    >
      <img
        src={ITEM_SRC[index]}
        alt={ITEM_LABELS[index]}
        draggable={false}
        className={`${artClass} rounded-lg bg-white/10 object-contain transition ${count > 0 ? '' : 'opacity-40 grayscale'}`}
      />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white/60 bg-amber-400 px-1 text-xs font-black text-slate-900 sm:h-7 sm:min-w-7">
          {count}
        </span>
      )}
    </button>
  );
}

function TokenSlot({
  token,
  count,
  onAdjust,
  onMove,
  artClass,
}: {
  token: 'king' | 'thief';
  count: number;
  onAdjust: () => void;
  onMove: () => void;
  artClass: string;
}) {
  const gesture = useTokenGesture(() => onAdjust(), () => onAdjust(), onMove);
  const label = token === 'king' ? '国王' : '盗贼';

  return (
    <div className="flex items-center gap-1 rounded-xl bg-black/20 p-1">
      <div className="flex flex-col items-center gap-0.5">
        <button
          type="button"
          {...gesture}
          className="relative block cursor-pointer rounded-lg outline-none touch-none"
          title={`${label}：单击数量 +1 · 长按 -1 · 双击换到对方`}
          aria-label={`${label} 单击加一、长按减一、双击换边`}
        >
          <img
            src={TOKEN_SRC[token]}
            alt={label}
            draggable={false}
            className={`${artClass} rounded-lg bg-white/10 object-contain`}
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-lg bg-black/55 text-center text-[9px] font-bold leading-4 text-white sm:text-[10px]">
            {label}
          </span>
          {count > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-white/60 bg-yellow-300 px-1 text-xs font-black text-slate-900 sm:h-7 sm:min-w-7">
              {count}
            </span>
          )}
        </button>
        <span className="text-center text-[8px] font-medium leading-3 text-white/75 sm:text-[9px]">
          结算 +10
        </span>
      </div>
      <button
        onClick={onMove}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-black text-white hover:bg-white/30"
        title={`把${label}换到对方区域`}
        aria-label={`${label}换边`}
      >
        ⇄
      </button>
    </div>
  );
}
