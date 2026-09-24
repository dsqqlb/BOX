'use client';

/** 牌桌上的两个弹层：万能牌选色、本局结束后的结算面板。 */

import type { UnoCatalog, UnoGameView, UnoRoomView } from '@/lib/uno/types';

export function ColorPickerOverlay({
  catalog,
  colorPickCard,
  needColorFromMe,
  onPickCardColor,
  onChooseColor,
  onCancel,
}: {
  catalog: UnoCatalog | null;
  colorPickCard: string | null;
  needColorFromMe: boolean;
  onPickCardColor: (cardId: string, color: string) => void;
  onChooseColor: (color: string) => void;
  onCancel: () => void;
}) {
  if (!colorPickCard && !needColorFromMe) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <div className="w-full max-w-sm rounded-3xl border border-white/[.14] bg-[#0d1428] p-5 text-center">
        <h3 className="text-lg font-black text-white">指定颜色</h3>
        <p className="mt-1 text-xs text-slate-400">打出万能牌后，由你决定接下来的颜色</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {(catalog?.colors || []).map((color) => (
            <button
              key={color.id}
              type="button"
              onClick={() => {
                if (colorPickCard) onPickCardColor(colorPickCard, color.id);
                else onChooseColor(color.id);
              }}
              className="rounded-2xl border border-white/20 py-6 text-lg font-black text-white transition hover:brightness-110"
              style={{ background: color.hex }}
            >
              {color.name}
            </button>
          ))}
        </div>
        {colorPickCard && (
          <button type="button" onClick={onCancel} className="mt-4 text-xs text-slate-400 hover:text-white">
            取消，不出了
          </button>
        )}
      </div>
    </div>
  );
}

export function RoundOverOverlay({
  room,
  game,
  onRematch,
  onLeave,
}: {
  room: UnoRoomView;
  game: UnoGameView;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const winner = game.players.find((player) => player.seat === game.winner);
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-3xl border border-amber-300/40 bg-gradient-to-r from-amber-300/[.12] to-rose-400/[.08] px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] uppercase tracking-[.22em] text-amber-300">第 {room.roundNumber} 局结束</div>
        <h3 className="mt-1 text-xl font-black text-white">{winner?.name || '有人'} 赢了</h3>
        <p className="mt-0.5 text-xs text-slate-300">对手剩余手牌共 {game.roundPoints} 分（牌面大的留在手上会越亏）</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {room.isHost ? (
          <button
            type="button"
            onClick={onRematch}
            className="rounded-2xl bg-gradient-to-r from-emerald-400 to-sky-400 px-5 py-2.5 text-sm font-black text-slate-950 hover:brightness-110"
          >
            再来一局
          </button>
        ) : (
          <span className="rounded-2xl border border-white/[.12] px-4 py-2.5 text-xs text-slate-300">等房主点「再来一局」</span>
        )}
        <button type="button" onClick={onLeave} className="rounded-2xl border border-white/[.12] px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-white/[.06]">
          离开房间
        </button>
      </div>
    </div>
  );
}