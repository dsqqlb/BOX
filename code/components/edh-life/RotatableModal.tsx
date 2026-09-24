'use client';

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

interface RotatableModalProps {
  label: string;
  children: ReactNode;
  panelClassName?: string;
  width?: number;
  initialRotation?: number;
  /**
   * 记住这个弹窗上次退出时的方向：同一个 key 的弹窗下次打开会恢复上次转到的角度。
   * 不传则每次都按 initialRotation 打开。
   */
  persistKey?: string;
  layer?: 'base' | 'archive' | 'confirm';
  role?: 'dialog' | 'alertdialog';
  /** 内容多的弹窗（如设置页）按真实尺寸渲染，超出部分交给面板内部滚动。 */
  scrollable?: boolean;
  onBackdrop?: () => void;
}

/** 手机 / 矮屏阈值：命中后弹窗不再整体等比缩放，改成占满宽度 + 面板内滚动。 */
const COMPACT_MEDIA_QUERY = '(max-width: 720px), (max-height: 620px)';
/** 与 .edh-rotatable-card 的 transform transition 时长保持一致。 */
const ROTATION_MS = 300;
/** 方向记忆的 localStorage 前缀。 */
const ROTATION_STORAGE_PREFIX = 'edh-life-modal-rotation:';

function normalizeRotation(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
}

function readStoredRotation(key: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ROTATION_STORAGE_PREFIX + key);
    const parsed = raw === null ? NaN : Number(raw);
    return Number.isFinite(parsed) ? normalizeRotation(parsed) : null;
  } catch { return null; }
}

function writeStoredRotation(key: string, value: number): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(ROTATION_STORAGE_PREFIX + key, String(normalizeRotation(value))); } catch { /* 忽略 */ }
}

/**
 * 所有对话框共用的一层外壳：单屏限高、按比例缩放、可连续旋转 90°。
 * 弹窗通过 portal 挂到 body，避免被座位色块的 transform / overflow 裁切，
 * 也让存档、删除确认可以用独立 z-index 明确分层。
 */
export default function RotatableModal({
  label,
  children,
  panelClassName = 'edh-panel',
  width = 420,
  initialRotation = 0,
  persistKey,
  layer = 'base',
  role = 'dialog',
  scrollable = false,
  onBackdrop,
}: RotatableModalProps) {
  // 角度只累加，不在 360° 归零；归零那一帧会让卡片正过来后又抽一下。
  // 有 persistKey 时优先用上次退出时的方向，找不到才退回 initialRotation（通常是座位朝向）。
  const storedRotationRef = useRef<number | null | undefined>(undefined);
  if (storedRotationRef.current === undefined) {
    storedRotationRef.current = persistKey ? readStoredRotation(persistKey) : null;
  }
  const [rotation, setRotation] = useState(() => normalizeRotation(storedRotationRef.current ?? initialRotation));
  const [scale, setScale] = useState(1);
  const [rotating, setRotating] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const [mounted, setMounted] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lastFitRef = useRef({ width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 });
  const rotateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    // 已经从本机读到过方向的弹窗不再跟随 initialRotation，否则座位默认朝向会覆盖用户自己的选择。
    if (storedRotationRef.current !== null && storedRotationRef.current !== undefined) return;
    setRotation(normalizeRotation(initialRotation));
  }, [initialRotation]);

  /* 小屏判定：宽度窄或高度矮都算。手机上宁可让用户滚一下，也不要把字缩到看不清。 */
  useEffect(() => {
    const query = window.matchMedia(COMPACT_MEDIA_QUERY);
    const sync = () => setIsCompact(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => () => {
    if (rotateTimerRef.current !== null) clearTimeout(rotateTimerRef.current);
  }, []);

  /*
   * 取四个方向都能放下的统一缩放值，旋转时不再重新计算。
   * 这样 180° 翻转前后共用同一个 scale，弹窗不会在转向完成时抽动。
   *
   * 设置页按真实尺寸渲染并内部滚动；其余弹窗（包括手机）都按视口缩放，
   * 保证一屏显示。旋转动画进行中跳过重算，避免收尾那一帧再缩一次。
   */
  useLayoutEffect(() => {
    if (!mounted) return;
    if (scrollable) {
      setScale((current) => (current === 1 ? current : 1));
      lastFitRef.current = { width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 };
      return;
    }
    if (rotating) {
      return;
    }
    const surface = surfaceRef.current;
    if (!surface) return;

    let frame = 0;
    const fit = () => {
      const naturalWidth = Math.max(1, surface.offsetWidth);
      const naturalHeight = Math.max(1, surface.scrollHeight, surface.offsetHeight);
      const viewportWidth = Math.max(1, window.innerWidth - (isCompact ? 16 : 32));
      const viewportHeight = Math.max(1, window.innerHeight - (isCompact ? 12 : 32));
      const previous = lastFitRef.current;
      if (
        Math.abs(previous.width - naturalWidth) < 2
        && Math.abs(previous.height - naturalHeight) < 2
        && Math.abs(previous.viewportWidth - viewportWidth) < 2
        && Math.abs(previous.viewportHeight - viewportHeight) < 2
      ) return;
      // 本组件只做 180° 翻转，旋转前后宽高包围盒完全一致。
      const next = Math.min(
        1,
        viewportWidth / naturalWidth,
        viewportHeight / naturalHeight,
      );
      const safeScale = Number.isFinite(next) ? Math.max(0.2, next) : 1;
      lastFitRef.current = {
        width: naturalWidth,
        height: naturalHeight,
        viewportWidth,
        viewportHeight,
      };
      setScale((current) => (Math.abs(current - safeScale) < 0.008 ? current : safeScale));
      return safeScale;
    };

    const scheduleFit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };

    scheduleFit();
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(surface);
    window.addEventListener('resize', scheduleFit);
    window.addEventListener('orientationchange', scheduleFit);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleFit);
      window.removeEventListener('orientationchange', scheduleFit);
    };
  }, [mounted, scrollable, isCompact, rotating]);

  const rotateByHalfTurn = () => {
    setRotating(true);
    setRotation((current) => {
      const next = current + 180;
      if (persistKey) writeStoredRotation(persistKey, next);
      return next;
    });
    if (rotateTimerRef.current !== null) clearTimeout(rotateTimerRef.current);
    // 兜底：transitionend 在极端情况下可能不到（例如标签页被挂起），
    // 那样会永远不再拟合尺寸，所以这里再补一个定时器。
    rotateTimerRef.current = setTimeout(() => {
      rotateTimerRef.current = null;
      setRotating(false);
    }, ROTATION_MS + 60);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={`edh-modal-backdrop edh-modal-layer-${layer}${scrollable ? ' is-scrollable' : ''}${isCompact ? ' is-compact' : ''}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onBackdrop?.();
      }}
    >
      <div
        className="edh-rotatable-stage"
        style={{ '--edh-modal-width': `${width}px` } as CSSProperties}
      >
        <div
          className="edh-rotatable-card"
          /*
           * 只用 transform 一个属性做旋转：不混用 rotate/translateZ 两套合成路径，
           * 动画全程和中止后都停留在同一个 GPU 图层上，收尾时不会重新栅格化抽一下。
           */
          style={{ transform: `translate3d(0, 0, 0) rotate(${rotation}deg)` } as CSSProperties}
          data-rotation={normalizeRotation(rotation)}
          data-rotating={rotating ? 'true' : undefined}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.propertyName !== 'transform') return;
            if (rotateTimerRef.current !== null) {
              clearTimeout(rotateTimerRef.current);
              rotateTimerRef.current = null;
            }
            setRotating(false);
          }}
        >
          <div
            className="edh-rotatable-scaler"
            style={{ transform: `scale(${scale})` }}
          >
            <div
              ref={surfaceRef}
              className={`edh-rotatable-surface ${panelClassName}`}
              role={role}
              aria-modal="true"
              aria-label={label}
              data-layer={layer}
            >
              {children}
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="edh-modal-rotate"
        data-modal-rotate
        aria-label={`将${label}旋转 180 度`}
        title="旋转 180 度"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          rotateByHalfTurn();
        }}
      >
        <img src="/icons/edh-life/rotate.svg" alt="" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
