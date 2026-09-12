'use client';

/**
 * EDH 记血器 —— 「掉血 / 回血任意数值」弹窗（自绘数字键盘，不用系统键盘）。
 *
 * 掉血与回血合并在这一个弹窗里，用上方两个按钮切换方向；
 * 数字键直接输入，显示屏会实时预告结算结果。
 */

import { useCallback, useEffect, useState } from 'react';

const MAX_DIGITS = 4;

export interface AmountPadRequest {
  title: string;
  /** 打开时的默认方向 */
  mode: 'add' | 'sub';
  /** 当前血量，用于实时预告 */
  currentLife: number;
  maxHp?: number | null;
  onConfirm: (mode: 'add' | 'sub', value: number) => void;
}

interface AmountPadProps {
  request: AmountPadRequest | null;
  onClose: () => void;
}

export default function AmountPad({ request, onClose }: AmountPadProps) {
  const [mode, setMode] = useState<'add' | 'sub'>('sub');
  const [entry, setEntry] = useState('');

  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    setEntry('');
  }, [request]);

  const amount = entry === '' ? 0 : parseInt(entry, 10);

  const input = useCallback((key: string) => {
    setEntry((current) => {
      if (key === 'back') return current.slice(0, -1);
      if (key === 'clear') return '';
      if (!/^[0-9]$/.test(key)) return current;
      if (current === '' && key === '0') return current;      // 不产生前导零
      if (current.length >= MAX_DIGITS) return current;
      return current + key;
    });
  }, []);

  const confirm = useCallback(() => {
    if (!request) return;
    const value = entry === '' ? 0 : parseInt(entry, 10);
    if (value <= 0) return;
    request.onConfirm(mode, value);
    onClose();
  }, [entry, mode, onClose, request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) { input(e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { input('back'); e.preventDefault(); }
      else if (e.key === 'Delete') { input('clear'); e.preventDefault(); }
      else if (e.key === 'Enter') { confirm(); e.preventDefault(); }
      else if (e.key === 'Escape') { onClose(); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirm, input, onClose, request]);

  if (!request) return null;

  const life = request.currentLife;
  const preview = amount <= 0 ? '输入数值后显示结果' : mode === 'sub'
    ? `${life} → ${Math.max(0, life - amount)}`
    : `${life} → ${life + amount}`;

  return (
    <div className="edh-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edh-panel" role="dialog" aria-label={request.title}>
        <div className="edh-panel-head">
          <span>{request.title}</span>
          <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
        </div>

        <div className="edh-mode-switch">
          <button
            type="button"
            data-mode="sub"
            className={`edh-mode-btn${mode === 'sub' ? ' is-active' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); setMode('sub'); }}
          >掉血</button>
          <button
            type="button"
            data-mode="add"
            className={`edh-mode-btn${mode === 'add' ? ' is-active' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); setMode('add'); }}
          >回血</button>
        </div>

        <div className="edh-display">
          <span className="edh-display-amount" data-amount>
            {amount <= 0 ? '0' : `${mode === 'sub' ? '－' : '＋'}${amount}`}
          </span>
          <span className={`edh-display-hint${amount > 0 ? (mode === 'sub' ? ' is-sub' : ' is-add') : ''}`} data-preview>{preview}</span>
        </div>

        <div className="edh-numpad-pad">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((digit) => (
            <button key={digit} type="button" className="edh-numpad-key" data-key={digit} onPointerDown={(e) => { e.preventDefault(); input(digit); }}>{digit}</button>
          ))}
          <button type="button" className="edh-numpad-key" data-key="back" onPointerDown={(e) => { e.preventDefault(); input('back'); }} aria-label="退格">⌫</button>
          <button type="button" className="edh-numpad-key" data-key="0" onPointerDown={(e) => { e.preventDefault(); input('0'); }}>0</button>
          <button type="button" className="edh-numpad-key" data-key="clear" onPointerDown={(e) => { e.preventDefault(); input('clear'); }} aria-label="清零">C</button>
        </div>

        <div className="edh-numpad-actions">
          <button type="button" className="edh-numpad-action" onPointerDown={(e) => { e.preventDefault(); onClose(); }}>取消</button>
          <button
            type="button"
            className="edh-numpad-action is-primary"
            data-confirm
            disabled={amount <= 0}
            onPointerDown={(e) => { e.preventDefault(); confirm(); }}
          >确认</button>
        </div>
      </div>
    </div>
  );
}
