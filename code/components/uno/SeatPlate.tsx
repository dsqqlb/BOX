'use client';

/** 座位牌：头像（账户名首字）、昵称、牌背张数、状态标记、举报按钮。 */

import type { UnoCatalog, UnoPlayerView, UnoSeatView } from '@/lib/uno/types';
import { avatarColor, botLevelLabel, initialOf } from '@/lib/uno/catalog';
import UnoCard from './UnoCard';

export default function SeatPlate({
  seat,
  player,
  catalog,
  isTurn,
  isMe = false,
  onChallenge,
  compact = false,
}: {
  seat: UnoSeatView;
  player: UnoPlayerView | null;
  catalog: UnoCatalog | null;
  isTurn: boolean;
  isMe?: boolean;
  onChallenge?: (seat: number) => void;
  compact?: boolean;
}) {
  const name = seat.displayName || '空座位';
  const handCount = player?.handCount ?? 0;
  const miniBacks = Math.min(3, Math.max(0, handCount));

  return (
    <div
      className={`relative rounded-2xl border px-3 py-2.5 backdrop-blur transition ${
        isTurn ? 'border-amber-300/70 bg-amber-300/[.12] shadow-[0_0_28px_rgba(245,178,26,.25)]' : 'border-white/[.12] bg-black/35'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="relative inline-grid shrink-0 place-items-center">
          <span
            className="grid h-8 w-8 place-items-center rounded-full text-sm font-black text-slate-950 sm:h-11 sm:w-11 sm:text-lg"
            style={{ background: avatarColor(name) }}
          >
            {initialOf(name)}
          </span>
          {isTurn && <span className="absolute -inset-1 animate-ping rounded-full border-2 border-amber-300/60" />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate font-bold text-white ${compact ? 'text-xs' : 'text-sm'}`}>{name}</span>
            {isMe && <span className="shrink-0 rounded-full bg-amber-300/25 px-1.5 py-0.5 text-[9px] font-black text-amber-100">你</span>}
          </span>
          <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-400">
            {seat.isBot ? `机器人 · ${botLevelLabel(seat.botLevel)}` : seat.connected ? '在线' : '离线'}
            {seat.autoPiloted ? ' · 托管中' : ''}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          {miniBacks > 0 && (
            <span className="hidden -space-x-2 sm:flex">
              {Array.from({ length: miniBacks }, (_, index) => (
                <UnoCard key={index} width={compact ? 14 : 16} faceDown className="drop-shadow" />
              ))}
            </span>
          )}
          <span className={`rounded-lg bg-white/10 px-1.5 py-0.5 font-mono font-black text-white ${compact ? 'text-[11px]' : 'text-sm'}`}>{handCount}</span>
        </span>
      </div>

      {(seat.autoPiloted || player?.saidUno || player?.unoPending) && (
        <div className="mt-1.5 flex flex-wrap gap-1 whitespace-nowrap text-[10px] font-bold">
          {seat.autoPiloted && <span className="rounded-full bg-rose-400/20 px-1.5 py-0.5 text-rose-200">托管中</span>}
          {player?.saidUno && <span className="rounded-full bg-emerald-400/20 px-1.5 py-0.5 text-emerald-200">已喊 UNO</span>}
          {player?.unoPending && <span className="rounded-full bg-rose-500/25 px-1.5 py-0.5 text-rose-100">忘喊 UNO</span>}
        </div>
      )}

      {player?.unoPending && onChallenge && (
        <button
          type="button"
          onClick={() => onChallenge(seat.seat)}
          className="mt-2 w-full animate-pulse rounded-xl bg-rose-500 px-2 py-1.5 text-[11px] font-black text-white hover:bg-rose-400"
        >
          忘喊 UNO · 点我举报
        </button>
      )}
    </div>
  );
}