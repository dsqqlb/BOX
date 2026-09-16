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
 *   - **色块左半**：单击 −1；**按住 1.5 秒**开始 −5，**继续按住则每 0.55 秒再 −5**
 *   - **色块右半**：单击 +1；按住同理持续 +5
 *   - **中央隐形正方形**（就是大数字所在的位置，没有任何描边）：
 *     按住 3 秒弹出「掉血 / 回血任意数值」弹窗，按住期间数字颤抖
 *   - 计数器：点 +1，按住 0.6 秒 −1，双击输入任意数值
 *   - 血量 ≤ 0 或中毒满 10 → 整块变灰 + 骷髅头
 *
 * 左右两半是按色块的**局部坐标**分的，而色块本身已经按座位旋转，
 * 所以坐在对面的人点他自己视角的左边，就是左边——不需要额外镜像。
 *
 * 所有指针交互都 preventDefault，避免移动端长按弹菜单、选中文字或触发滚动。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  COUNTERS, COUNTER_BY_KEY,
  darken, lighten, readableTextColor,
  type CounterKey, type PlayerState,
} from '@/lib/edh-life/types';

const HOLD_MS = 1500;          // 按住多久开始 ±5
const HOLD_REPEAT_MS = 550;    // 开始之后每隔多久再 ±5（持续按住就持续掉/回血）
const HOLD_STEP = 5;
const CENTER_HOLD_MS = 3000;   // 中央隐形方块按住多久弹出任意数值弹窗
const COUNTER_HOLD_MS = 600;   // 计数器按住多久算 -1
const MOVE_TOLERANCE_PX = 28;  // 指针移动超过这个距离就取消长按

type Side = 'left' | 'right';

interface SeatBlockProps {
  player: PlayerState;
  rotation: 0 | 180;
  onLifeChange: (seat: number, delta: number) => void;
  /** 中央方块按住 3 秒 → 打开「掉血 / 回血任意数值」弹窗 */
  onOpenAmountMenu: (seat: number) => void;
  onCounterChange: (seat: number, key: CounterKey, delta: number) => void;
  onOpenCounterInput: (seat: number, key: CounterKey) => void;
  onRename: (seat: number, name: string) => void;
}

export default function SeatBlock({
  player, rotation,
  onLifeChange, onOpenAmountMenu, onCounterChange, onOpenCounterInput, onRename,
}: SeatBlockProps) {
  const [sideHold, setSideHold] = useState<{ side: Side; progress: number } | null>(null);
  const [centerHold, setCenterHold] = useState<number | null>(null);
  const [counterHold, setCounterHold] = useState<{ key: CounterKey; progress: number } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(player.name);

  const sideRef = useRef<{
    side: Side;
    startedAt: number;
    lastStepAt: number;
    startX: number;
    startY: number;
    stepped: boolean;   // 是否已经开始走"按住 ±5"
    raf: number;
  } | null>(null);
  const centerRef = useRef<{ startedAt: number; startX: number; startY: number; fired: boolean; raf: number } | null>(null);
  const counterRef = useRef<{ key: CounterKey; startedAt: number; startX: number; startY: number; fired: boolean; raf: number } | null>(null);

  const movedAway = (x: number, y: number, startX: number, startY: number) =>
    Math.abs(x - startX) > MOVE_TOLERANCE_PX || Math.abs(y - startY) > MOVE_TOLERANCE_PX;

  const buzz = (ms: number) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(ms); } catch { /* 忽略 */ }
    }
  };

  /* ── 左右两半：单击 ±1；按住 1.5 秒后每 0.55 秒 ±5 ── */

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

  /**
   * 把一个屏幕坐标换算到某个元素的**本地未旋转坐标**。
   * 色块会按座位整体 rotate(180deg)，屏幕坐标直接比较会把左右判反，
   * 所以统一定位到元素自己的坐标系里再判断。
   * 注意用 offsetWidth/offsetHeight（布局尺寸，不含 transform）作为本地尺寸。
   */
  const toLocalPoint = (element: HTMLElement, clientX: number, clientY: number): { x: number; y: number; width: number; height: number } => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    let axisX = 1;
    let axisY = 0;
    try {
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      const a = matrix.a;
      const b = matrix.b;
      const length = Math.hypot(a, b);
      if (length > 0.0001) {
        axisX = a / length;
        axisY = b / length;
      }
    } catch { /* 拿不到就用默认轴（未旋转） */ }
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    return {
      x: rect.width / 2 + (dx * axisX + dy * axisY),
      y: rect.height / 2 + (-dx * axisY + dy * axisX),
      width: element.offsetWidth || rect.width,
      height: element.offsetHeight || rect.height,
    };
  };

  const startSide = useCallback((sideHint: Side, clientX: number, clientY: number, event: React.PointerEvent<HTMLDivElement>) => {
    if (editingName) return;
    event.preventDefault();
    if (sideRef.current) cancelSide();

    const catcher = event.currentTarget;

    // 左右用**色块自己的坐标系**判定：色块已按座位旋转，玩家点他视角的左边就是左边；
    // 直接用屏幕坐标比较的话，旋转 180° 的那两排会把左右判反。
    let side: Side = sideHint;
    try {
      const local = toLocalPoint(catcher, clientX, clientY);
      side = local.x < local.width / 2 ? 'left' : 'right';
    } catch { /* 兜底用 sideHint */ }

    const hold = { side, startedAt: performance.now(), lastStepAt: 0, startX: clientX, startY: clientY, stepped: false, raf: 0 };
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
  }, [cancelSide, editingName, onLifeChange, onOpenAmountMenu, player.seat]);

  /* ── 中央正方形：独立触感区，按住 3 秒 → 任意数值弹窗；单击不做任何事 ── */

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
    // 单击中央什么都不做（避免误触改血）；只有按满 3 秒才弹窗
  }, []);

  const startCenter = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (editingName) return;
    event.preventDefault();
    event.stopPropagation();
    if (centerRef.current) cancelCenter();
    const hold = { startedAt: performance.now(), startX: event.clientX, startY: event.clientY, fired: false, raf: 0 };
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

  /* ── 计数器：点 +1，按住 -1，双击输入任意值 ── */

  const cancelCounter = useCallback(() => {
    const hold = counterRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    counterRef.current = null;
    setCounterHold(null);
  }, []);

  const finishCounter = useCallback(() => {
    const hold = counterRef.current;
    if (!hold) return;
    if (hold.raf) cancelAnimationFrame(hold.raf);
    if (!hold.fired) onCounterChange(player.seat, hold.key, 1);
    counterRef.current = null;
    setCounterHold(null);
  }, [onCounterChange, player.seat]);

  const startCounter = useCallback((key: CounterKey, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (counterRef.current) cancelCounter();
    const hold = { key, startedAt: performance.now(), startX: event.clientX, startY: event.clientY, fired: false, raf: 0 };
    counterRef.current = hold;
    setCounterHold({ key, progress: 0 });
    const tick = () => {
      const current = counterRef.current;
      if (!current || current !== hold) return;
      const progress = Math.min(1, (performance.now() - current.startedAt) / COUNTER_HOLD_MS);
      if (progress >= 1) {
        current.fired = true;
        onCounterChange(player.seat, current.key, -1);
        counterRef.current = null;
        setCounterHold(null);
        return;
      }
      setCounterHold({ key: current.key, progress });
      current.raf = requestAnimationFrame(tick);
    };
    hold.raf = requestAnimationFrame(tick);
  }, [cancelCounter, onCounterChange, player.seat]);

  useEffect(() => () => {
    if (sideRef.current?.raf) cancelAnimationFrame(sideRef.current.raf);
    if (centerRef.current?.raf) cancelAnimationFrame(centerRef.current.raf);
    if (counterRef.current?.raf) cancelAnimationFrame(counterRef.current.raf);
  }, []);

  /* ── 颜色派生 ── */

  const textColor = readableTextColor(player.color);
  const borderColor = lighten(player.color, 0.45);
  const deepColor = darken(player.color, 0.55);
  const dimmed = player.eliminated;
  const holding = centerHold !== null;

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
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // 用色块自身的局部坐标判定左右，而色块已按座位旋转过，
          // 所以对面的人点他视角的左边就是左边（不需要额外镜像）。
          startSide(e.clientX - rect.left < rect.width / 2 ? 'left' : 'right', e.clientX, e.clientY, e);
        }}
        onPointerUp={finishSide}
        onPointerCancel={cancelSide}
        onPointerLeave={cancelSide}
        onPointerMove={(e) => {
          const hold = sideRef.current;
          if (hold && movedAway(e.clientX, e.clientY, hold.startX, hold.startY)) cancelSide();
        }}
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
          {/* 中央正方形：独立的隐形触感区，按住 3 秒弹"任意数值"；单击不做任何事。
              它只居中占一块，所以左右的 ±1 依然占满剩余宽度。 */}
          <div
            className={`edh-center-hold${holding ? ' is-holding' : ''}`}
            data-hold-progress={centerHold === null ? '' : centerHold.toFixed(2)}
            onPointerDown={startCenter}
            onPointerUp={finishCenter}
            onPointerCancel={cancelCenter}
            onPointerLeave={cancelCenter}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className={`edh-life-value${holding ? ' is-trembling' : ''}`}>{player.life}</span>
          </div>
        </div>

        <div className="edh-counter-row">
          {COUNTERS.map((meta) => {
            const value = player[meta.key];
            const lethal = meta.lethalAt !== null && value >= meta.lethalAt;
            const active = counterHold?.key === meta.key;
            return (
              <button
                key={meta.key}
                type="button"
                data-counter={meta.key}
                className={`edh-counter${lethal ? ' is-lethal' : ''}${active ? ' is-holding' : ''}`}
                onPointerDown={(e) => startCounter(meta.key, e)}
                onPointerUp={finishCounter}
                onPointerCancel={cancelCounter}
                onPointerLeave={cancelCounter}
                onPointerMove={(e) => {
                  const hold = counterRef.current;
                  if (hold && hold.key === meta.key && movedAway(e.clientX, e.clientY, hold.startX, hold.startY)) cancelCounter();
                }}
                onDoubleClick={() => onOpenCounterInput(player.seat, meta.key)}
                onContextMenu={(e) => { e.preventDefault(); onOpenCounterInput(player.seat, meta.key); }}
                title={`${meta.label}：点击 +1，按住 -1，双击输入任意数值`}
              >
                <span className="edh-counter-icon">{meta.icon}</span>
                <span className="edh-counter-value">{value}</span>
                {active && <span className="edh-counter-progress" style={{ transform: `scaleX(${counterHold?.progress ?? 0})` }} />}
                {lethal && <span className="edh-counter-lethal">☠</span>}
              </button>
            );
          })}
        </div>
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
