'use client';

/**
 * EDH 记血器 —— 骰式输入键盘。
 *
 * 刻意**不使用系统键盘**（移动端弹系统键盘会顶起布局、遮住骰盘，而且长按是本工具的
 * 核心操作，系统的文本选择/候选栏会来抢事件）。所以这里用自绘键盘输入：
 * 数字、`d`、`+`、`-`、`(`、`)`、`k h`、`k l`、退格、清空。
 *
 * 输入过程中实时用 parseDiceExpression 校验，合法的表达式才允许确认。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import RotatableModal from '@/components/edh-life/RotatableModal';
import { parseDiceExpression } from '@/lib/diceExpression';

const MAX_LENGTH = 40;

/**
 * 键盘布局：固定 4 列 × 5 行。
 * 每一行都按固定顺序排好，避免退格、0、清空和空格挤到最后一行造成错位。
 */
const KEYS: string[][] = [
  ['7', '8', '9', 'back'],
  ['4', '5', '6', 'd'],
  ['1', '2', '3', 'kh'],
  ['0', '(', ')', 'kl'],
  ['+', '-', 'clear', 'space'],
];

/** 只有这两个键面上要画符号，实际输入值不一样。 */
const KEY_LABELS: Record<string, string> = {
  back: '⌫',
  clear: 'C',
  space: '␣',
};

const KEY_VALUES: Record<string, string> = {
  back: '\b',
  clear: '\u0000',
  space: ' ',
};

interface ExpressionPadProps {
  title?: string;
  initialValue?: string;
  initialRotation?: number;
  onConfirm: (expression: string) => void;
  onClose: () => void;
}

export default function ExpressionPad({
  title = '输入骰式',
  initialValue = '',
  initialRotation = 0,
  onConfirm,
  onClose,
}: ExpressionPadProps) {
  const [entry, setEntry] = useState(initialValue);

  useEffect(() => { setEntry(initialValue); }, [initialValue]);

  const validation = useMemo(() => {
    if (!entry.trim()) return { ok: false as const, message: '例如 2d6+3、1d20、2d20kh1' };
    const parsed = parseDiceExpression(entry);
    if (parsed.ok) return { ok: true as const, message: '表达式可用' };
    return { ok: false as const, message: parsed.error };
  }, [entry]);

  const input = useCallback((key: string) => {
    setEntry((current) => {
      if (key === 'back') return current.slice(0, -1);
      if (key === 'clear') return '';
      if (current.length >= MAX_LENGTH) return current;
      return current + (KEY_VALUES[key] ?? key);
    });
  }, []);

  const confirm = useCallback(() => {
    if (!validation.ok) return;
    onConfirm(entry.trim());
    onClose();
  }, [entry, onClose, onConfirm, validation.ok]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 物理键盘也支持，方便桌面调试；但输入本身不依赖它
      if (e.key === 'Escape') { onClose(); e.preventDefault(); }
      else if (e.key === 'Enter') { confirm(); e.preventDefault(); }
      else if (e.key === 'Backspace') { input('back'); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, input, onClose]);

  return (
    <RotatableModal
      label={title}
      panelClassName="edh-panel edh-expression-panel"
      width={390}
      initialRotation={initialRotation}
      onBackdrop={onClose}
    >
        <div className="edh-panel-head">
          <span>{title}</span>
          <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
        </div>

        <div className="edh-display">
          {/* 只读展示：真正的输入来自下面自绘的键盘 */}
          <span className="edh-display-amount" data-expression>{entry || '—'}</span>
          <span className={`edh-display-hint${validation.ok ? ' is-add' : ''}`} data-valid={validation.ok ? 'true' : 'false'}>
            {validation.message}
          </span>
        </div>

        <div className="edh-numpad-pad">
          {KEYS.flat().map((key) => {
            const label = KEY_LABELS[key] ?? key;
            const ariaLabel = key === 'back' ? '退格' : key === 'clear' ? '清空' : key === 'space' ? '空格' : undefined;
            return (
            <button
              key={key}
              type="button"
              className="edh-numpad-key"
              data-key={key}
              onPointerDown={(e) => { e.preventDefault(); input(key); }}
              aria-label={ariaLabel}
            >{label}</button>
            );
          })}
        </div>

        <div className="edh-numpad-actions">
          <button type="button" className="edh-numpad-action" onPointerDown={(e) => { e.preventDefault(); onClose(); }}>取消</button>
          <button
            type="button"
            className="edh-numpad-action is-primary"
            data-confirm
            disabled={!validation.ok}
            onPointerDown={(e) => { e.preventDefault(); confirm(); }}
          >确认投掷</button>
        </div>
    </RotatableModal>
  );
}
