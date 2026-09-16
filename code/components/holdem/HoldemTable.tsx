'use client';

/**
 * 经典绿呢牌桌：木质外框 + 呢面 + 椭圆分布的座位。
 * 牌桌填充由外层分配的可用高度，避免准备室和开赛画面出现整页滚动。
 */

import { useEffect, useState } from 'react';
import PlayingCard from './PlayingCard';
import PokerChip, { ChipStack, formatChips } from './PokerChip';
import type { HoldemRoomView, HoldemSeatView } from '@/lib/holdem';

const ACTION_LABEL: Record<string, string> = {
  fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全下',
};
const STREET_LABEL: Record<string, string> = {
  preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '摊牌',
};

/** 椭圆座位坐标：相对索引 0 固定在正下方（自己）。 */
function seatPosition(relativeIndex: number, total: number) {
  const angle = (Math.PI / 2) + (relativeIndex / total) * Math.PI * 2;
  return {
    left: `${50 + 39 * Math.cos(angle)}%`,
    top: `${50 + 35 * Math.sin(angle)}%`,
  };
}

function SeatCard({
  seat,
  room,
  isViewer,
  secondsLeft,
}: {
  seat: HoldemSeatView;
  room: HoldemRoomView;
  isViewer: boolean;
  secondsLeft: number | null;
}) {
  const handPlayer = room.hand?.players.find((player) => player.seat === seat.seat) || null;
  const isActing = room.hand?.actingSeat === seat.seat && !room.hand?.complete;
  const isButton = room.buttonSeat === seat.seat;
  const folded = handPlayer ? !handPlayer.inHand : false;
  const stack = handPlayer ? handPlayer.stack : seat.stack;
  const isWinner = room.hand?.complete && room.hand.results?.winners.includes(seat.seat);

  if (seat.empty) {
    return <div className="w-[clamp(4.6rem,13vw,8rem)] rounded-lg border border-dashed border-amber-200/25 bg-black/20 px-1.5 py-1.5 text-center text-[9px] text-amber-100/40">空座位</div>;
  }

  return (
    <div className={`w-[clamp(5.2rem,15vw,9rem)] rounded-lg border px-1.5 py-1.5 text-center shadow-xl backdrop-blur transition-all duration-300 sm:rounded-xl sm:px-2.5 sm:py-2 ${
      isActing ? 'border-amber-300 bg-amber-950/70 ring-1 ring-amber-300/60' : 'border-emerald-950/60 bg-black/55'
    } ${folded ? 'opacity-45' : ''} ${isWinner ? 'ring-2 ring-yellow-300' : ''}`}>
      <div className="flex items-center justify-center gap-1">
        {isButton && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white text-[8px] font-black text-slate-900 shadow sm:h-5 sm:w-5 sm:text-[10px]" title="庄家按钮">D</span>}
        <span className={`truncate text-[10px] font-black sm:text-xs ${isViewer ? 'text-amber-200' : 'text-emerald-50'}`}>{seat.displayName}</span>
        {seat.isBot && <span className="rounded bg-sky-500/25 px-1 text-[8px] font-bold text-sky-200">AI</span>}
      </div>

      <div className="mt-0.5 flex items-center justify-center gap-1">
        <PokerChip value={100} size={12} />
        <span className="text-[11px] font-black tabular-nums text-amber-100 sm:text-sm">{formatChips(stack)}</span>
      </div>

      <div className="mt-1 flex justify-center gap-0.5 sm:gap-1">
        {handPlayer ? (
          handPlayer.holeCards
            ? handPlayer.holeCards.map((card, index) => <PlayingCard key={`${card}-${index}`} card={card} width={isViewer ? 34 : 25} dimmed={folded} />)
            : [0, 1].map((index) => <PlayingCard key={index} faceDown width={isViewer ? 34 : 25} />)
        ) : <span className="text-[8px] text-emerald-100/40">本手未参与</span>}
      </div>

      {handPlayer?.handDescription && <div className="mt-0.5 truncate text-[8px] font-bold text-yellow-200 sm:text-[10px]">{handPlayer.handDescription}</div>}
      <div className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5 text-[8px] sm:text-[10px]">
        {handPlayer?.allIn && <span className="rounded bg-rose-500/30 px-1 py-0.5 font-bold text-rose-200">全下</span>}
        {folded && <span className="rounded bg-slate-600/40 px-1 py-0.5 font-bold text-slate-300">弃牌</span>}
        {handPlayer?.lastAction && !folded && <span className="rounded bg-emerald-500/25 px-1 py-0.5 font-bold text-emerald-100">{ACTION_LABEL[handPlayer.lastAction] || handPlayer.lastAction}</span>}
        {seat.autoPiloted && <span className="rounded bg-amber-500/25 px-1 py-0.5 font-bold text-amber-200">托管</span>}
        {!seat.connected && !seat.isBot && <span className="rounded bg-slate-600/40 px-1 py-0.5 font-bold text-slate-300">掉线</span>}
      </div>

      {handPlayer && handPlayer.committed > 0 && <div className="mt-1 flex justify-center"><ChipStack amount={handPlayer.committed} size={14} /></div>}
      {isActing && secondsLeft !== null && (
        <div className="mt-1">
          <div className="h-1 overflow-hidden rounded-full bg-black/50"><div className={`h-full rounded-full transition-all duration-500 ${secondsLeft <= 5 ? 'bg-rose-400' : 'bg-amber-300'}`} style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / room.thinkSeconds) * 100))}%` }} /></div>
          <div className={`mt-0.5 text-[9px] font-black tabular-nums ${secondsLeft <= 5 ? 'text-rose-300' : 'text-amber-200'}`}>{secondsLeft}s</div>
        </div>
      )}
    </div>
  );
}

function ShowdownComparison({ room }: { room: HoldemRoomView }) {
  const results = room.hand?.results;
  if (!room.hand?.complete || !results || results.shownHands.length === 0) return null;

  return (
    <div className="absolute inset-x-[8%] bottom-[7%] z-20 rounded-xl border border-amber-300/35 bg-[#062116]/90 p-2 shadow-2xl backdrop-blur sm:inset-x-[16%] sm:p-3">
      <div className="mb-1 text-center text-[9px] font-black uppercase tracking-[0.2em] text-amber-200 sm:text-[10px]">摊牌 · 牌型比较</div>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {results.shownHands.map((entry) => {
          const seat = room.seats.find((candidate) => candidate.seat === entry.seat);
          const payout = results.payouts.find((candidate) => candidate.seat === entry.seat)?.amount || 0;
          return (
            <div key={entry.seat} className={`min-w-0 rounded-lg px-1.5 py-1 text-center ${payout > 0 ? 'bg-amber-400/20 ring-1 ring-amber-300/40' : 'bg-black/25'}`}>
              <div className="truncate text-[9px] font-black text-emerald-50 sm:text-[10px]">{seat?.displayName || `座位 ${entry.seat + 1}`}</div>
              <div className="truncate text-[8px] text-yellow-200 sm:text-[9px]">{entry.name} · {entry.description}</div>
              <div className={`mt-0.5 text-[9px] font-black tabular-nums ${payout > 0 ? 'text-amber-200' : 'text-emerald-100/45'}`}>{payout > 0 ? `赢得 ${formatChips(payout)}` : '未获奖池'}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HoldemTable({ room }: { room: HoldemRoomView }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [nextHandIn, setNextHandIn] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setSecondsLeft(room.actionDeadline ? Math.max(0, Math.ceil((room.actionDeadline - Date.now()) / 1000)) : null);
      setNextHandIn(room.nextHandAt ? Math.max(0, Math.ceil((room.nextHandAt - Date.now()) / 1000)) : null);
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [room.actionDeadline, room.nextHandAt]);

  const viewerSeat = room.seat;
  const total = room.maxSeats;
  const board = room.hand?.board || [];

  return (
    <div className="relative mx-auto h-full min-h-[12rem] w-full max-w-5xl">
      <div className="relative h-full rounded-[46%/32%] p-2 shadow-2xl sm:p-4" style={{ background: 'linear-gradient(150deg, #7c4a21 0%, #5b3317 40%, #8b5a2b 70%, #4a2810 100%)', boxShadow: '0 20px 45px rgba(0,0,0,0.55), inset 0 2px 6px rgba(255,220,170,0.35)' }}>
        <div className="relative h-full w-full rounded-[46%/32%] border-2 border-amber-950/40 sm:border-4" style={{ background: 'radial-gradient(ellipse at 50% 42%, #1f7a4d 0%, #14663f 45%, #0c4a2c 100%)', boxShadow: 'inset 0 0 70px rgba(0,0,0,0.6)' }}>
          <div className="absolute left-1/2 top-[42%] -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-100/60 sm:text-[11px] sm:tracking-[0.3em]">
              {room.hand ? STREET_LABEL[room.hand.street] || room.hand.street : '等待开局'}
              {room.handNumber > 0 && <span className="ml-1 text-emerald-100/40 sm:ml-2">第 {room.handNumber} 手</span>}
            </div>
            <div className="mt-1 flex min-h-[48px] items-center justify-center gap-0.5 sm:mt-2 sm:min-h-[64px] sm:gap-1.5">
              {board.length > 0 ? board.map((card, index) => <PlayingCard key={`${card}-${index}`} card={card} width={36} />) : [0, 1, 2, 3, 4].map((index) => <div key={index} className="h-[50px] w-[36px] rounded border border-dashed border-emerald-100/15 sm:h-[64px] sm:w-[46px]" />)}
            </div>
            {room.hand && room.hand.pot > 0 && <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2 py-1 shadow-lg backdrop-blur sm:mt-2 sm:px-3 sm:py-1.5"><span className="text-[8px] font-black uppercase tracking-widest text-emerald-100/60 sm:text-[10px]">底池</span><ChipStack amount={room.hand.pot} size={15} /></div>}
            {nextHandIn !== null && <div className="mt-1 text-[9px] font-bold text-amber-200 sm:text-xs">{nextHandIn} 秒后开始下一手</div>}
          </div>

          {room.seats.map((seat) => {
            const relative = viewerSeat === null ? seat.seat : (seat.seat - viewerSeat + total) % total;
            return <div key={seat.seat} className="absolute -translate-x-1/2 -translate-y-1/2" style={seatPosition(relative, total)}><SeatCard seat={seat} room={room} isViewer={seat.seat === viewerSeat} secondsLeft={secondsLeft} /></div>;
          })}
          <ShowdownComparison room={room} />
        </div>
      </div>
    </div>
  );
}
