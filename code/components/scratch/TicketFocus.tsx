'use client';

/**
 * 聚焦视图：点开桌上的一张票，把它放大成一张「真票」来刮。
 *
 * 关键手感（按需求定的）：**印刷层一直就在涂层下面**。
 * 格子里的数字/符号是买票起就随票下发的（`ticket.print`），涂层只是盖在上面的一层 canvas，
 * 所以刮到哪就露出哪、刮到的那一格会亮起来 —— 而不是刮完才一起翻出来。
 * 服务端只负责「结算」：刮开达标后确认中没中、多少钱（`ticket.outcome`），再由此决定能不能兑奖。
 *
 * 结构（永远是矩形，长宽比取自票种配置，与桌面上的小票一致）：
 *   票头（票名 / 票价）→ 玩法说明（含票面公布的符号）→ 游戏区（印刷格子 + 涂层）→ 票脚（进度或结算）→ 动作按钮。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ScratchCanvas from './ScratchCanvas';
import type { ScratchOutcome, ScratchTicket, ScratchTicketDefinition } from '@/lib/scratch/types';

interface TicketFocusProps {
  definition: ScratchTicketDefinition;
  ticket: ScratchTicket;
  /** 刮开层的笔刷宽度（含「刮刀」升级）。 */
  brushPercent: number;
  /** 自动刮机器速度（0 = 还没升级过）。 */
  autoPointsPerSecond: number;
  /** 兑奖加成（用于按钮上显示实际到账金额）。 */
  prizeBonus: number;
  /** 暴击概率（用于提示里说明还有暴击机会）。 */
  critChance: number;
  /** 这一张碎掉能拿多少纸屑（含碎纸机升级）。 */
  shredReward: number;
  /** 实际结算门槛（含「精准刮刀」升级）。 */
  threshold: number;
  /** 刮开达标 → 服务端结算；成功返回结算结果（没中奖也有值，只是 prize = 0）。 */
  onReveal: (ratio: number) => Promise<ScratchOutcome | null>;
  /** 送入兑奖机（中奖票）。 */
  onRedeem: () => Promise<void>;
  /** 送入碎纸机。 */
  onShred: () => Promise<void>;
  onClose: () => void;
}

/** 单格被刮开多少就算「露出内容」了（用来点亮那一格）。 */
const CELL_LIT_RATIO = 0.55;

export default function TicketFocus({
  definition, ticket, brushPercent, autoPointsPerSecond, prizeBonus, critChance, shredReward, threshold,
  onReveal, onRedeem, onShred, onClose,
}: TicketFocusProps) {
  const [progress, setProgress] = useState(ticket.scratchRatio || 0);
  const [outcome, setOutcome] = useState<ScratchOutcome | null>(ticket.outcome);
  const [cellRatios, setCellRatios] = useState<number[]>([]);
  const [revealing, setRevealing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmShred, setConfirmShred] = useState(false);
  /** 自动刮机器开关（升级过才显示）。 */
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ratioRef = useRef(ticket.scratchRatio || 0);

  const theme = definition.theme;
  const aspect = definition.shape.aspect > 0 ? definition.shape.aspect : 1.6;
  const grid = ticket.print?.grid || definition.grid;
  const cells = ticket.print?.cells || [];
  const legend = ticket.print?.legend ?? null;
  /** 兑奖实际到账金额（含「兑奖机」升级加成）。 */
  const payout = outcome ? Math.max(1, Math.round(outcome.prize * (1 + prizeBonus))) : 0;

  /** 刮开达标 → 让服务端结算。 */
  const handleRevealed = useCallback(async () => {
    if (revealing || outcome) return;
    setRevealing(true);
    setError(null);
    try {
      const next = await onReveal(Math.max(ratioRef.current, threshold));
      if (next) setOutcome(next);
      else setError('刮开了，但没能结算，再刮一下试试。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '结算失败，请稍后再试。');
    } finally {
      setRevealing(false);
    }
  }, [onReveal, outcome, revealing, threshold]);

  const runAction = useCallback(async (action: () => Promise<void>, label: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `${label}失败，请稍后再试。`);
      setBusy(false);
    }
  }, [busy, onClose]);

  // Esc 放回桌面
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="scr-focus"
      role="dialog"
      aria-modal="true"
      aria-label={`${definition.name}：刮奖`}
      onPointerDown={onClose}
    >
      <div
        className={`scr-focus-ticket${outcome ? ' is-revealed' : ''}`}
        style={{
          aspectRatio: `${aspect}`,
          width: `min(94vw, calc(68dvh * ${aspect}))`,
          background: theme.paper,
          borderColor: theme.edge,
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="scr-focus-head" style={{ background: theme.accent, color: theme.ink }}>
          <span className="scr-focus-name">{definition.name}</span>
          <span className="scr-focus-price">{definition.price} 币</span>
        </header>

        <p className="scr-focus-rules" style={{ color: theme.ink }}>
          {definition.rulesText}
          {legend && (
            <span className="scr-focus-legend">
              　票面公布：{legend.label} {legend.symbol}
            </span>
          )}
        </p>

        <div className="scr-focus-play" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}>
          {cells.map((cell, index) => {
            const lit = (cellRatios[index] || 0) >= CELL_LIT_RATIO;
            const prize = cell.tag === 'prize';
            return (
              <span
                key={`cell-${cell.id}-${index}`}
                className={`scr-focus-cell${lit ? ' is-scratched' : ''}${lit && prize ? ' is-hit' : ''}`}
                style={{
                  color: theme.ink,
                  borderColor: lit ? (prize ? theme.edge : 'rgba(0,0,0,0.2)') : 'rgba(0,0,0,0.14)',
                  background: lit && prize ? `${theme.accent}88` : 'rgba(255,255,255,0.4)',
                }}
              >
                {cell.label}
              </span>
            );
          })}

          {!outcome && (
            <ScratchCanvas
              className="scr-focus-coating"
              brushPercent={brushPercent}
              threshold={threshold}
              coatingColor={theme.foil}
              cellGrid={grid}
              autoPointsPerSecond={auto ? autoPointsPerSecond : 0}
              onCells={setCellRatios}
              onProgress={(ratio) => { ratioRef.current = ratio; setProgress(ratio); }}
              onRevealed={() => { void handleRevealed(); }}
            />
          )}
        </div>

        <footer className="scr-focus-foot">
          {outcome ? (
            <span
              className="scr-focus-outcome"
              style={outcome.won
                ? { background: theme.accent, color: theme.ink }
                : { background: 'rgba(0,0,0,0.12)', color: theme.ink }}
            >
              {outcome.headline}
            </span>
          ) : (
            <span className="scr-focus-progress" style={{ color: theme.ink }}>
              已刮 {Math.round(progress * 100)}% · 刮到 {Math.round(threshold * 100)}% 自动结算
            </span>
          )}
        </footer>
      </div>

      <div className="scr-focus-actions" onPointerDown={(event) => event.stopPropagation()}>
        {error && <span className="scr-focus-error">{error}</span>}
        {revealing && <span className="scr-focus-hint">结算中…</span>}

        {!outcome && !confirmShred && (
          <>
            <span className="scr-focus-hint">
              刮开涂层就能看到格子里的内容；刮到 {Math.round(threshold * 100)}% 自动结算。
            </span>
            {autoPointsPerSecond > 0 && (
              <button
                type="button"
                className={`scr-top-button${auto ? ' is-primary' : ''}`}
                onClick={() => setAuto((value) => !value)}
                disabled={busy}
              >
                {auto ? '关掉自动刮' : `开自动刮（约 ${Math.round(autoPointsPerSecond)} 点/秒）`}
              </button>
            )}
            <button type="button" className="scr-top-button" onClick={() => setConfirmShred(true)} disabled={busy}>
              碎掉这张票（{shredReward} 纸屑）
            </button>
          </>
        )}

        {!outcome && confirmShred && (
          <>
            <span className="scr-focus-error">这张还没刮开，碎掉就再也没有中奖机会了。</span>
            <button
              type="button"
              className="scr-top-button"
              disabled={busy}
              onClick={() => { void runAction(onShred, '碎纸'); }}
            >
              {busy ? '碎纸中…' : '确认碎掉'}
            </button>
            <button type="button" className="scr-top-button" onClick={() => setConfirmShred(false)} disabled={busy}>先刮一下</button>
          </>
        )}

        {outcome?.won && (
          <>
            <span className="scr-focus-hint">
              中奖了！兑奖机会把钱打到与德州扑克共用的那份余额里
              {prizeBonus > 0 ? `（兑奖机 +${Math.round(prizeBonus * 100)}%）` : ''}
              {critChance > 0 ? `，还有 ${Math.round(critChance * 100)}% 概率暴击翻倍` : ''}。
            </span>
            <button
              type="button"
              className="scr-top-button is-primary"
              disabled={busy}
              onClick={() => { void runAction(onRedeem, '兑奖'); }}
            >
              {busy ? '兑奖中…' : `送入兑奖机（+${payout} 币）`}
            </button>
          </>
        )}

        {outcome && !outcome.won && (
          <>
            <span className="scr-focus-hint">没中奖——碎掉换 {shredReward} 纸屑，攒着升级刮刀和机器。</span>
            <button
              type="button"
              className="scr-top-button is-primary"
              disabled={busy}
              onClick={() => { void runAction(onShred, '碎纸'); }}
            >
              {busy ? '碎纸中…' : `送入碎纸机（+${shredReward} 纸屑）`}
            </button>
          </>
        )}

        <button type="button" className="scr-top-button" onClick={onClose} disabled={busy}>放回桌面</button>
      </div>
    </div>
  );
}