'use client';
import { useRef, useState } from 'react';
import CardTile from './CardTile';
import ManaCurve from './ManaCurve';
import { DeckViewMode, EdhCard, EdhDeckCardEntry, EdhDeckLayout } from '@/lib/edh/types';
import { primaryCardType, TYPE_LABEL_ZH, TYPE_ORDER } from '@/lib/edh/mana';

interface MovingCard {
  oracleId: string;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  pointerId: number;
}

export default function DeckBoard({ entries, commanderOracleId, cardOf, layout, dragActive, onMoveCard, onRemoveOne, onSetCommander, onClearCommander, onDetails }: {
  entries: EdhDeckCardEntry[];
  commanderOracleId: string | null;
  cardOf: (id: string) => EdhCard | undefined;
  layout: EdhDeckLayout;
  /** 是否有来自卡池的拖拽正在进行（用于高亮可投放区域）。 */
  dragActive: boolean;
  onMoveCard: (id: string, point: { x: number; y: number }) => void;
  onRemoveOne: (card: EdhCard) => void;
  onSetCommander: (card: EdhCard) => void;
  onClearCommander: () => void;
  onDetails: (card: EdhCard) => void;
}) {
  const boardInnerRef = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<MovingCard | null>(null);
  const movedRef = useRef(false); // 本次指针手势是否发生了拖拽（用于抑制拖拽后的 click）
  const free = layout.viewMode === 'free';

  const commander = commanderOracleId ? cardOf(commanderOracleId) : undefined;
  const total = entries.reduce((s, e) => s + e.quantity, 0) + (commander ? 1 : 0);
  const cards = entries.map((e) => ({ entry: e, card: cardOf(e.oracleId) })).filter((x): x is { entry: EdhDeckCardEntry; card: EdhCard } => Boolean(x.card));
  const grouped = new Map<string, typeof cards>();
  TYPE_ORDER.forEach((t) => grouped.set(t, []));
  cards.forEach((x) => grouped.get(primaryCardType(x.card.typeLine))?.push(x));

  // ---- 自由桌面：指针拖拽移动卡牌。抓取点（指针相对卡牌左上角的偏移）在拖拽全程保持不变，
  //      所以拿起时卡牌不会跳动，松手后停在指针所在位置。 ----
  const beginMove = (e: React.PointerEvent, oracleId: string) => {
    if (e.button !== 0) return; // 只响应主键（左键/触摸）
    if ((e.target as HTMLElement).closest('button')) return; // 从移除按钮上按下不算拖拽
    const el = e.currentTarget as HTMLElement;
    const elRect = el.getBoundingClientRect();
    const innerRect = boardInnerRef.current?.getBoundingClientRect();
    if (!innerRect) return;
    const state: MovingCard = {
      oracleId,
      offsetX: e.clientX - elRect.left,
      offsetY: e.clientY - elRect.top,
      x: elRect.left - innerRect.left,
      y: elRect.top - innerRect.top,
      pointerId: e.pointerId,
    };
    movedRef.current = false;
    try { el.setPointerCapture(e.pointerId); } catch { /* 某些环境不支持捕获时继续用 window 监听 */ }
    setMoving(state);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;
      const rect = boardInnerRef.current?.getBoundingClientRect();
      if (!rect) return;
      if (!movedRef.current && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) > 5) movedRef.current = true;
      setMoving({
        ...state,
        x: Math.max(0, ev.clientX - rect.left - state.offsetX),
        y: Math.max(0, ev.clientY - rect.top - state.offsetY),
      });
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== state.pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setMoving(null);
      if (movedRef.current) {
        const rect = boardInnerRef.current?.getBoundingClientRect();
        if (rect) onMoveCard(state.oracleId, {
          x: Math.max(0, ev.clientX - rect.left - state.offsetX),
          y: Math.max(0, ev.clientY - rect.top - state.offsetY),
        });
        // 等本轮的 click 派发完再放开抑制，防止拖拽结束误触打开详情
        setTimeout(() => { movedRef.current = false; }, 0);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const guardDetails = (card: EdhCard) => {
    if (movedRef.current) return; // 拖拽刚结束，忽略随之而来的 click
    onDetails(card);
  };

  const renderTile = (entry: EdhDeckCardEntry, card: EdhCard) => (
    <CardTile key={entry.oracleId} card={card} quantity={entry.quantity} onRemove={onRemoveOne} onDetails={guardDetails} draggable={false} />
  );

  const sort = (mode: DeckViewMode) => (mode === 'cmc' ? [...cards].sort((a, b) => a.card.cmc - b.card.cmc) : mode === 'type' ? [...cards].sort((a, b) => primaryCardType(a.card.typeLine).localeCompare(primaryCardType(b.card.typeLine))) : cards);

  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-between border-b border-white/10 pb-3">
        <b>牌组桌面</b>
        <span className={total === 100 ? 'text-emerald-300' : 'text-amber-300'}>{total}/100</span>
      </div>

      {/* 指挥官槽位：data-drop-zone 供全局拖拽系统识别投放目标 */}
      <div data-drop-zone="commander" className={`mt-3 flex min-h-36 items-center gap-4 rounded-2xl border-2 border-dashed p-3 transition ${dragActive ? 'border-cyan-300/60 bg-cyan-300/10' : 'border-amber-300/30 bg-amber-300/[.04]'}`}>
        <div className="text-xs text-amber-200">指挥官槽位<br /><span className="text-slate-500">拖入可作指挥官的牌</span></div>
        {commander ? (
          <div className="w-24">
            <CardTile card={commander} isCommander onDetails={guardDetails} draggable={false} />
            <button onClick={onClearCommander} className="mt-1 text-xs text-rose-300">移除指挥官</button>
          </div>
        ) : (
          <div className="text-sm text-slate-500">空</div>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[.02] p-3">
        <ManaCurve entries={entries} cardOf={cardOf} />
      </div>

      {/* 桌面投放区：free 模式下卡牌坐标相对内层容器，其他模式只加牌不记位置 */}
      <div data-drop-zone="board" className={`relative mt-3 min-h-[360px] flex-1 overflow-auto rounded-2xl border p-4 transition sm:min-h-[500px] ${dragActive ? 'border-cyan-300/50 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.14),transparent_60%)]' : 'border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,.08),transparent_60%)]'}`}>
        {cards.length === 0 ? (
          <p className="grid h-full place-items-center text-slate-500">拖拽搜索结果到桌面，或在卡牌详情中加入牌组</p>
        ) : free ? (
          <div ref={boardInnerRef} data-drop-zone="board-free" className="relative min-h-[420px] sm:min-h-[620px]">
            {cards.map(({ entry, card }, i) => {
              const p = layout.positions[entry.oracleId] || { x: (i % 5) * 105, y: Math.floor(i / 5) * 170 };
              const isMoving = moving?.oracleId === entry.oracleId;
              return (
                <div
                  key={entry.oracleId}
                  className="absolute w-24 cursor-grab active:cursor-grabbing"
                  style={{
                    left: isMoving ? moving.x : p.x,
                    top: isMoving ? moving.y : p.y,
                    zIndex: isMoving ? 30 : undefined,
                    touchAction: 'none', // 触屏拖拽不被滚动抢走
                    opacity: isMoving ? 0.9 : undefined,
                    boxShadow: isMoving ? '0 0 0 2px rgba(34,211,238,.6), 0 16px 40px rgba(0,0,0,.5)' : undefined,
                    borderRadius: isMoving ? 12 : undefined,
                  }}
                  onPointerDown={(e) => beginMove(e, entry.oracleId)}
                >
                  {renderTile(entry, card)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-5">
            {layout.viewMode === 'type'
              ? TYPE_ORDER.map((t) => {
                  const g = grouped.get(t) || [];
                  return g.length ? (
                    <section key={t}>
                      <p className="mb-2 text-xs text-slate-500">{TYPE_LABEL_ZH[t]}</p>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">{g.map((x) => renderTile(x.entry, x.card))}</div>
                    </section>
                  ) : null;
                })
              : Array.from({ length: 8 }, (_, cmc) => {
                  const g = sort('cmc').filter((x) => Math.min(Math.round(x.card.cmc), 7) === cmc);
                  return g.length ? (
                    <section key={cmc}>
                      <p className="mb-2 text-xs text-slate-500">法术力 {cmc === 7 ? '7+' : cmc}</p>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">{g.map((x) => renderTile(x.entry, x.card))}</div>
                    </section>
                  ) : null;
                })}
          </div>
        )}
      </div>
    </div>
  );
}
