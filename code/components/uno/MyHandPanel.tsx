'use client';

/** 我的手牌 + 操作按钮：点牌即出（万能牌先弹选色），抓牌 / 过牌 / 喊 UNO。 */

import type { UnoCardView, UnoCatalog, UnoGameView, UnoPlayerView, UnoSeatView } from '@/lib/uno/types';
import { avatarColor, initialOf } from '@/lib/uno/catalog';
import HandFan from './HandFan';

export default function MyHandPanel({
  game,
  catalog,
  playable,
  myTurn,
  myPlayer,
  me,
  hint,
  onCardClick,
  onDraw,
  onPass,
  onCallUno,
}: {
  game: UnoGameView | null;
  catalog: UnoCatalog | null;
  playable: Set<string>;
  myTurn: boolean;
  myPlayer: UnoPlayerView | null;
  me: UnoSeatView | null;
  hint: string;
  onCardClick: (card: UnoCardView) => void;
  onDraw: () => void;
  onPass: () => void;
  onCallUno: () => void;
}) {
  const hand = game?.hand || [];

  return (
    <div data-uno-hand className="rounded-3xl border border-white/[.1] bg-white/[.03] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full text-sm font-black text-slate-950" style={{ background: avatarColor(me?.displayName || '?') }}>
          {initialOf(me?.displayName ?? null)}
        </span>
        <span className="text-sm font-bold text-white">{me?.displayName}（你）</span>
        <span className="rounded-full bg-black/40 px-2 py-0.5 font-mono text-xs font-black text-white">{myPlayer?.handCount ?? 0} 张</span>
        {myPlayer?.saidUno && <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-bold text-emerald-200">已喊 UNO</span>}
        {myPlayer?.unoPending && (
          <span className="rounded-full bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-100">还没喊 UNO，快喊！</span>
        )}
        {myTurn && <span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-bold text-amber-100">轮到你</span>}
      </div>

      <div className="mt-3">
        <HandFan cards={hand} catalog={catalog} playable={playable} myTurn={myTurn} onCardClick={onCardClick} />
      </div>

      {hint && <div className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">{hint}</div>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-action="draw"
          disabled={!game?.legal.canDraw}
          onClick={onDraw}
          className="rounded-xl bg-white/[.1] px-4 py-2 text-xs font-bold text-white transition hover:bg-white/[.16] disabled:opacity-40"
        >
          抓一张
        </button>
        <button
          type="button"
          data-action="pass"
          disabled={!game?.legal.canPass}
          onClick={onPass}
          className="rounded-xl bg-white/[.1] px-4 py-2 text-xs font-bold text-white transition hover:bg-white/[.16] disabled:opacity-40"
        >
          过牌
        </button>
        <button
          type="button"
          data-action="uno"
          disabled={!myPlayer || myPlayer.handCount > 2 || myPlayer.saidUno}
          onClick={onCallUno}
          className="rounded-xl bg-emerald-400/90 px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-emerald-300 disabled:opacity-40"
        >
          喊 UNO
        </button>
        <span className="self-center text-[11px] text-slate-500">
          点击手牌即出牌（万能牌会让你先选颜色）；拖拽出牌与动效在 Step 6 一起做。
        </span>
      </div>
    </div>
  );
}