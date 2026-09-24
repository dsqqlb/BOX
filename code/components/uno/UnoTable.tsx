'use client';

/**
 * 牌桌（育碧电子游戏风格）：深色牌布 + 木纹边框 + 立起来的扇形手牌 + 对称旋转箭头 + 自绘卡面。
 * 服务端是规则权威：这里只负责把快照画好看、把点击变成意图。
 */

import { useEffect, useRef, useState } from 'react';
import type { UnoCardView, UnoCatalog, UnoRoomView } from '@/lib/uno/types';
import { cardLabel, colorHex, colorName } from '@/lib/uno/catalog';
import SeatPlate from './SeatPlate';
import DirectionArrows from './DirectionArrows';
import MyHandPanel from './MyHandPanel';
import TableLog from './TableLog';
import UnoCard from './UnoCard';
import { ColorPickerOverlay, RoundOverOverlay } from './TableOverlays';

const PILL = 'rounded-full bg-white/[.08] px-2.5 py-1 text-[11px] font-bold text-slate-200';
const GHOST = 'rounded-xl border border-white/[.12] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/[.06]';

export default function UnoTable({
  room,
  catalog,
  notice,
  onPlay,
  onDraw,
  onPass,
  onChooseColor,
  onCallUno,
  onChallenge,
  onTogglePilot,
  onRematch,
  onLeave,
  onDelete,
}: {
  room: UnoRoomView;
  catalog: UnoCatalog | null;
  notice: string;
  onPlay: (cardId: string, color?: string) => void;
  onDraw: () => void;
  onPass: () => void;
  onChooseColor: (color: string) => void;
  onCallUno: () => void;
  onChallenge: (seat: number) => void;
  onTogglePilot: (on: boolean) => void;
  onRematch: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const game = room.game;
  const mySeat = room.seat;
  const [colorPickCard, setColorPickCard] = useState<string | null>(null);
  const [hint, setHint] = useState('');
  const [, setTick] = useState(0);

  // 倒计时不能拿本机时钟直接减服务端时间（会有时差），
  // 所以记住「这次快照是什么时候到的」，按相对时间倒推。
  const arrivedAt = useRef(Date.now());
  useEffect(() => { arrivedAt.current = Date.now(); }, [room.seq]);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = room.turnDeadline
    ? Math.max(0, Math.ceil((room.turnDeadline - room.serverNow - (Date.now() - arrivedAt.current)) / 1000))
    : null;

  const playable = new Set(game?.legal.playable || []);
  const myTurn = Boolean(game && game.turnSeat === mySeat && game.phase === 'playing' && game.awaitColorSeat === null);
  const myPlayer = game?.players.find((player) => player.seat === mySeat) || null;
  const me = room.seats.find((seat) => seat.seat === mySeat) || null;
  const needColorFromMe = game?.awaitColorSeat === mySeat;
  const opponents = room.seats.filter((seat) => seat.seat !== mySeat && seat.occupied);
  const discardTail = game?.discardTail?.length ? game.discardTail : (game?.top ? [game.top] : []);
  const turnName = game?.players.find((player) => player.seat === game.turnSeat)?.name || '';

  const clickCard = (card: UnoCardView) => {
    if (needColorFromMe) { setHint('请先选一个颜色。'); return; }
    if (!myTurn) { setHint('还没轮到你。'); return; }
    if (!playable.has(card.id)) { setHint(`${cardLabel(catalog, card)} 现在不能出（颜色和数字都对不上）。`); return; }
    setHint('');
    if (card.color === 'wild') { setColorPickCard(card.id); return; }
    onPlay(card.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[.1] bg-black/30 px-3 py-2.5 sm:gap-3 sm:px-4">
        <span className="font-mono text-lg font-black tracking-[.2em] text-amber-200">{room.roomId}</span>
        <span className={PILL}>第 {room.roundNumber} 局</span>
        <span className={`${PILL} flex items-center gap-1.5`}>
          当前颜色
          <span className="h-3.5 w-3.5 rounded-full border border-white/30" style={{ background: colorHex(catalog, game?.currentColor || null) }} />
          {game?.currentColor ? colorName(catalog, game.currentColor) : '待指定'}
        </span>
        {game && game.pendingDraw > 0 && (
          <span className="rounded-full bg-rose-500/25 px-2.5 py-1 text-[11px] font-black text-rose-100">待罚 {game.pendingDraw} 张</span>
        )}
        {remaining !== null && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${remaining <= 3 ? 'bg-rose-500/30 text-rose-100' : 'bg-white/[.08] text-slate-200'}`}>
            剩余 {remaining} 秒
          </span>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onTogglePilot(!me?.autoPiloted)}
            className={me?.autoPiloted ? 'rounded-xl bg-rose-400/90 px-3 py-1.5 text-xs font-bold text-slate-950' : GHOST}
          >
            {me?.autoPiloted ? '托管中 · 点我收回' : '交给机器人托管'}
          </button>
          <button type="button" onClick={onLeave} className={GHOST}>离开</button>
          {room.isHost && (
            <button type="button" onClick={onDelete} className="rounded-xl border border-rose-400/40 px-3 py-1.5 text-xs font-bold text-rose-200 hover:bg-rose-500/10">
              解散
            </button>
          )}
        </span>
      </div>

      {notice && <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{notice}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_290px] [@media(max-height:520px)_and_(orientation:landscape)]:grid-cols-[minmax(0,1fr)_minmax(0,330px)]">
        <div className="space-y-3 [@media(max-height:520px)_and_(orientation:landscape)]:contents">
          <FeltTable
            catalog={catalog}
            game={game}
            opponents={opponents}
            discardTail={discardTail}
            turnName={turnName}
            myTurn={myTurn}
            playableCount={playable.size}
            onChallenge={onChallenge}
          />

          <MyHandPanel
            game={game}
            catalog={catalog}
            playable={playable}
            myTurn={myTurn}
            myPlayer={myPlayer}
            me={me}
            hint={hint}
            onCardClick={clickCard}
            onDraw={onDraw}
            onPass={onPass}
            onCallUno={onCallUno}
          />
        </div>

        <TableLog room={room} />
      </div>

      {game?.phase === 'roundOver' && <RoundOverOverlay room={room} game={game} onRematch={onRematch} onLeave={onLeave} />}

      <ColorPickerOverlay
        catalog={catalog}
        colorPickCard={colorPickCard}
        needColorFromMe={needColorFromMe}
        onPickCardColor={(cardId, color) => { onPlay(cardId, color); setColorPickCard(null); setHint(''); }}
        onChooseColor={(color) => { onChooseColor(color); setHint(''); }}
        onCancel={() => setColorPickCard(null)}
      />
    </div>
  );
}

/** 牌布：木纹边框 + 深色绒面 + 中央牌堆 + 环绕的座位。 */
function FeltTable({
  catalog,
  game,
  opponents,
  discardTail,
  turnName,
  myTurn,
  playableCount,
  onChallenge,
}: {
  catalog: UnoCatalog | null;
  game: UnoRoomView['game'];
  opponents: UnoRoomView['seats'];
  discardTail: UnoCardView[];
  turnName: string;
  myTurn: boolean;
  playableCount: number;
  onChallenge: (seat: number) => void;
}) {
  return (
    <div data-uno-felt className="relative overflow-hidden rounded-[20px] border-[6px] border-[#4a2f1a] bg-[radial-gradient(ellipse_at_50%_38%,#14523d_0%,#0a3227_58%,#061c16_100%)] p-2 shadow-2xl sm:rounded-[26px] sm:border-[10px] sm:p-4">
      <div
        className="pointer-events-none absolute inset-0 opacity-[.07]"
        style={{ backgroundImage: 'repeating-linear-gradient(45deg, #ffffff 0 2px, transparent 2px 7px)' }}
      />
      <div className="relative space-y-3">
        <div className="relative z-10 flex flex-wrap justify-center gap-2">
          {opponents.map((seat) => (
            <div key={seat.seat} className="w-[48%] min-w-[150px] sm:w-auto sm:min-w-[190px]">
              <SeatPlate
                seat={seat}
                player={game?.players.find((player) => player.seat === seat.seat) || null}
                catalog={catalog}
                isTurn={game?.turnSeat === seat.seat || game?.awaitColorSeat === seat.seat}
                onChallenge={onChallenge}
              />
            </div>
          ))}
        </div>

        <div className="relative mx-auto flex min-h-[190px] w-full items-center justify-center sm:min-h-[240px] [@media(max-height:520px)]:min-h-[150px]">
          <DirectionArrows
            direction={game?.direction === -1 ? -1 : 1}
            className="pointer-events-none absolute h-auto w-full max-w-[240px] opacity-70 sm:max-w-[320px]"
          />

          <div className="relative flex items-center gap-10 sm:gap-14">
            <div className="relative text-center">
              <div className="relative h-[104px] w-[70px] sm:h-[150px] sm:w-[100px] [@media(max-height:520px)]:h-[86px] [@media(max-height:520px)]:w-[58px]">
                {[0, 1, 2].map((offset) => (
                  <UnoCard
                    key={offset}
                    faceDown
                    width={100}
                    className="absolute left-0 top-0 h-auto w-full drop-shadow-lg"
                    style={{ transform: `translate(${offset * 2}px, ${offset * -2}px)` }}
                  />
                ))}
              </div>
              <div className="mt-2 rounded-full bg-black/40 px-3 py-1 text-[11px] font-bold text-slate-200">牌堆 {game?.drawPileCount ?? '—'}</div>
            </div>

            <div className="relative text-center">
              <div
                data-uno-top={game?.top ? cardLabel(catalog, game.top) : ''}
                title={game?.top ? cardLabel(catalog, game.top) : '还没有顶牌'}
                className="relative h-[104px] w-[70px] sm:h-[150px] sm:w-[100px] [@media(max-height:520px)]:h-[86px] [@media(max-height:520px)]:w-[58px]"
              >
                {discardTail.map((card, index) => {
                  const isTop = index === discardTail.length - 1;
                  return (
                    <UnoCard
                      key={card.id}
                      card={card}
                      catalog={catalog}
                      width={100}
                      className="absolute left-0 top-0 h-auto w-full drop-shadow-xl"
                      style={{
                        transform: `rotate(${(index - 1) * 9}deg) translate(${(index - 1) * 5}px, ${(index - 1) * -3}px)`,
                        zIndex: isTop ? 20 : index + 1,
                      }}
                    />
                  );
                })}
                {!discardTail.length && <div className="absolute inset-0 rounded-2xl border border-dashed border-white/25" />}
              </div>
              <div className="mt-2 rounded-full bg-black/40 px-3 py-1 text-[11px] font-bold text-slate-100">
                {game?.top ? cardLabel(catalog, game.top) : '还没有顶牌'}
              </div>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-center text-xs text-slate-300">
          {game?.phase === 'roundOver'
            ? '本局结束'
            : myTurn
              ? `轮到你出牌 · 可出 ${playableCount} 张${game?.legal.canDraw ? '，也可以抓牌' : ''}`
              : `${turnName} 正在出牌`}
          {game?.legal.drawnThisTurn ? '（这一轮抓过牌了，只能出刚抓到的那张或过牌）' : ''}
        </p>
      </div>
    </div>
  );
}