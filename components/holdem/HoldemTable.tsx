'use client';

/**
 * 经典绿呢牌桌：木质外框 + 呢面 + 椭圆分布的座位。
 * 视角始终把「自己」放在正下方，其余玩家按座位顺序沿椭圆排开。
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

/** 椭圆座位坐标：相对索引 0 固定在正下方（自己），其余按顺序逆时针排列。 */
function seatPosition(relativeIndex: number, total: number) {
  const angle = (Math.PI / 2) + (relativeIndex / total) * Math.PI * 2;
  return {
    left: `${50 + 42 * Math.cos(angle)}%`,
    top: `${50 + 38 * Math.sin(angle)}%`,
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
    return (
      <div className="w-32 rounded-xl border border-dashed border-amber-200/25 bg-black/20 px-3 py-2 text-center text-[11px] text-amber-100/40">
        空座位
      </div>
    );
  }

  return (
    <div
      className={`w-36 rounded-xl border px-2.5 py-2 text-center shadow-xl backdrop-blur transition-all duration-300 ${
        isActing ? 'border-amber-300 bg-amber-950/70 ring-2 ring-amber-300/60' : 'border-emerald-950/60 bg-black/55'
      } ${folded ? 'opacity-45' : ''} ${isWinner ? 'ring-2 ring-yellow-300' : ''}`}
    >
      <div className="flex items-center justify-center gap-1.5">
        {isButton && (
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] font-black text-slate-900 shadow" title="庄家按钮">D</span>
        )}
        <span className={`truncate text-xs font-black ${isViewer ? 'text-amber-200' : 'text-emerald-50'}`}>
          {seat.displayName}
        </span>
        {seat.isBot && <span className="rounded bg-sky-500/25 px-1 text-[9px] font-bold text-sky-200">AI</span>}
      </div>

      <div className="mt-1 flex items-center justify-center gap-1">
        <PokerChip value={100} size={14} />
        <span className="text-sm font-black tabular-nums text-amber-100">{formatChips(stack)}</span>
      </div>

      {/* 底牌：自己的牌始终可见，别人的牌只有摊牌后才由服务端下发。 */}
      <div className="mt-1.5 flex justify-center gap-1">
        {handPlayer ? (
          handPlayer.holeCards
            ? handPlayer.holeCards.map((card, index) => <PlayingCard key={`${card}-${index}`} card={card} width={isViewer ? 44 : 32} dimmed={folded} />)
            : [0, 1].map((index) => <PlayingCard key={index} faceDown width={isViewer ? 44 : 32} />)
        ) : (
          <span className="text-[10px] text-emerald-100/40">本手未参与</span>
        )}
      </div>

      {handPlayer?.handDescription && (
        <div className="mt-1 truncate text-[10px] font-bold text-yellow-200">{handPlayer.handDescription}</div>
      )}

      <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px]">
        {handPlayer?.allIn && <span className="rounded bg-rose-500/30 px-1.5 py-0.5 font-bold text-rose-200">全下</span>}
        {folded && <span className="rounded bg-slate-600/40 px-1.5 py-0.5 font-bold text-slate-300">已弃牌</span>}
        {handPlayer?.lastAction && !folded && (
          <span className="rounded bg-emerald-500/25 px-1.5 py-0.5 font-bold text-emerald-100">{ACTION_LABEL[handPlayer.lastAction] || handPlayer.lastAction}</span>
        )}
        {seat.autoPiloted && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 font-bold text-amber-200">托管中</span>}
        {!seat.connected && !seat.isBot && <span className="rounded bg-slate-600/40 px-1.5 py-0.5 font-bold text-slate-300">掉线</span>}
      </div>

      {/* 本轮已投入的筹码堆 */}
      {handPlayer && handPlayer.committed > 0 && (
        <div className="mt-1.5 flex justify-center"><ChipStack amount={handPlayer.committed} size={18} /></div>
      )}

      {isActing && secondsLeft !== null && (
        <div className="mt-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-black/50">
            <div
              className={`h-full rounded-full transition-all duration-500 ${secondsLeft <= 5 ? 'bg-rose-400' : 'bg-amber-300'}`}
              style={{ width: `${Math.max(0, Math.min(100, (secondsLeft / room.thinkSeconds) * 100))}%` }}
            />
          </div>
          <div className={`mt-0.5 text-[10px] font-black tabular-nums ${secondsLeft <= 5 ? 'text-rose-300' : 'text-amber-200'}`}>{secondsLeft}s</div>
        </div>
      )}
    </div>
  );
}

export default function HoldemTable({ room }: { room: HoldemRoomView }) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [nextHandIn, setNextHandIn] = useState<number | null>(null);

  // 行动倒计时与下一手倒计时都按服务端下发的绝对时间戳本地推算，避免频繁广播。
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
    <div className="relative mx-auto w-full max-w-5xl">
      {/* 木质外框 */}
      <div
        className="relative rounded-[46%/32%] p-4 shadow-2xl sm:p-6"
        style={{
          background: 'linear-gradient(150deg, #7c4a21 0%, #5b3317 40%, #8b5a2b 70%, #4a2810 100%)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.55), inset 0 2px 6px rgba(255,220,170,0.35)',
        }}
      >
        {/* 绿呢台面 */}
        <div
          className="relative aspect-[16/10] w-full rounded-[46%/32%] border-4 border-amber-950/40"
          style={{
            background: 'radial-gradient(ellipse at 50% 42%, #1f7a4d 0%, #14663f 45%, #0c4a2c 100%)',
            boxShadow: 'inset 0 0 90px rgba(0,0,0,0.6)',
          }}
        >
          {/* 台面中央：街道、底池与公共牌 */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="text-[11px] font-black uppercase tracking-[0.3em] text-emerald-100/60">
              {room.hand ? STREET_LABEL[room.hand.street] || room.hand.street : '等待开局'}
              {room.handNumber > 0 && <span className="ml-2 text-emerald-100/40">第 {room.handNumber} 手</span>}
            </div>

            <div className="mt-2 flex min-h-[76px] items-center justify-center gap-1.5">
              {board.length > 0
                ? board.map((card, index) => <PlayingCard key={`${card}-${index}`} card={card} width={52} />)
                : [0, 1, 2, 3, 4].map((index) => (
                    <div key={index} className="h-[73px] w-[52px] rounded-lg border border-dashed border-emerald-100/15" />
                  ))}
            </div>

            {room.hand && room.hand.pot > 0 && (
              <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 shadow-lg backdrop-blur">
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-100/60">底池</span>
                <ChipStack amount={room.hand.pot} size={20} />
              </div>
            )}

            {nextHandIn !== null && (
              <div className="mt-2 text-xs font-bold text-amber-200">{nextHandIn} 秒后开始下一手</div>
            )}
          </div>

          {/* 座位 */}
          {room.seats.map((seat) => {
            const relative = viewerSeat === null ? seat.seat : (seat.seat - viewerSeat + total) % total;
            const position = seatPosition(relative, total);
            return (
              <div
                key={seat.seat}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={position}
              >
                <SeatCard seat={seat} room={room} isViewer={seat.seat === viewerSeat} secondsLeft={secondsLeft} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
