'use client';

/**
 * EDH 记血器 —— 掷骰历史弹窗。
 *
 * 数据源就是当前对局状态里的 rolls：状态本身会按账户同步到 SQLite（防抖 PATCH），
 * 所以历史跟着状态走，不再单独往数据库写一份掷骰记录，也没有「存档」概念。
 */

import { useMemo } from 'react';
import RotatableModal from '@/components/edh-life/RotatableModal';
import { coinFaceFromRoll, coinLabel, formatClock, type GameState } from '@/lib/edh-life/types';

interface HistoryPanelProps {
  game: GameState;
  seat: number | null;
  initialRotation?: number;
  onClose: () => void;
}

export default function HistoryPanel({ game, seat, initialRotation = 0, onClose }: HistoryPanelProps) {
  const title = seat === null ? '掷骰历史' : `玩家 ${seat + 1} 的掷骰历史`;

  // 新的排在前面；指定座位时只显示这个座位的掷骰（以及不带座位的公共掷骰）。
  const rolls = useMemo(
    () => [...game.rolls].reverse().filter((roll) => seat === null || roll.seat === seat || roll.seat === null),
    [game.rolls, seat],
  );

  return (
    <RotatableModal
      label={title}
      panelClassName="edh-panel edh-history"
      width={760}
      initialRotation={initialRotation}
      persistKey={`history-${seat ?? 'all'}`}
      scrollable
      onBackdrop={onClose}
    >
        <div className="edh-history-head">
          <span className="edh-history-title">{title}</span>
          <span className="edh-history-source">共 {rolls.length} 次</span>
          <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
        </div>

        <div className="edh-history-list">
          {rolls.length === 0 && <div className="edh-history-empty">还没有掷过骰子</div>}
          {rolls.map((roll) => {
            // coinFace 是权威字段；旧数据没有它时从 values / total 反推。
            const coinFace = roll.source === 'coin' ? coinFaceFromRoll(roll) : undefined;
            return (
              <div key={roll.id} className="edh-history-row">
                <span className="edh-history-time">{formatClock(roll.at)}</span>
                <span className="edh-history-notation">{roll.source === 'coin' ? '硬币' : roll.notation}</span>
                <span className="edh-history-dice">
                  {roll.source === 'coin'
                    ? coinFace ? coinLabel(coinFace) : '—'
                    : roll.values.map((value, index) => <b key={index}>{value}</b>)}
                </span>
                <span className="edh-history-total">
                  {roll.source === 'coin' ? `= ${coinFace ? coinLabel(coinFace) : '—'}` : `= ${roll.total}`}
                </span>
                {roll.seat !== null && <span className="edh-history-seat">P{roll.seat + 1}</span>}
              </div>
            );
          })}
        </div>
    </RotatableModal>
  );
}