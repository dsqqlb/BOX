'use client';

/** 大厅：建房（房主自定义）+ 用 6 位房间号加入 + 正在等待的房间列表。 */

import type { UnoCatalog, UnoLobbyRoom } from '@/lib/uno/types';
import { describeRules, phaseLabel, thinkLabel } from '@/lib/uno/catalog';
import RoomSettingsForm, { type SettingsDraft } from './RoomSettingsForm';

const BOT_LEVELS = [
  { value: 'easy', label: '新手' },
  { value: 'normal', label: '普通' },
  { value: 'hard', label: '高手' },
];

export default function UnoLobby({
  catalog,
  rooms,
  notice,
  busy,
  connected,
  draft,
  onDraftChange,
  botCount,
  botLevel,
  onBotCountChange,
  onBotLevelChange,
  joinId,
  onJoinIdChange,
  onCreate,
  onJoin,
  onRefresh,
}: {
  catalog: UnoCatalog | null;
  rooms: UnoLobbyRoom[];
  notice: string;
  busy: boolean;
  connected: boolean;
  draft: SettingsDraft;
  onDraftChange: (draft: SettingsDraft) => void;
  botCount: number;
  botLevel: string;
  onBotCountChange: (count: number) => void;
  onBotLevelChange: (level: string) => void;
  joinId: string;
  onJoinIdChange: (value: string) => void;
  onCreate: () => void;
  onJoin: (roomId?: string) => void;
  onRefresh: () => void;
}) {
  const maxBots = Math.max(0, (draft.seats || 4) - 1);
  const canJoin = /^\d{6}$/.test(joinId.trim());

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="rounded-3xl border border-white/[.1] bg-white/[.03] p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-black text-white">建房</h2>
          <span className="text-[11px] text-slate-400">房主先定好规则，再等大家进来</span>
        </div>

        <div className="mt-4 rounded-2xl border border-white/[.08] bg-black/20 p-4">
          <RoomSettingsForm catalog={catalog} draft={draft} onChange={onDraftChange} disabled={busy} />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-300">机器人数量</span>
              <span className="text-[11px] text-slate-500">开局前可再改</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: maxBots + 1 }, (_, count) => count).map((count) => (
                <button
                  key={count}
                  type="button"
                  disabled={busy}
                  onClick={() => onBotCountChange(count)}
                  data-action="bot-count"
                  className={`rounded-xl border px-3 py-1.5 text-sm font-bold transition disabled:opacity-60 ${
                    botCount === count
                      ? 'border-amber-300/60 bg-amber-300/15 text-amber-100'
                      : 'border-white/[.1] bg-white/[.03] text-slate-300 hover:bg-white/[.07]'
                  }`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-slate-300">机器人难度</div>
            <div className="flex flex-wrap gap-2">
              {BOT_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  disabled={busy || botCount === 0}
                  onClick={() => onBotLevelChange(level.value)}
                  className={`rounded-xl border px-3 py-1.5 text-sm font-bold transition disabled:opacity-40 ${
                    botLevel === level.value
                      ? 'border-amber-300/60 bg-amber-300/15 text-amber-100'
                      : 'border-white/[.1] bg-white/[.03] text-slate-300 hover:bg-white/[.07]'
                  }`}
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || !catalog}
          onClick={onCreate}
          data-action="create-room"
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-amber-400 to-rose-400 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-50"
        >
          {busy ? '正在建房…' : `建房（${draft.seats} 人 / ${thinkLabel(draft.thinkSeconds)}）`}
        </button>
        <p className="mt-2 text-center text-[11px] text-slate-500">
          建房后会得到一个 6 位房间号，发给朋友就能一起玩。房间只要有人就一直在，长期没人会自动回收。
        </p>
      </section>

      <section className="space-y-5">
        <div className="rounded-3xl border border-white/[.1] bg-white/[.03] p-5">
          <h2 className="text-lg font-black text-white">加入房间</h2>
          <div className="mt-4 flex gap-2">
            <input
              value={joinId}
              onChange={(event) => onJoinIdChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(event) => { if (event.key === 'Enter' && canJoin) onJoin(); }}
              inputMode="numeric"
              placeholder="6 位房间号"
              className="min-w-0 flex-1 rounded-xl border border-white/[.12] bg-black/30 px-4 py-3 text-center font-mono text-2xl tracking-[.3em] text-white placeholder:text-slate-600 focus:border-amber-300/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={busy || !canJoin}
              onClick={() => onJoin()}
              className="rounded-xl bg-white/[.08] px-5 text-sm font-bold text-white transition hover:bg-white/[.14] disabled:opacity-40"
            >
              加入
            </button>
          </div>
          {!connected && <p className="mt-2 text-[11px] text-slate-500">连接实时通道中…（建房与加入都走 WebSocket）</p>}
        </div>

        <RoomList catalog={catalog} rooms={rooms} busy={busy} onJoin={onJoin} onRefresh={onRefresh} />

        {notice && (
          <p className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{notice}</p>
        )}
      </section>
    </div>
  );
}

function RoomList({
  catalog,
  rooms,
  busy,
  onJoin,
  onRefresh,
}: {
  catalog: UnoCatalog | null;
  rooms: UnoLobbyRoom[];
  busy: boolean;
  onJoin: (roomId?: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-3xl border border-white/[.1] bg-white/[.03] p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-black text-white">等待中的房间</h2>
        <button type="button" onClick={onRefresh} className="text-[11px] text-slate-400 hover:text-white">刷新</button>
      </div>
      {rooms.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-white/[.12] px-4 py-6 text-center text-xs text-slate-500">
          现在没有开着的房间。建一个，或者等朋友建房。
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rooms.map((room) => (
            <li key={room.roomId} className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[.09] bg-black/20 px-4 py-3">
              <span className="font-mono text-xl font-black tracking-[.2em] text-amber-200">{room.roomId}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-white">{room.hostUsername} 的房间</span>
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                  {phaseLabel(room.phase)} · 第 {room.roundNumber || 0} 局 · {thinkLabel(room.thinkSeconds)} · {describeRules(catalog, room.rules)}
                </span>
              </span>
              <span className="rounded-full bg-white/[.08] px-2.5 py-1 text-[11px] font-bold text-slate-200">
                {room.seatedCount}/{room.seatCount}{room.botCount > 0 ? `（机器人 ${room.botCount}）` : ''}
              </span>
              <button
                type="button"
                disabled={busy || room.seatedCount >= room.seatCount}
                onClick={() => onJoin(room.roomId)}
                className="rounded-xl bg-amber-300/90 px-3 py-1.5 text-xs font-black text-slate-950 transition hover:bg-amber-200 disabled:opacity-40"
              >
                {room.seatedCount >= room.seatCount ? '已满' : '加入'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}