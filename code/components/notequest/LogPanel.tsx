'use client';

/**
 * 探险日志：引擎每做一步都会往 state.log 里追加，这里倒序显示（最新的在最上面）。
 * 掷骰明细单独用 kind='roll'/'table' 区分颜色，方便回头核对"哪一步掷了什么"。
 */

import { useEffect, useRef } from 'react';
import type { LogEntry } from '@/lib/notequest/types';

const KIND_CLASS: Record<string, string> = {
  roll: 'nq-log-roll',
  table: 'nq-log-table',
  combat: 'nq-log-combat',
  loot: 'nq-log-loot',
  town: 'nq-log-town',
  death: 'nq-log-death',
  warn: 'nq-log-warn',
  info: 'nq-log-info',
};

function clock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

export default function LogPanel({ log }: { log: LogEntry[] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 新日志进来时把滚动条拉回顶部（列表是倒序的）
    if (boxRef.current) boxRef.current.scrollTop = 0;
  }, [log.length]);

  return (
    <div className="nq-panel nq-log">
      <header className="nq-panel-head">
        <div>
          <p className="nq-panel-title">探险日志</p>
          <p className="nq-panel-sub">最近 {log.length} 条</p>
        </div>
      </header>
      <div className="nq-log-list" ref={boxRef}>
        {log.length === 0 && <p className="nq-muted">还没有记录。先开一扇门试试。</p>}
        {[...log].reverse().map((entry) => (
          <p key={entry.id} className={`nq-log-line ${KIND_CLASS[entry.kind] ?? 'nq-log-info'}`}>
            <span className="nq-log-time">{clock(entry.at)}</span>
            {entry.text}
          </p>
        ))}
      </div>
    </div>
  );
}