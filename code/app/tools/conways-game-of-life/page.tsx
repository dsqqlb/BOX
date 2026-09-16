'use client';

import { ChangeEvent, PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';

const COLS = 80;
const ROWS = 48;
const MAX_HISTORY = 48;
const STORAGE_KEY = 'box-conways-game-of-life-v1';

type RuleId = 'conway' | 'highlife' | 'seeds';
type ThemeId = 'neon' | 'aurora' | 'ember';
type Snapshot = { cells: number[]; generation: number; rule: RuleId; wrap: boolean; theme: ThemeId };
type HistoryItem = { board: Set<number>; generation: number };
type Pattern = { name: string; note: string; cells: Array<[number, number]> };

const RULES: Record<RuleId, { label: string; notation: string; born: number[]; survive: number[]; description: string }> = {
  conway: { label: '康威经典', notation: 'B3 / S23', born: [3], survive: [2, 3], description: '最著名的平衡规则：诞生、稳定与混沌共存。' },
  highlife: { label: 'HighLife', notation: 'B36 / S23', born: [3, 6], survive: [2, 3], description: '多一个 B6 出生条件，常会产生复制器。' },
  seeds: { label: 'Seeds', notation: 'B2 / S', born: [2], survive: [], description: '细胞只能存活一代，适合爆炸般的几何生长。' },
};

const THEMES: Record<ThemeId, { label: string; glow: string; cell: string; hot: string; grid: string; background: string }> = {
  neon: { label: '霓虹青蓝', glow: '#22d3ee', cell: '#67e8f9', hot: '#a78bfa', grid: 'rgba(103,232,249,.13)', background: '#07111d' },
  aurora: { label: '极光绿紫', glow: '#34d399', cell: '#6ee7b7', hot: '#c084fc', grid: 'rgba(110,231,183,.13)', background: '#071510' },
  ember: { label: '熔火橙红', glow: '#fb923c', cell: '#fdba74', hot: '#fb7185', grid: 'rgba(253,186,116,.13)', background: '#1a0b09' },
};

const PATTERNS: Pattern[] = [
  { name: '滑翔机', note: '穿越无限空间的经典旅行者', cells: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]] },
  { name: '闪烁器', note: '两代循环的最小振荡器', cells: [[0, 0], [1, 0], [2, 0]] },
  { name: '方块', note: '永不变化的静物', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: '脉冲星', note: '周期为 3 的大型振荡器', cells: [[2, 0], [3, 0], [4, 0], [8, 0], [9, 0], [10, 0], [0, 2], [5, 2], [7, 2], [12, 2], [0, 3], [5, 3], [7, 3], [12, 3], [0, 4], [5, 4], [7, 4], [12, 4], [2, 5], [3, 5], [4, 5], [8, 5], [9, 5], [10, 5], [2, 7], [3, 7], [4, 7], [8, 7], [9, 7], [10, 7], [0, 8], [5, 8], [7, 8], [12, 8], [0, 9], [5, 9], [7, 9], [12, 9], [0, 10], [5, 10], [7, 10], [12, 10], [2, 12], [3, 12], [4, 12], [8, 12], [9, 12], [10, 12]] },
  { name: 'Gosper 滑翔机枪', note: '持续发射滑翔机的生命机器', cells: [[24,0],[22,1],[24,1],[12,2],[13,2],[20,2],[21,2],[34,2],[35,2],[11,3],[15,3],[20,3],[21,3],[34,3],[35,3],[0,4],[1,4],[10,4],[16,4],[20,4],[21,4],[0,5],[1,5],[10,5],[14,5],[16,5],[17,5],[22,5],[24,5],[10,6],[16,6],[24,6],[11,7],[15,7],[12,8],[13,8]] },
];

const idFor = (x: number, y: number) => y * COLS + x;
const pointFor = (id: number) => ({ x: id % COLS, y: Math.floor(id / COLS) });
const initialBoard = () => new Set(PATTERNS[0].cells.map(([x, y]) => idFor(x + 37, y + 21)));

function evolve(board: Set<number>, rule: RuleId, wrap: boolean) {
  const candidates = new Map<number, number>();
  const { born, survive } = RULES[rule];
  for (const id of board) {
    const { x, y } = pointFor(id);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        let nx = x + dx; let ny = y + dy;
        if (wrap) { nx = (nx + COLS) % COLS; ny = (ny + ROWS) % ROWS; }
        if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
        const neighborId = idFor(nx, ny);
        candidates.set(neighborId, (candidates.get(neighborId) || 0) + 1);
      }
    }
  }
  const next = new Set<number>();
  for (const [id, neighbors] of candidates) {
    if (board.has(id) ? survive.includes(neighbors) : born.includes(neighbors)) next.add(id);
  }
  return next;
}

function Icon({ children }: { children: React.ReactNode }) { return <span className="text-base leading-none" aria-hidden="true">{children}</span>; }

export default function ConwaysGameOfLifePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const liveRef = useRef<Set<number>>(initialBoard());
  const paintingRef = useRef(false);
  const paintAliveRef = useRef(true);
  const [live, setLive] = useState<Set<number>>(() => new Set(liveRef.current));
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [generation, setGeneration] = useState(0);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(8);
  const [zoom, setZoom] = useState(13);
  const [rule, setRule] = useState<RuleId>('conway');
  const [wrap, setWrap] = useState(true);
  const [theme, setTheme] = useState<ThemeId>('neon');
  const [peak, setPeak] = useState(liveRef.current.size);
  const [message, setMessage] = useState('绘制细胞，或从图案库唤醒一个生命系统。');

  const activeTheme = THEMES[theme];
  const boardWidth = COLS * zoom;
  const boardHeight = ROWS * zoom;
  const density = Math.round((live.size / (COLS * ROWS)) * 1000) / 10;

  const remember = useCallback((board: Set<number>, atGeneration = generation) => {
    setHistory((current) => [...current.slice(-(MAX_HISTORY - 1)), { board: new Set(board), generation: atGeneration }]);
  }, [generation]);

  const setBoard = useCallback((next: Set<number>, shouldRemember = true, nextGeneration = generation) => {
    if (shouldRemember) remember(liveRef.current);
    liveRef.current = next;
    setLive(new Set(next));
    setGeneration(nextGeneration);
    setPeak((current) => Math.max(current, next.size));
  }, [generation, remember]);

  const step = useCallback(() => {
    const next = evolve(liveRef.current, rule, wrap);
    remember(liveRef.current, generation);
    liveRef.current = next;
    setLive(new Set(next));
    setGeneration((current) => current + 1);
    setPeak((current) => Math.max(current, next.size));
  }, [generation, remember, rule, wrap]);

  useEffect(() => {
    if (!running) return undefined;
    const interval = window.setInterval(step, Math.max(24, Math.round(1000 / speed)));
    return () => window.clearInterval(interval);
  }, [running, speed, step]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = boardWidth * ratio;
    canvas.height = boardHeight * ratio;
    canvas.style.width = `${boardWidth}px`;
    canvas.style.height = `${boardHeight}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.fillStyle = activeTheme.background;
    context.fillRect(0, 0, boardWidth, boardHeight);
    context.strokeStyle = activeTheme.grid;
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= COLS; x += 1) { context.moveTo(x * zoom + .5, 0); context.lineTo(x * zoom + .5, boardHeight); }
    for (let y = 0; y <= ROWS; y += 1) { context.moveTo(0, y * zoom + .5); context.lineTo(boardWidth, y * zoom + .5); }
    context.stroke();
    const size = Math.max(3, zoom - 3);
    context.shadowColor = activeTheme.glow;
    context.shadowBlur = Math.min(14, zoom);
    for (const id of live) {
      const { x, y } = pointFor(id);
      const gradient = context.createLinearGradient(x * zoom, y * zoom, (x + 1) * zoom, (y + 1) * zoom);
      gradient.addColorStop(0, activeTheme.cell);
      gradient.addColorStop(1, activeTheme.hot);
      context.fillStyle = gradient;
      context.fillRect(x * zoom + (zoom - size) / 2, y * zoom + (zoom - size) / 2, size, size);
    }
    context.shadowBlur = 0;
  }, [activeTheme, boardHeight, boardWidth, live, zoom]);

  useEffect(() => {
    const restore = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw) as Snapshot;
        if (!Array.isArray(saved.cells)) return;
        const restored = new Set(saved.cells.filter((id) => Number.isInteger(id) && id >= 0 && id < COLS * ROWS));
        liveRef.current = restored; setLive(restored); setGeneration(Number(saved.generation) || 0); setRule(saved.rule in RULES ? saved.rule : 'conway'); setWrap(Boolean(saved.wrap)); setTheme(saved.theme in THEMES ? saved.theme : 'neon'); setPeak(restored.size); setMessage('已恢复浏览器中的上次快照。');
      } catch { window.localStorage.removeItem(STORAGE_KEY); }
    };
    restore();
  }, []);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Space') { event.preventDefault(); setRunning((value) => !value); }
      if (event.key.toLowerCase() === 'n') step();
      if (event.key.toLowerCase() === 'c') { setRunning(false); setBoard(new Set()); setMessage('棋盘已清空。'); }
      if (event.key.toLowerCase() === 'r') randomize();
    };
    window.addEventListener('keydown', shortcuts);
    return () => window.removeEventListener('keydown', shortcuts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const locate = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.floor(((event.clientX - rect.left) / rect.width) * COLS), y: Math.floor(((event.clientY - rect.top) / rect.height) * ROWS) };
  };

  const paint = (event: PointerEvent<HTMLCanvasElement>, starting = false) => {
    const { x, y } = locate(event);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    const id = idFor(x, y);
    const next = new Set(liveRef.current);
    if (starting) { remember(liveRef.current); paintAliveRef.current = !next.has(id); }
    paintAliveRef.current ? next.add(id) : next.delete(id);
    liveRef.current = next;
    setLive(next);
    setPeak((current) => Math.max(current, next.size));
  };

  const randomize = useCallback(() => {
    setRunning(false);
    const next = new Set<number>();
    for (let id = 0; id < COLS * ROWS; id += 1) if (Math.random() < .24) next.add(id);
    setBoard(next, true, 0); setMessage('已注入随机生命种子。');
  }, [setBoard]);

  const loadPattern = (pattern: Pattern) => {
    setRunning(false);
    const width = Math.max(...pattern.cells.map(([x]) => x)) + 1;
    const height = Math.max(...pattern.cells.map(([, y]) => y)) + 1;
    const next = new Set<number>();
    const offsetX = Math.floor((COLS - width) / 2);
    const offsetY = Math.floor((ROWS - height) / 2);
    pattern.cells.forEach(([x, y]) => next.add(idFor(x + offsetX, y + offsetY)));
    setBoard(next, true, 0); setMessage(`已加载「${pattern.name}」：${pattern.note}`);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) { setMessage('还没有可撤销的操作。'); return; }
    setHistory((items) => items.slice(0, -1));
    liveRef.current = new Set(previous.board); setLive(new Set(previous.board)); setGeneration(previous.generation); setRunning(false); setMessage('已撤销上一步。');
  };

  const saveLocal = () => {
    const snapshot: Snapshot = { cells: [...liveRef.current], generation, rule, wrap, theme };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    setMessage('快照已保存在此浏览器中。');
  };

  const exportSnapshot = () => {
    const snapshot: Snapshot = { cells: [...liveRef.current], generation, rule, wrap, theme };
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `life-generation-${generation}.json`; link.click(); URL.revokeObjectURL(url);
    setMessage('已导出当前生命快照。');
  };

  const importSnapshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text()) as Snapshot;
      if (!Array.isArray(snapshot.cells)) throw new Error('invalid');
      const next = new Set(snapshot.cells.filter((id) => Number.isInteger(id) && id >= 0 && id < COLS * ROWS));
      setRunning(false); liveRef.current = next; setLive(next); setGeneration(Number(snapshot.generation) || 0); setRule(snapshot.rule in RULES ? snapshot.rule : 'conway'); setWrap(Boolean(snapshot.wrap)); setTheme(snapshot.theme in THEMES ? snapshot.theme : 'neon'); setPeak(next.size); setMessage(`已导入 ${next.size} 个细胞的快照。`);
    } catch { setMessage('无法读取该快照文件。'); }
    event.target.value = '';
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050b13] text-slate-100 selection:bg-cyan-300/30">
      <ToolHeader className="border-cyan-200/10 bg-[#07111c]/80" textClassName="text-cyan-100/70 hover:text-cyan-100" />
      <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"><div className={`absolute -left-36 -top-28 h-[32rem] w-[32rem] rounded-full blur-[130px] ${theme === 'ember' ? 'bg-orange-500/15' : theme === 'aurora' ? 'bg-emerald-500/14' : 'bg-cyan-500/15'}`} /><div className="absolute -right-32 top-1/3 h-[28rem] w-[28rem] rounded-full bg-violet-500/10 blur-[130px]" /></div>
      <div className="relative mx-auto max-w-[1500px] px-4 pb-10 pt-7 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-5 border-b border-white/[.08] pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div><p className="flex items-center gap-2 text-xs font-semibold tracking-[.22em] text-cyan-200/75"><span className="h-px w-8 bg-cyan-300/70" /> CELLULAR AUTOMATON LAB</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">生命游戏 <span className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">/ LIFE ENGINE</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">没有玩家，只有规则。每一代都由周围八个邻居决定命运；你负责点燃最初的火花。</p></div>
          <div className="flex flex-wrap gap-2"><div className="rounded-xl border border-white/[.1] bg-white/[.04] px-3 py-2"><p className="text-[10px] tracking-wider text-slate-500">GENERATION</p><p className="font-mono text-lg font-bold text-cyan-100">{generation.toLocaleString()}</p></div><div className="rounded-xl border border-white/[.1] bg-white/[.04] px-3 py-2"><p className="text-[10px] tracking-wider text-slate-500">POPULATION</p><p className="font-mono text-lg font-bold text-violet-100">{live.size.toLocaleString()}</p></div><div className="rounded-xl border border-white/[.1] bg-white/[.04] px-3 py-2"><p className="text-[10px] tracking-wider text-slate-500">DENSITY</p><p className="font-mono text-lg font-bold text-emerald-100">{density}%</p></div></div>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 overflow-hidden rounded-3xl border border-white/[.12] bg-[#07111c]/75 shadow-[0_28px_100px_rgba(0,0,0,.35)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-4 py-3 sm:px-5"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${running ? 'animate-pulse' : ''}`} style={{ backgroundColor: activeTheme.glow, boxShadow: `0 0 16px ${activeTheme.glow}` }} /><span className="text-xs font-semibold tracking-[.16em] text-slate-300">{running ? 'SIMULATION ACTIVE' : 'SIMULATION PAUSED'}</span></div><p className="max-w-[350px] truncate text-right text-xs text-slate-500" aria-live="polite">{message}</p></div>
            <div className="overflow-auto p-3 sm:p-5"><div className="relative mx-auto w-max rounded-xl border border-white/[.08] p-1 shadow-[0_0_60px_rgba(34,211,238,.08)]" style={{ backgroundColor: `${activeTheme.background}cc` }}><canvas ref={canvasRef} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); paintingRef.current = true; paint(event, true); }} onPointerMove={(event) => { if (paintingRef.current) paint(event); }} onPointerUp={() => { paintingRef.current = false; }} onPointerCancel={() => { paintingRef.current = false; }} className="touch-none cursor-crosshair rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" role="img" aria-label="生命游戏网格：点击或拖拽以绘制或擦除细胞" tabIndex={0} /></div></div>
            <div className="flex flex-wrap items-center gap-2 border-t border-white/[.08] px-4 py-3 sm:px-5"><button onClick={() => setRunning((value) => !value)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3.5 py-2 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"><Icon>{running ? 'Ⅱ' : '▶'}</Icon>{running ? '暂停' : '开始'}</button><button onClick={step} className="inline-flex items-center gap-2 rounded-xl border border-white/[.12] bg-white/[.05] px-3.5 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/[.1]"><Icon>→</Icon>演化一代</button><button onClick={undo} disabled={!history.length} className="rounded-xl border border-white/[.1] px-3 py-2 text-sm text-slate-300 transition hover:bg-white/[.07] disabled:cursor-not-allowed disabled:opacity-35">↶ 撤销</button><button onClick={() => { setRunning(false); setBoard(new Set(), true, 0); setMessage('棋盘已清空。'); }} className="rounded-xl px-3 py-2 text-sm text-slate-400 transition hover:bg-rose-400/10 hover:text-rose-100">清空</button><button onClick={randomize} className="rounded-xl px-3 py-2 text-sm text-violet-200 transition hover:bg-violet-400/10">✦ 随机注入</button></div>
          </div>

          <aside className="space-y-4 xl:max-h-[calc(100vh-140px)] xl:overflow-y-auto xl:pr-1">
            <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold tracking-[.18em] text-cyan-200">EVOLUTION CONTROL</p><div className="mt-4"><div className="flex items-center justify-between text-sm"><span className="text-slate-300">演化速率</span><span className="font-mono text-cyan-200">{speed} FPS</span></div><input className="mt-3 w-full accent-cyan-300" type="range" min="1" max="20" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="演化速率" /></div><div className="mt-4"><div className="flex items-center justify-between text-sm"><span className="text-slate-300">网格缩放</span><span className="font-mono text-cyan-200">{zoom}px</span></div><input className="mt-3 w-full accent-violet-300" type="range" min="8" max="22" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="网格缩放" /></div><label className="mt-4 flex cursor-pointer items-center justify-between rounded-xl border border-white/[.08] bg-slate-950/30 px-3 py-2.5 text-sm"><span><span className="block text-slate-200">环绕宇宙</span><span className="mt-0.5 block text-[11px] text-slate-500">边缘细胞从另一侧出现</span></span><input type="checkbox" checked={wrap} onChange={(event) => setWrap(event.target.checked)} className="h-4 w-4 accent-cyan-300" /></label></div>
            <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold tracking-[.18em] text-violet-200">RULESET</p><div className="mt-3 grid gap-2">{(Object.keys(RULES) as RuleId[]).map((id) => <button key={id} onClick={() => { setRule(id); setMessage(`规则已切换为 ${RULES[id].label} · ${RULES[id].notation}`); }} className={`rounded-xl border p-3 text-left transition ${rule === id ? 'border-violet-300/50 bg-violet-400/15' : 'border-white/[.08] bg-slate-950/25 hover:bg-white/[.05]'}`}><span className="flex items-center justify-between text-sm font-semibold text-white">{RULES[id].label}<span className="font-mono text-xs text-violet-200">{RULES[id].notation}</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">{RULES[id].description}</span></button>)}</div></div>
            <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold tracking-[.18em] text-emerald-200">PATTERN LIBRARY</p><div className="mt-3 grid grid-cols-2 gap-2">{PATTERNS.map((pattern) => <button key={pattern.name} title={pattern.note} onClick={() => loadPattern(pattern)} className="rounded-xl border border-white/[.08] bg-slate-950/30 px-3 py-2.5 text-left text-xs font-medium text-slate-200 transition hover:border-cyan-300/35 hover:bg-cyan-300/[.07]">{pattern.name}</button>)}</div></div>
            <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold tracking-[.18em] text-orange-200">ARCHIVE & LOOK</p><div className="mt-3 grid grid-cols-3 gap-2">{(Object.keys(THEMES) as ThemeId[]).map((id) => <button key={id} onClick={() => setTheme(id)} className={`rounded-lg border px-2 py-2 text-[11px] ${theme === id ? 'border-white/35 bg-white/[.11] text-white' : 'border-white/[.08] text-slate-500 hover:text-slate-200'}`}>{THEMES[id].label}</button>)}</div><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={saveLocal} className="rounded-lg border border-white/[.1] px-2 py-2 text-xs text-slate-300 hover:bg-white/[.06]">保存到此浏览器</button><button onClick={exportSnapshot} className="rounded-lg border border-white/[.1] px-2 py-2 text-xs text-slate-300 hover:bg-white/[.06]">导出 JSON</button><button onClick={() => inputRef.current?.click()} className="rounded-lg border border-white/[.1] px-2 py-2 text-xs text-slate-300 hover:bg-white/[.06]">导入快照</button><button onClick={() => { window.localStorage.removeItem(STORAGE_KEY); setMessage('已移除浏览器内的保存快照。'); }} className="rounded-lg border border-white/[.1] px-2 py-2 text-xs text-slate-500 hover:bg-rose-400/10 hover:text-rose-200">移除本地保存</button><input ref={inputRef} type="file" accept="application/json" className="hidden" onChange={importSnapshot} /></div></div>
          </aside>
        </section>
        <section className="mt-5 grid gap-3 text-xs text-slate-500 sm:grid-cols-3"><div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3"><span className="font-semibold text-slate-300">规则</span><p className="mt-1 leading-5">活细胞有 2–3 个邻居存活；死细胞恰有 3 个邻居诞生（康威规则）。</p></div><div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3"><span className="font-semibold text-slate-300">手势与快捷键</span><p className="mt-1 leading-5">点击/拖拽绘制；空格开始或暂停，N 演化一代，R 随机，C 清空。</p></div><div className="rounded-xl border border-white/[.07] bg-white/[.025] p-3"><span className="font-semibold text-slate-300">本地优先</span><p className="mt-1 leading-5">模拟只在当前浏览器运行。快照不会上传；峰值细胞数：{peak.toLocaleString()}。</p></div></section>
      </div>
    </main>
  );
}
