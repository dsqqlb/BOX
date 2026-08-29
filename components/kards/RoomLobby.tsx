'use client';

import { useEffect, useMemo, useState } from 'react';
import { KardsCatalog, KardsDeck } from '@/lib/kards/types';

export interface KardsPublicRoom {
  roomId: string;
  hostUsername: string;
  joinerUsername: string | null;
  playerCount: number;
  connectedCount: number;
  lastActivity: number;
}

interface RoomLobbyProps {
  catalog: KardsCatalog;
  decks: KardsDeck[];
  builderDraft: string[];
  initialRoomId?: string | null;
  onStartBattle: (mode: 'create' | 'join', roomId: string | null, deckCards: string[]) => void;
  notify: (message: string, kind?: 'ok' | 'warn' | 'error') => void;
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

export default function RoomLobby({ catalog, decks, builderDraft, initialRoomId, onStartBattle, notify }: RoomLobbyProps) {
  const [rooms, setRooms] = useState<KardsPublicRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinRoomId, setJoinRoomId] = useState(initialRoomId || '');
  const [deckId, setDeckId] = useState('draft');

  const deckCards = useMemo(() => {
    if (deckId === 'draft') return builderDraft;
    return decks.find((deck) => deck.id === deckId)?.cards || [];
  }, [deckId, builderDraft, decks]);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const response = await fetch('/api/kards/rooms', { cache: 'no-store', credentials: 'same-origin' });
        if (response.ok) {
          const list = (await response.json()) as KardsPublicRoom[];
          if (!cancelled) setRooms(list);
        }
      } catch {
        // 房间列表拉取失败不阻塞其他操作
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  function createRoom() {
    if (deckCards.length === 0) {
      notify('先选一副牌再创建房间', 'warn');
      return;
    }
    onStartBattle('create', null, deckCards);
  }

  function joinRoom(roomId: string) {
    if (deckCards.length === 0) {
      notify('先选一副牌再加入房间', 'warn');
      return;
    }
    onStartBattle('join', roomId, deckCards);
  }

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* 公共房间列表 */}
      <section className="flex min-h-0 flex-col rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-zinc-100">🏠 公共房间</h2>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">{rooms.length}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-zinc-600">
            <span className={`h-1.5 w-1.5 rounded-full ${loading ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
            每 5 秒自动刷新
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-600">房间是公开的：谁都可以看到并加入等待对手的桌子，加入后凭房间号/链接重连。</p>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {rooms.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
              <div className="text-3xl">🎖️</div>
              <div className="text-sm text-zinc-500">当前没有房间</div>
              <div className="text-xs text-zinc-600">选好牌组，点右上角「创建房间」开一桌吧</div>
            </div>
          )}
          <div className="space-y-2">
            {rooms.map((room) => {
              const full = !!room.joinerUsername;
              const isMine = false; // 用户名在页面里拿不到，服务端会拒绝加入自己的房间
              return (
                <div key={room.roomId} className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 transition hover:border-zinc-700">
                  <span className="font-mono text-lg font-bold tracking-widest text-amber-400">{room.roomId}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-zinc-200">{room.hostUsername}</div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {room.playerCount}/2 人 · {room.connectedCount} 在线 · {relativeTime(room.lastActivity)}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${full ? 'bg-red-950/60 text-red-400' : 'bg-emerald-950/60 text-emerald-400'}`}>
                    {full ? '对局中' : '等待对手'}
                  </span>
                  <button
                    onClick={() => joinRoom(room.roomId)}
                    disabled={full}
                    className="h-8 rounded-lg bg-amber-500 px-3 text-xs font-bold text-zinc-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
                  >
                    加入
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 创建 / 加入 */}
      <section className="flex flex-col gap-3">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h3 className="text-sm font-bold text-zinc-100">🏳 新建房间</h3>
          <div className="mt-3">
            <div className="mb-1 text-xs text-zinc-500">出战牌组</div>
            <select
              value={deckId}
              onChange={(event) => setDeckId(event.target.value)}
              className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 outline-none focus:border-amber-500/60"
            >
              <option value="draft">当前草稿（{builderDraft.length} 张）</option>
              {decks.map((deck) => (
                <option key={deck.id} value={deck.id}>{deck.name}（{deck.cards.length} 张）</option>
              ))}
            </select>
            {deckCards.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-400/80">当前草稿为空，建议先去组卡器组一副牌</p>
            )}
          </div>
          <button
            onClick={createRoom}
            disabled={deckCards.length === 0}
            className="mt-3 h-11 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-sm font-bold text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            创建房间
          </button>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <h3 className="text-sm font-bold text-zinc-100">🔑 按房间号加入</h3>
          <div className="mt-3 flex gap-2">
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6 位房间号"
              inputMode="numeric"
              className="h-11 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-lg tracking-[0.4em] text-zinc-100 outline-none focus:border-amber-500/60"
            />
            <button
              onClick={() => joinRoom(joinRoomId.trim())}
              disabled={!/^\d{6}$/.test(joinRoomId.trim()) || deckCards.length === 0}
              className="h-11 shrink-0 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 text-sm font-bold text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              加入
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
            打开别人分享的 <span className="text-zinc-500">/tools/kards?room=XXXXXX</span> 链接会自动跳到这里并预填房间号。
          </p>
        </div>
      </section>
    </div>
  );
}
