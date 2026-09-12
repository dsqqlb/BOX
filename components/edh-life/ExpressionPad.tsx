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
import { parseDiceExpression } from '@/lib/diceExpression';

const MAX_LENGTH = 40;

/** 键盘布局：4 列，按"数字靠左、操作符靠右"排。 */
const KEYS: string[][] = [
  ['7', '8', '9', 'd'],
  ['4', '5', '6', '+'],
  ['1', '2', '3', '-'],
  ['(', ')', 'kl', 'kh'],
];

interface ExpressionPadProps {
  title?: string;
  initialValue?: string;
  onConfirm: (expression: string) => void;
  onClose: () => void;
}

export default function ExpressionPad({ title = '输入骰式', initialValue = '', onConfirm, onClose }: ExpressionPadProps) {
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
      return current + key;
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
    <div className="edh-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edh-panel" role="dialog" aria-label={title}>
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
          {KEYS.flat().map((key) => (
            <button
              key={key}
              type="button"
              className="edh-numpad-key"
              data-key={key}
              onPointerDown={(e) => { e.preventDefault(); input(key); }}
            >{key}</button>
          ))}
          <button type="button" className="edh-numpad-key" data-key="back" onPointerDown={(e) => { e.preventDefault(); input('back'); }} aria-label="退格">⌫</button>
          <button type="button" className="edh-numpad-key" data-key="0" onPointerDown={(e) => { e.preventDefault(); input('0'); }}>0</button>
          <button type="button" className="edh-numpad-key" data-key="clear" onPointerDown={(e) => { e.preventDefault(); input('clear'); }} aria-label="清空">C</button>
          <button type="button" className="edh-numpad-key" data-key="space" onPointerDown={(e) => { e.preventDefault(); input(' '); }} aria-label="空格">␣</button>
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
      </div>
    </div>
  );
}
