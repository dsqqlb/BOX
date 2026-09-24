'use client';

/** 等待室：房间号、座位、加/减机器人、房主改设置、开局。 */

import { useEffect, useState } from 'react';
import type { UnoCatalog, UnoRoomView } from '@/lib/uno/types';
import { avatarColor, botLevelLabel, initialOf, thinkLabel } from '@/lib/uno/catalog';
import RoomSettingsForm, { draftFromRoom, type SettingsDraft } from './RoomSettingsForm';

const BOT_LEVELS = [
  { value: 'easy', label: '新手' },
  { value: 'normal', label: '普通' },
  { value: 'hard', label: '高手' },
];

export default function WaitingRoomPanel({
  room,
  catalog,
  busy,
  onAddBot,
  onRemoveBot,
  onUpdateSettings,
  onStart,
  onLeave,
  onDelete,
}: {
  room: UnoRoomView;
  catalog: UnoCatalog | null;
  busy: boolean;
  onAddBot: (level: string) => void;
  onRemoveBot: (seat: number) => void;
  onUpdateSettings: (draft: SettingsDraft) => void;
  onStart: () => void;
  onLeave: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromRoom(room.settings));
  const [copied, setCopied] = useState('');
  const [botLevel, setBotLevel] = useState('normal');

  // 房间设置被（自己或服务端）改动时同步到表单。
  useEffect(() => {
    setDraft(draftFromRoom(room.settings));
  }, [room.settings.seats, room.settings.thinkSeconds, JSON.stringify(room.settings.rules)]);

  const occupied = room.seats.filter((seat) => seat.occupied).length;
  const canAddBot = room.isHost && occupied < room.settings.seats;
  const dirty = JSON.stringify(draftFromRoom(room.settings)) !== JSON.stringify(draft);

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(room.roomId);
      setCopied('已复制房间号');
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('复制失败，请手动抄下房间号');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <section className="rounded-3xl border border-white/[.1] bg-white/[.03] p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[.2em] text-slate-400">房间号</div>
            <div className="font-mono text-4xl font-black tracking-[.25em] text-amber-200">{room.roomId}</div>
          </div>
          <button type="button" onClick={() => void copyRoomId()} className="rounded-xl bg-white/[.08] px-3 py-2 text-xs font-bold text-white hover:bg-white/[.14]">
            {copied === '已复制房间号' ? '✓ 已复制' : '复制房间号'}
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onLeave} className="rounded-xl border border-white/[.12] px-3 py-2 text-xs font-bold text-slate-300 hover:bg-white/[.06]">
              离开房间
            </button>
            {room.isHost && (
              <button type="button" onClick={onDelete} className="rounded-xl border border-rose-400/40 px-3 py-2 text-xs font-bold text-rose-200 hover:bg-rose-500/10">
                解散房间
              </button>
            )}
          </div>
        </div>
        {copied && <p className="mt-3 text-xs text-emerald-300">{copied}</p>}

        <ul className="mt-5 space-y-2">
          {room.seats.map((seat) => {
            const isMe = seat.seat === room.seat;
            return (
              <li
                key={seat.seat}
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                  isMe ? 'border-amber-300/40 bg-amber-300/[.07]' : 'border-white/[.09] bg-black/20'
                }`}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-base font-black text-slate-950"
                  style={{ background: seat.occupied ? avatarColor(seat.displayName || '?') : 'rgba(255,255,255,.12)' }}
                >
                  {seat.occupied ? initialOf(seat.displayName) : seat.seat + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-white">
                    {seat.occupied ? seat.displayName : '空座位'}
                    {seat.isBot && <span className="ml-2 rounded-full bg-sky-400/20 px-2 py-0.5 text-[10px] font-bold text-sky-200">机器人 · {botLevelLabel(seat.botLevel)}</span>}
                    {isMe && <span className="ml-2 rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px] font-bold text-amber-100">你</span>}
                    {seat.username === room.hostUsername && <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-slate-200">房主</span>}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {seat.occupied ? (seat.connected ? '在线' : '离线（座位保留）') : '等待加入'}
                  </span>
                </span>
                {room.isHost && seat.isBot && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemoveBot(seat.seat)}
                    className="rounded-xl border border-white/[.12] px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/[.06] disabled:opacity-40"
                  >
                    移除
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <WaitingRoomSide
        room={room}
        catalog={catalog}
        busy={busy}
        draft={draft}
        setDraft={setDraft}
        dirty={dirty}
        occupied={occupied}
        canAddBot={canAddBot}
        botLevel={botLevel}
        setBotLevel={setBotLevel}
        onAddBot={onAddBot}
        onUpdateSettings={onUpdateSettings}
        onStart={onStart}
      />
    </div>
  );
}

function WaitingRoomSide({
  room,
  catalog,
  busy,
  draft,
  setDraft,
  dirty,
  occupied,
  canAddBot,
  botLevel,
  setBotLevel,
  onAddBot,
  onUpdateSettings,
  onStart,
}: {
  room: UnoRoomView;
  catalog: UnoCatalog | null;
  busy: boolean;
  draft: SettingsDraft;
  setDraft: (draft: SettingsDraft) => void;
  dirty: boolean;
  occupied: number;
  canAddBot: boolean;
  botLevel: string;
  setBotLevel: (level: string) => void;
  onAddBot: (level: string) => void;
  onUpdateSettings: (draft: SettingsDraft) => void;
  onStart: () => void;
}) {
  return (
    <section className="rounded-3xl border border-white/[.1] bg-white/[.03] p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-black text-white">房间设置</h2>
        <span className="text-[11px] text-slate-400">{room.isHost ? '房主可改' : '只有房主能改'}</span>
      </div>

      <div className="mt-4">
        <RoomSettingsForm catalog={catalog} draft={draft} onChange={setDraft} disabled={busy || !room.isHost} />
      </div>

      <button
        type="button"
        disabled={busy || !room.isHost || !dirty}
        onClick={() => onUpdateSettings(draft)}
        className="mt-4 w-full rounded-2xl bg-white/[.1] py-2.5 text-sm font-bold text-white transition hover:bg-white/[.16] disabled:opacity-40"
      >
        {dirty ? '保存设置' : '设置已是最新'}
      </button>

      {room.isHost && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/[.09] bg-black/20 px-4 py-3">
          <span className="text-xs font-semibold text-slate-300">添加机器人</span>
          <div className="flex gap-1.5">
            {BOT_LEVELS.map((level) => (
              <button
                key={level.value}
                type="button"
                onClick={() => setBotLevel(level.value)}
                className={`rounded-lg border px-2.5 py-1 text-xs font-bold transition ${
                  botLevel === level.value ? 'border-sky-300/60 bg-sky-300/15 text-sky-100' : 'border-white/[.1] text-slate-300 hover:bg-white/[.06]'
                }`}
              >
                {level.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !canAddBot}
            onClick={() => onAddBot(botLevel)}
            data-action="add-bot"
            className="ml-auto rounded-xl bg-sky-400/90 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-sky-300 disabled:opacity-40"
          >
            {canAddBot ? '请一位机器人' : '没有空位'}
          </button>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !room.isHost || !room.canStart}
          onClick={onStart}
          data-action="start-game"
          className="rounded-2xl bg-gradient-to-r from-emerald-400 to-sky-400 px-6 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:brightness-110 disabled:opacity-40"
        >
          开始牌局
        </button>
        <span className="text-xs text-slate-400">
          {room.canStart
            ? (room.isHost ? `桌上 ${occupied} 人，可以开局` : '等房主开始')
            : `至少需要 ${room.limits.minSeats} 人（可以加机器人），现在 ${occupied} 人`}
        </span>
      </div>

      <p className="mt-3 text-[11px] leading-5 text-slate-500">
        现在：{room.settings.seats} 人 / {thinkLabel(room.settings.thinkSeconds)}。开局后想换设置，等这一局结束再改。
      </p>
    </section>
  );
}