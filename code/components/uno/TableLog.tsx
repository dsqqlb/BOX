'use client';

/** 牌桌右栏日志：有对局时显示对局日志，否则显示房间日志（超时托管、掉线、入座这些都在房间日志里）。 */

import type { UnoRoomView } from '@/lib/uno/types';

export default function TableLog({ room }: { room: UnoRoomView }) {
  const game = room.game;
  const entries = game ? game.log.slice(-10) : room.log.slice(0, 8);

  return (
    <aside className="rounded-3xl border border-white/[.1] bg-white/[.03] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[.18em] text-slate-400">{game ? '对局日志' : '房间日志'}</h3>
      <ul className="mt-3 space-y-1.5 text-xs leading-5 text-slate-300">
        {entries.slice().reverse().map((entry, index) => (
          <li key={`${index}-${entry.text}`} className="rounded-lg bg-black/25 px-2.5 py-1.5">{entry.text}</li>
        ))}
        {!entries.length && <li className="text-slate-500">还没有记录</li>}
      </ul>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        别人剩最后一张牌没喊 UNO 时，他的座位旁会出现「举报」按钮。
      </p>
    </aside>
  );
}