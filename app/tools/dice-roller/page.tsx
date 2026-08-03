'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';

// ====== 类型和定义 ======
type DieType = 'D4' | 'D6' | 'D8' | 'D10' | 'D12' | 'D20' | 'D100';

interface DieDef {
  type: DieType;
  label: string;
  color: string;
  bg: string;
  sides: number;
}

const DICE: DieDef[] = [
  { type: 'D4', label: 'D4', color: '#dc2626', bg: '#fef2f2', sides: 4 },
  { type: 'D6', label: 'D6', color: '#2563eb', bg: '#eff6ff', sides: 6 },
  { type: 'D8', label: 'D8', color: '#16a34a', bg: '#f0fdf4', sides: 8 },
  { type: 'D10', label: 'D10', color: '#ea580c', bg: '#fff7ed', sides: 10 },
  { type: 'D12', label: 'D12', color: '#9333ea', bg: '#faf5ff', sides: 12 },
  { type: 'D20', label: 'D20', color: '#ca8a04', bg: '#fefce8', sides: 20 },
  { type: 'D100', label: 'D100', color: '#4b5563', bg: '#f9fafb', sides: 100 },
];

// ====== CSS clip-path 形状（统一 64px 容器内） ======
const SHAPE_STYLE: Record<DieType, { clipPath: string; innerRadius?: string }> = {
  D4: { clipPath: 'polygon(50% 5%, 95% 90%, 5% 90%)' },
  D6: { clipPath: 'none' },
  D8: { clipPath: 'polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%)' },
  D10: { clipPath: 'polygon(50% 3%, 92% 48%, 50% 95%, 8% 48%)' },
  D12: { clipPath: 'polygon(25% 4%, 75% 4%, 97% 50%, 75% 96%, 25% 96%, 3% 50%)' },
  D20: { clipPath: 'polygon(50% 2%, 78% 10%, 96% 35%, 96% 65%, 78% 90%, 50% 98%, 22% 90%, 4% 65%, 4% 35%, 22% 10%)' },
  D100: { clipPath: 'polygon(50% 3%, 92% 48%, 50% 95%, 8% 48%)' }, // 同 D10
};

// ====== 掷骰 ======
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

// ====== 骰子面组件 ======
function DieFace({ type, value, rolling, color, bg, size = 'md' }: {
  type: DieType;
  value: number | null;
  rolling: boolean;
  color: string;
  bg: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const dims = { sm: 'w-10 h-10 text-xs', md: 'w-14 h-14 text-lg', lg: 'w-20 h-20 text-2xl' }[size];
  const display = type === 'D100'
    ? (value === 100 ? '00' : String(value ?? 0).padStart(2, '0'))
    : String(value ?? '?');
  const shape = SHAPE_STYLE[type];

  return (
    <div className={`relative ${dims} select-none ${rolling ? 'animate-shake' : ''}`}>
      <div
        className="absolute inset-0 flex items-center justify-center font-bold"
        style={{
          backgroundColor: bg,
          border: `2.5px solid ${color}`,
          color: color,
          clipPath: shape.clipPath,
          borderRadius: type === 'D6' ? '10px' : undefined,
        }}
      >
        {/* D6 用点数不用数字 */}
        {type === 'D6' && value ? null : <span>{display}</span>}
      </div>
      {/* D6 点数（显示在矩形内部，不受 clip-path 影响） */}
      {type === 'D6' && value && (
        <div className="absolute inset-0 flex items-center justify-center">
          <D6Dots value={value} />
        </div>
      )}
    </div>
  );
}

// ====== D6 点数 ======
function D6Dots({ value }: { value: number }) {
  const dots: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [[22, 78], [78, 22]],
    3: [[22, 78], [50, 50], [78, 22]],
    4: [[22, 22], [78, 22], [22, 78], [78, 78]],
    5: [[22, 22], [78, 22], [50, 50], [22, 78], [78, 78]],
    6: [[22, 22], [78, 22], [22, 50], [78, 50], [22, 78], [78, 78]],
  };
  return (
    <>
      {dots[value]?.map(([x, y], i) => (
        <div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full bg-current"
          style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
        />
      ))}
    </>
  );
}

// ====== 形状小图标（用在选择列表里） ======
function ShapeIcon({ type, color, bg, size = 20 }: { type: DieType; color: string; bg: string; size?: number }) {
  const shape = SHAPE_STYLE[type];
  return (
    <div
      style={{
        width: size, height: size,
        backgroundColor: bg,
        border: `1.5px solid ${color}`,
        clipPath: shape.clipPath,
        borderRadius: type === 'D6' ? '3px' : undefined,
      }}
    />
  );
}

// ====== 主页面 ======
interface RollResult { id: number; type: DieType; value: number; }

export default function DiceRollerPage() {
  const [counts, setCounts] = useState<Map<DieType, number>>(new Map());
  const [rolling, setRolling] = useState(false);
  const [results, setResults] = useState<RollResult[]>([]);
  const [diceOnTray, setDiceOnTray] = useState<{ id: number; type: DieType; value: number }[]>([]);
  const idRef = useRef(0);

  const totalDice = Array.from(counts.values()).reduce((s, c) => s + c, 0);
  const selectedList = DICE.filter((d) => (counts.get(d.type) || 0) > 0);

  const grouped = new Map<DieType, RollResult[]>();
  for (const r of results) grouped.set(r.type, [...(grouped.get(r.type) || []), r]);
  const total = results.reduce((s, r) => s + r.value, 0);

  const handleCount = useCallback((type: DieType, delta: number) => {
    setCounts((prev) => {
      const next = new Map(prev);
      const cur = next.get(type) || 0;
      const val = Math.max(0, Math.min(20, cur + delta));
      if (val === 0) next.delete(type); else next.set(type, val);
      return next;
    });
  }, []);

  const handleRoll = useCallback(() => {
    const entries = Array.from(counts.entries()).filter(([, c]) => c > 0);
    if (entries.length === 0) return;
    const defMap = new Map(DICE.map((d) => [d.type, d]));
    const dice: { id: number; type: DieType; value: number }[] = [];
    for (const [type, count] of entries) {
      const def = defMap.get(type)!;
      for (let i = 0; i < count; i++) {
        dice.push({ id: idRef.current++, type, value: rollDie(def.sides) });
      }
    }
    setDiceOnTray(dice);
    setResults([]);
    setRolling(true);
    setTimeout(() => {
      setRolling(false);
      setResults(dice.map((d) => ({ id: d.id, type: d.type, value: d.value })));
    }, 800);
  }, [counts]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-lg bg-white/80 dark:bg-zinc-950/80 border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          <Link href="/" className="inline-flex items-center text-sm text-zinc-500 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group">
            <span className="mr-1.5 group-hover:-translate-x-1 transition-transform">←</span>
            返回首页
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">🎲 骰子模拟器</h1>

        {/* ====== 顶部：总计 + 按钮 + 预览 ====== */}
        <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          {/* 总计 */}
          {results.length > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
              <span className="text-xs font-medium opacity-70">总计</span>
              <span className="text-2xl font-bold">{total}</span>
            </div>
          )}

          {/* 投掷按钮 */}
          <button
            onClick={handleRoll}
            disabled={totalDice === 0}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:bg-zinc-200 dark:disabled:bg-zinc-800 disabled:text-zinc-400 disabled:cursor-not-allowed sm:ml-auto"
          >
            {totalDice > 0 ? `🎲 投掷 ${totalDice} 颗骰子` : '🎲 选择骰子'}
          </button>
        </div>

        {/* 本次投掷预览 */}
        {selectedList.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">本次投掷:</span>
            {selectedList.map((die) => (
              <span key={die.type}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
                style={{ backgroundColor: die.bg, color: die.color, border: `1px solid ${die.color}30` }}
              >
                <ShapeIcon type={die.type} color={die.color} bg={die.bg} size={14} />
                {die.label} ×{counts.get(die.type)}
              </span>
            ))}
          </div>
        )}

        {/* ====== 骰盘 ====== */}
        <div className="mt-5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 p-6 sm:p-10 min-h-[220px] flex items-center justify-center">
          {diceOnTray.length === 0 ? (
            <p className="text-zinc-400 dark:text-zinc-500 text-sm">选择骰子后点击投掷</p>
          ) : (
            <div className="flex flex-wrap justify-center gap-3 sm:gap-4">
              {diceOnTray.map((d) => {
                const def = DICE.find((x) => x.type === d.type)!;
                return (
                  <DieFace
                    key={d.id}
                    type={d.type}
                    value={rolling ? null : d.value}
                    rolling={rolling}
                    color={def.color}
                    bg={def.bg}
                    size="lg"
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* ====== 结果明细 ====== */}
        {results.length > 0 && (
          <div className="mt-4 space-y-2">
            {Array.from(grouped.entries()).map(([type, dice]) => {
              const def = DICE.find((x) => x.type === type)!;
              const sum = dice.reduce((s, d) => s + d.value, 0);
              return (
                <div key={type}
                  className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
                >
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ backgroundColor: def.bg, color: def.color }}>
                    {type}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {dice.map((d) => type === 'D100' ? (d.value === 100 ? '00' : d.value) : d.value).join(' + ')}
                  </span>
                  <span className="ml-auto text-sm font-bold text-zinc-900 dark:text-zinc-100">= {sum}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* ====== 骰子选择器 ====== */}
        <div className="mt-8">
          <h3 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3">骰子类型</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {DICE.map((die) => {
              const count = counts.get(die.type) || 0;
              return (
                <div
                  key={die.type}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
                >
                  <ShapeIcon type={die.type} color={die.color} bg={die.bg} size={22} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{die.label}</div>
                    <div className="text-[10px] text-zinc-400">{die.sides}面</div>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => handleCount(die.type, -1)}
                      disabled={count === 0}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-base text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors font-medium"
                    >−</button>
                    <span className="w-7 text-center text-sm font-bold text-zinc-900 dark:text-zinc-100 tabular-nums">{count}</span>
                    <button
                      onClick={() => handleCount(die.type, 1)}
                      disabled={count >= 20}
                      className="w-8 h-8 flex items-center justify-center rounded-md text-base text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-20 disabled:cursor-not-allowed transition-colors font-medium"
                    >+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
