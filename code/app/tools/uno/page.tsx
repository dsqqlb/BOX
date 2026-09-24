'use client';

/**
 * UNO 联机牌桌：大厅 → 等待室 → 牌桌。
 * 服务端是规则权威，这个页面只负责三件事：拉牌库目录与大厅列表、连 WebSocket、把点击变成意图。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import UnoLobby from '@/components/uno/UnoLobby';
import UnoTable from '@/components/uno/UnoTable';
import UnoProgress from '@/components/uno/UnoProgress';
import WaitingRoomPanel from '@/components/uno/WaitingRoomPanel';
import { draftFromCatalog, type SettingsDraft } from '@/components/uno/RoomSettingsForm';
import { fetchUnoCatalog, fetchUnoRooms } from '@/lib/uno/api';
import { getWsUrl, useWebSocket } from '@/lib/useWebSocket';
import type { UnoCatalog, UnoLobbyRoom, UnoRoomView } from '@/lib/uno/types';

interface OutgoingMessage {
  type: string;
  payload: Record<string, unknown>;
}

export default function UnoPage() {
  const [username, setUsername] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<UnoCatalog | null>(null);
  const [rooms, setRooms] = useState<UnoLobbyRoom[]>([]);
  const [room, setRoom] = useState<UnoRoomView | null>(null);
  const [draft, setDraft] = useState<SettingsDraft>(() => draftFromCatalog(null));
  const [botCount, setBotCount] = useState(0);
  const [botLevel, setBotLevel] = useState('normal');
  const [joinId, setJoinId] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // 断线前先把「建房 / 加入」的意图记下来，连接建立后立刻发出去。
  const pendingMessage = useRef<OutgoingMessage | null>(null);
  // 建房时选的机器人数量：房间建好后连续请几位机器人（服务端一次只加一个）。
  const pendingBots = useRef<{ count: number; level: string } | null>(null);
  const draftTouched = useRef(false);

  // 用 ref 保存最新的连接状态与发送函数，让 send() 不必随连接状态重建。
  const isConnectedRef = useRef(false);
  const sendRef = useRef<(message: OutgoingMessage) => void>(() => {});

  const wsUrl = getWsUrl('/ws?uno=1');
  const refreshRooms = useCallback(async () => {
    try { setRooms(await fetchUnoRooms()); } catch { /* 大厅列表失败不阻塞主流程 */ }
  }, []);

  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    const message = { type, payload };
    if (isConnectedRef.current) sendRef.current(message);
    else pendingMessage.current = message;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.ok) setUsername((await response.json()).username || null);
      } catch { /* 账户名只是展示用 */ }
    })();
    void (async () => {
      try {
        const body = await fetchUnoCatalog();
        setCatalog(body);
        if (!draftTouched.current) {
          setDraft(draftFromCatalog(body));
          setBotCount(body.turnDefaults?.bots ?? 0);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '读取牌库失败。');
      }
    })();
  }, []);

  // 大厅列表轮询（已经在房间里就不用刷了）
  useEffect(() => {
    if (room) return;
    void refreshRooms();
    const timer = window.setInterval(() => void refreshRooms(), 5000);
    return () => window.clearInterval(timer);
  }, [room, refreshRooms]);

  // 邀请链接 /tools/uno?room=123456 直接预填房间号
  useEffect(() => {
    const roomId = new URLSearchParams(window.location.search).get('room');
    if (roomId && /^\d{6}$/.test(roomId)) setJoinId(roomId);
  }, []);

  const { isConnected, sendMessage } = useWebSocket(wsUrl, {
    onOpen: () => {
      const pending = pendingMessage.current;
      pendingMessage.current = null;
      if (pending) sendMessage(pending);
    },
    onMessage: (message) => {
      if (message.type === 'ROOM_STATE') {
        setRoom(message.payload as UnoRoomView);
        setBusy(false);
        const bots = pendingBots.current;
        if (bots && bots.count > 0) {
          pendingBots.current = null;
          for (let index = 0; index < bots.count; index += 1) sendMessage({ type: 'ADD_BOT', payload: { level: bots.level } });
        }
      } else if (message.type === 'ROOM_CLOSED') {
        setNotice(message.payload?.reason || '房间已关闭。');
        setRoom(null);
        setBusy(false);
        void refreshRooms();
      } else if (message.type === 'ERROR') {
        setNotice(message.payload?.message || '操作失败。');
        setBusy(false);
      }
    },
    onClose: () => setBusy(false),
  });

  isConnectedRef.current = isConnected;
  sendRef.current = sendMessage;

  // 房间里每 30 秒发一次心跳：既保活，也让服务端知道这个房间还有人在。
  useEffect(() => {
    if (!isConnected || !room) return;
    const timer = window.setInterval(() => sendMessage({ type: 'PING', payload: {} }), 30000);
    return () => window.clearInterval(timer);
  }, [isConnected, room, sendMessage]);

  const createRoom = () => {
    setNotice('');
    setBusy(true);
    pendingBots.current = botCount > 0 ? { count: botCount, level: botLevel } : null;
    send('CREATE_ROOM', { ...draft, expansions: [] });
  };

  const joinRoom = (roomId?: string) => {
    const id = (roomId || joinId).trim();
    if (!/^\d{6}$/.test(id)) { setNotice('房间号是 6 位数字。'); return; }
    setNotice('');
    setBusy(true);
    pendingBots.current = null;
    send('JOIN_ROOM', { roomId: id });
  };

  const leaveRoom = () => {
    send('LEAVE_ROOM');
    setRoom(null);
    setBusy(false);
    void refreshRooms();
  };

  return (
    <main className="min-h-screen bg-[#06091a] text-slate-100">
      <ToolHeader className="border-white/[.08] bg-[#080c20]/85" textClassName="text-slate-400 hover:text-white" />
      <div className="mx-auto max-w-[1200px] px-4 pb-14 pt-6 sm:px-6 lg:px-8">
        <section className="flex flex-col gap-3 border-b border-white/[.09] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className={`items-center gap-2 text-xs font-semibold tracking-[.22em] text-amber-200/80 ${room ? 'hidden [@media(min-width:640px)_and_(min-height:521px)]:flex' : 'flex'}`}>
              <span className="h-px w-8 bg-amber-300" /> UNO ONLINE TABLE
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-4xl">
              UNO 联机牌桌{' '}
              <span className="bg-gradient-to-r from-amber-300 via-rose-300 to-sky-300 bg-clip-text text-transparent">/ UNO TABLE</span>
            </h1>
            <p className={`mt-2 max-w-2xl text-sm leading-6 text-slate-400 ${room ? 'hidden [@media(min-width:640px)_and_(min-height:521px)]:block' : ''}`}>
              {username ? `${username}，` : ''}建房或用 6 位房间号加入朋友的房间，2~4 人、可以请机器人陪打。
              掉线或思考超时后由机器人托管，回来点一下「收回」就能接着打，手牌与进度都保留。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded-full px-3 py-1 font-bold ${isConnected ? 'bg-emerald-400/15 text-emerald-200' : 'bg-white/[.08] text-slate-300'}`}>
              {isConnected ? '实时通道已连接' : '实时通道连接中…'}
            </span>
            {room && <span className="rounded-full bg-white/[.08] px-3 py-1 font-bold text-slate-200">房间 {room.roomId}</span>}
          </div>
        </section>

        <div className="mt-5">
          {!catalog ? (
            <p className="rounded-3xl border border-white/[.1] bg-white/[.03] px-5 py-10 text-center text-sm text-slate-400">正在读取牌库…</p>
          ) : !room ? (
            <UnoLobby
              catalog={catalog}
              rooms={rooms}
              notice={notice}
              busy={busy}
              connected={isConnected}
              draft={draft}
              onDraftChange={(next) => { draftTouched.current = true; setDraft(next); }}
              botCount={botCount}
              botLevel={botLevel}
              onBotCountChange={setBotCount}
              onBotLevelChange={setBotLevel}
              joinId={joinId}
              onJoinIdChange={setJoinId}
              onCreate={createRoom}
              onJoin={joinRoom}
              onRefresh={() => void refreshRooms()}
            />
          ) : room.phase === 'waiting' ? (
            <WaitingRoomPanel
              room={room}
              catalog={catalog}
              busy={busy}
              onAddBot={(level) => send('ADD_BOT', { level })}
              onRemoveBot={(seat) => send('REMOVE_BOT', { seat })}
              onUpdateSettings={(next) => { setBusy(true); send('UPDATE_SETTINGS', { ...next }); }}
              onStart={() => { setBusy(true); send('START_GAME'); }}
              onLeave={leaveRoom}
              onDelete={() => send('DELETE_ROOM')}
            />
          ) : (
            <UnoTable
              room={room}
              catalog={catalog}
              notice={notice}
              onPlay={(cardId, color) => { setNotice(''); send('PLAY_CARD', color ? { cardId, color } : { cardId }); }}
              onDraw={() => send('DRAW_CARD')}
              onPass={() => send('PASS')}
              onChooseColor={(color) => send('CHOOSE_COLOR', { color })}
              onCallUno={() => send('CALL_UNO')}
              onChallenge={(seat) => send('CHALLENGE_UNO', { targetSeat: seat })}
              onTogglePilot={(on) => send('SET_AUTO_PILOT', { on })}
              onRematch={() => { setBusy(true); send('REMATCH'); }}
              onLeave={leaveRoom}
              onDelete={() => send('DELETE_ROOM')}
            />
          )}
        </div>

        <UnoProgress compact />
      </div>
    </main>
  );
}