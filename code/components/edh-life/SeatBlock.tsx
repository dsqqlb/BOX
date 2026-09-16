'use client';

/**
 * EDH 记血器 —— 单个座位色块。
 *
 * 视觉（按该座位玩家的视角）：
 *   ┌─────────────────────────────┐
 *   │          玩家 1             │
 *   │   ┌───────────────┐         │
 *   │   │      38       │         │  ← 大号血量居中；中央有一块**隐形**正方形
 *   │   └───────────────┘         │
 *   │ [⚡][💰][🔍][🍖][☠][✦]      │  ← 六个计数器一行毛玻璃方块
 *   └─────────────────────────────┘
 *
 * 交互（全部按"当前这个视角"判定，对面的人看到的左右和他是对称的）：
 *   - **色块左半**：单击 −1；**按住 1 秒**开始 −5，**继续按住则每 0.55 秒再 −5**
 *   - **色块右半**：单击 +1；按住同理持续 +5
 *   - **中央隐形正方形**（就是大数字所在的位置，没有任何描边）：
 *     按住 2 秒弹出「掉血 / 回血任意数值」弹窗，按住期间数字颤抖
 *   - 记录按钮：打开该玩家专属的记录面板
 *   - 血量 ≤ 0 或中毒满 10 → 整块变灰 + 骷髅头
 *
 * 左右两半按屏幕上的视觉位置判定，再根据座位旋转映射到游戏逻辑：
 * 正座位是左减右加；对面座位整体旋转 180°，所以屏幕左边是加、右边是减。
 *
 * 所有指针交互都 preventDefault，避免移动端长按弹菜单、选中文字或触发滚动。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COUNTERS,
  darken, lighten, readableTextColor,
  type PlayerState,
} from '@/lib/edh-life/types';

const HOLD_MS = 1000;          // 按住多久开始 ±5
const HOLD_REPEAT_MS = 550;    // 开始之后每隔多久再 ±5（持续按住就持续掉/回血）
const HOLD_STEP = 5;
const CENTER_HOLD_MS = 2000;   // 中央隐形方块按住多久弹出任意数值弹窗
const MOVE_TOLERANCE_PX = 28;  // 指针移动超过这个距离就取消长按

type Side = 'left' | 'right';

interface SeatBlockProps {
  player: PlayerState;
  rotation: 0 | 180;
  onLifeChange: (seat: number, delta: number) => void;
  /** 中央方块按住 2 秒 → 打开「掉血 / 回血任意数值」弹窗 */
  onOpenAmountMenu: (seat: number) => void;
  onOpenCounters: (seat: number) => void;
  onRename: (seat: number, name: string) => void;
}

export default function SeatBlock({
  player, rotation,
  onLifeChange, onOpenAmountMenu, onOpenCounters, onRename,
}: SeatBlockProps) {
  const [sideHold, setSideHold] = useState<{ side: Side; progress: number } | null>(null);
  const [centerHold, setCenterHold] = useState<number | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(player.name);

  const sideRef = useRef<{
    side: Side;
    pointerId: number;
    startedAt: number;
    lastStepAt: number;
    startX: number;
    startY: number;
    stepped: boolean;   // 是否已经开始走"按住 ±5"
    raf: number;
  } | null>(null);
  const centerRef = useRef<{ pointerId: number; startedAt: number; startX: number; startY: number; fired: boolean; raf: number } | null>(null);

  const movedAway = (x: number, y: number, startX: number, startY: number) =>
    Math.abs(x - startX) > MOVE_TOLERANCE_PX || Math.abs(y - startY) > MOVE_TOLERANCE_PX;

  const buzz = (ms: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(ms); } catch { /* 忽略 */ }
    }
  };

  /* ── 左右两半：单击 ±1；按住 1 秒后每 0.55 秒 ±5 ── */

  const cancelSide = useCallback(() => {
    const hold = sideRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    sideRef.current = null;
    setSideHold(null);
  }, []);

  const finishSide = useCallback(() => {
    const hold = sideRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    const shouldTap = !hold.stepped;
    sideRef.current = null;
    setSideHold(null);
    // 没进入"按住 ±5"阶段 → 当成单击 ±1
    if (shouldTap) onLifeChange(player.seat, hold.side === 'right' ? 1 : -1);
  }, [onLifeChange, player.seat]);

  const startSide = useCallback((clientX: number, clientY: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (editingName) return;
    event.preventDefault();
    event.stopPropagation();
    if (sideRef.current) cancelSide();

    const catcher = event.currentTarget;
    const seat = catcher.closest<HTMLElement>('[data-seat]') ?? catcher;
    const rect = seat.getBoundingClientRect();
    const visualSide: Side = clientX < rect.left + rect.width / 2 ? 'left' : 'right';
    // segment 内部仍用“左减右加”；对面座位把屏幕左右互换后再交给统一的结算逻辑。
    const side: Side = rotation === 180
      ? (visualSide === 'left' ? 'right' : 'left')
      : visualSide;

    try { catcher.setPointerCapture(event.pointerId); } catch { /* 部分旧浏览器不支持捕获 */ }
    const hold = {
      side,
      pointerId: event.pointerId,
      startedAt: performance.now(),
      lastStepAt: 0,
      startX: clientX,
      startY: clientY,
      stepped: false,
      raf: 0,
    };
    sideRef.current = hold;
    setSideHold({ side, progress: 0 });

    const tick = () => {
      const current = sideRef.current;
      if (!current || current !== hold) return;
      const elapsed = performance.now() - current.startedAt;
      const progress = Math.min(1, elapsed / HOLD_MS);
      if (progress >= 1) {
        // 到点先结算一次，之后每隔 HOLD_REPEAT_MS 再结算（一直按住就一直掉/回血）
        if (!current.stepped) {
          current.stepped = true;
          current.lastStepAt = performance.now();
          onLifeChange(player.seat, current.side === 'right' ? HOLD_STEP : -HOLD_STEP);
          buzz(25);
        } else if (performance.now() - current.lastStepAt >= HOLD_REPEAT_MS) {
          current.lastStepAt = performance.now();
          onLifeChange(player.seat, current.side === 'right' ? HOLD_STEP : -HOLD_STEP);
          buzz(12);
        }
      }
      setSideHold({ side: current.side, progress });
      current.raf = requestAnimationFrame(tick);
    };
    hold.raf = requestAnimationFrame(tick);
  }, [cancelSide, editingName, onLifeChange, player.seat, rotation]);

  /* ── 中央正方形：独立触感区，按住 2 秒 → 任意数值弹窗；单击不做任何事 ── */

  const cancelCenter = useCallback(() => {
    const hold = centerRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    centerRef.current = null;
    setCenterHold(null);
  }, []);

  const finishCenter = useCallback(() => {
    const hold = centerRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    centerRef.current = null;
    setCenterHold(null);
    // 单击中央什么都不做（避免误触改血）；只有按满 2 秒才弹窗
  }, []);

  const startCenter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (editingName) return;
    event.preventDefault();
    event.stopPropagation();
    if (centerRef.current) cancelCenter();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* 部分旧浏览器不支持捕获 */ }
    const hold = {
      pointerId: event.pointerId,
      startedAt: performance.now(),
      startX: event.clientX,
      startY: event.clientY,
      fired: false,
      raf: 0,
    };
    centerRef.current = hold;
    setCenterHold(0);
    const tick = () => {
      const current = centerRef.current;
      if (!current || current !== hold) return;
      const progress = Math.min(1, (performance.now() - current.startedAt) / CENTER_HOLD_MS);
      if (progress >= 1) {
        current.fired = true;
        buzz(40);
        centerRef.current = null;
        setCenterHold(null);
        onOpenAmountMenu(player.seat);
        return;
      }
      setCenterHold(progress);
      current.raf = requestAnimationFrame(tick);
    };
    hold.raf = requestAnimationFrame(tick);
  }, [cancelCenter, editingName, onOpenAmountMenu, player.seat]);

  useEffect(() => () => {
    if (sideRef.current?.raf) cancelAnimationFrame(sideRef.current.raf);
    if (centerRef.current?.raf) cancelAnimationFrame(centerRef.current.raf);
  }, []);

  /* ── 颜色派生 ── */

  const textColor = readableTextColor(player.color);
  const borderColor = lighten(player.color, 0.45);
  const deepColor = darken(player.color, 0.55);
  const dimmed = player.eliminated;
  const holding = centerHold !== null;
  const recordedCount = COUNTERS.filter((meta) => player[meta.key] > 0).length;
  const lethalCounter = COUNTERS.some((meta) => meta.lethalAt !== null && player[meta.key] >= meta.lethalAt);

  const blockStyle: React.CSSProperties = {
    background: dimmed
      ? 'linear-gradient(160deg, #4a4a4a 0%, #2b2b2b 100%)'
      : `linear-gradient(160deg, ${lighten(player.color, 0.12)} 0%, ${player.color} 38%, ${deepColor} 100%)`,
    borderColor: dimmed ? '#555' : borderColor,
    color: dimmed ? '#9a9a9a' : textColor,
    transform: rotation === 180 ? 'rotate(180deg)' : undefined,
    filter: dimmed ? 'grayscale(1)' : undefined,
  };

  return (
    <section className="edh-seat" style={blockStyle} data-seat={player.seat} data-eliminated={dimmed ? 'true' : 'false'}>
      <div
        className="edh-half-catcher"
        onPointerDown={(e) => startSide(e.clientX, e.clientY, e)}
        onPointerUp={finishSide}
        onPointerCancel={cancelSide}
        onPointerMove={(e) => {
          const hold = sideRef.current;
          if (hold && hold.pointerId === e.pointerId && movedAway(e.clientX, e.clientY, hold.startX, hold.startY)) cancelSide();
        }}
        onLostPointerCapture={cancelSide}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* 按住方向时的进度线：扫满就进入持续 ±5 */}
        {sideHold && (
          <span
            className={`edh-side-progress edh-side-progress-${sideHold.side}${sideHold.progress >= 1 ? ' is-full' : ''}`}
            style={{ transform: `scaleX(${sideHold.progress})` }}
          />
        )}
      </div>

      <div className="edh-seat-inner">
        <div className="edh-life-center">
          {editingName ? (
            <input
              className="edh-name-input"
              value={nameDraft}
              autoFocus
              maxLength={16}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { setEditingName(false); onRename(player.seat, nameDraft.trim() || `玩家 ${player.seat + 1}`); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setEditingName(false); onRename(player.seat, nameDraft.trim() || `玩家 ${player.seat + 1}`); }
                if (e.key === 'Escape') { setEditingName(false); setNameDraft(player.name); }
              }}
            />
          ) : (
            <button
              type="button"
              className="edh-seat-name"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => { setNameDraft(player.name); setEditingName(true); }}
              title="点击改名"
            >{player.name}</button>
          )}
          {/* 中央正方形：独立的隐形触感区，按住 2 秒弹"任意数值"；单击不做任何事。
              它只居中占一块，所以左右的 ±1 依然占满剩余宽度。 */}
          <div
            className={`edh-center-hold${holding ? ' is-holding' : ''}`}
            data-hold-progress={centerHold === null ? '' : centerHold.toFixed(2)}
            onPointerDown={startCenter}
            onPointerUp={finishCenter}
            onPointerCancel={cancelCenter}
            onPointerMove={(e) => {
              const hold = centerRef.current;
              if (hold && hold.pointerId === e.pointerId && movedAway(e.clientX, e.clientY, hold.startX, hold.startY)) cancelCenter();
            }}
            onLostPointerCapture={cancelCenter}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className={`edh-life-value${holding ? ' is-trembling' : ''}`}>{player.life}</span>
          </div>
        </div>

        <button
          type="button"
          className={`edh-counter-menu${lethalCounter ? ' is-lethal' : ''}`}
          data-counter-menu
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenCounters(player.seat);
          }}
          title="打开记录面板"
        >
          <img src="/icons/edh-life/counter-menu.svg" alt="" aria-hidden="true" />
          <span>记录</span>
          {recordedCount > 0 && <b>{recordedCount}</b>}
        </button>
      </div>

      {dimmed && (
        <div className="edh-eliminated" aria-label="已出局">
          <span className="edh-skull">☠</span>
          {player.eliminatedReason && <span className="edh-eliminated-reason">{player.eliminatedReason}</span>}
        </div>
      )}
    </section>
  );
}
