'use client';

import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface RotatableModalProps {
  label: string;
  children: ReactNode;
  panelClassName?: string;
  width?: number;
  initialRotation?: number;
  layer?: 'base' | 'archive' | 'confirm';
  role?: 'dialog' | 'alertdialog';
  onBackdrop?: () => void;
}

function normalizeRotation(value: number): number {
  return ((Math.round(value / 90) * 90) % 360 + 360) % 360;
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
  layer = 'base',
  role = 'dialog',
  onBackdrop,
}: RotatableModalProps) {
  const [rotation, setRotation] = useState(() => normalizeRotation(initialRotation));
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    setRotation(normalizeRotation(initialRotation));
  }, [initialRotation]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`edh-modal-backdrop edh-modal-layer-${layer}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onBackdrop?.();
      }}
    >
      <div
        className="edh-rotatable-stage"
        style={{ '--edh-modal-width': `${width}px` } as CSSProperties}
      >
        <div
          className={`edh-rotatable-card ${panelClassName}`}
          style={{ transform: `rotate(${rotation}deg)` }}
          role={role}
          aria-modal="true"
          aria-label={label}
          data-rotation={normalizeRotation(rotation)}
          data-layer={layer}
        >
          {children}
        </div>
      </div>
      <button
        type="button"
        className="edh-modal-rotate"
        data-modal-rotate
        aria-label={`将${label}旋转 90 度`}
        title="旋转 90 度"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setRotation((current) => current + 90);
        }}
      >
        <img src="/icons/edh-life/rotate.svg" alt="" aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
