'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocket, getWsUrl } from '@/lib/useWebSocket';
import { KardsCatalog, KardsRoomCard, KardsRoomState, KardsZone } from '@/lib/kards/types';
import { buildCardMap } from '@/lib/kards/catalog';
import CardImage from './CardImage';

interface BattleTableProps {
  catalog: KardsCatalog;
  mode: 'create' | 'join';
  initialRoomId?: string | null;
  deckCards: string[];
  onExit: () => void;
}

interface CardMenu {
  cardId: string;
  x: number;
  y: number;
}

const ZONE_LABELS: Record<string, { label: string; hint: string }> = {
  hq: { label: 'HQ', hint: '指挥部' },
  frontline: { label: '前线', hint: '单位在此攻防' },
  support: { label: '支援行', hint: '支援与命令' },
  deck: { label: '牌库', hint: '抽牌来源' },
  discard: { label: '墓地', hint: '弃置/阵亡' },
};

function action(send: (message: { type: string; payload: unknown }) => void, roomId: string | undefined, payload: Record<string, unknown>) {
  if (!roomId) return;
  send({ type: 'ACTION', payload: { roomId, ...payload } });
}

export default function BattleTable({ catalog, mode, initialRoomId, deckCards, onExit }: BattleTableProps) {
  const cardMap = useMemo(() => buildCardMap(catalog.cards), [catalog]);
  const [room, setRoom] = useState<KardsRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [leftNotice, setLeftNotice] = useState<string | null>(null);

  const wsUrl = typeof window === 'undefined' ? '' : getWsUrl('/ws/kards');
  const { isConnected, sendMessage, disconnect } = useWebSocket(wsUrl, {
    onOpen: () => {
      if (mode === 'create') {
        sendMessage({ type: 'CREATE_ROOM', payload: { deckCards } });
      } else {
        sendMessage({ type: 'JOIN_ROOM', payload: { roomId: initialRoomId, deckCards } });
      }
    },
    onMessage: (message) => {
      if (message.type === 'ROOM_STATE') {
        setRoom(message.payload as KardsRoomState);
        setError(null);
      } else if (message.type === 'ERROR') {
        setError((message.payload as { message?: string }).message || '发生错误');
      } else if (message.type === 'ROOM_CLOSED') {
        setRoom(null);
        setError('房间已解散。');
      }
    },
    onClose: () => {
      setLeftNotice('连接已断开，请刷新页面重连');
    },
  });

  const roomId = room?.roomId;

  const send = useCallback(
    (message: { type: string; payload: unknown }) => sendMessage(message),
    [sendMessage],
  );

  useEffect(() => {
    if (!menu) return;
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-card-menu]')) setMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menu]);

  const mySeat = room?.seat ?? 0;
  const opponentSeat = 1 - mySeat;
  const myPlayer = room?.players.find((player) => player.seat === mySeat);
  const opponentPlayer = room?.players.find((player) => player.seat === opponentSeat);
  const myTurn = room ? room.turnSeat === mySeat : false;

  const cardsBySeatZone = useMemo(() => {
    const result: Record<number, Record<string, KardsRoomCard[]>> = { 0: {}, 1: {} };
    for (const card of room?.cards || []) {
      const zone = card.zone;
      if (!result[card.owner][zone]) result[card.owner][zone] = [];
      result[card.owner][zone].push(card);
    }
    for (const seat of [0, 1]) {
      for (const key of Object.keys(result[seat])) {
        result[seat][key].sort((a, b) => a.order - b.order);
      }
    }
    return result;
  }, [room]);

  function openMenu(event: React.MouseEvent, card: KardsRoomCard) {
    event.preventDefault();
    if (card.hidden || card.owner !== mySeat) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ cardId: card.id, x: Math.min(event.clientX, window.innerWidth - 170), y: Math.min(event.clientY, window.innerHeight - 300) });
  }

  function cardAction(payload: Record<string, unknown>) {
    action(send, roomId, payload);
  }

  function copyRoomLink() {
    if (!roomId || typeof window === 'undefined') return;
    navigator.clipboard?.writeText(`${window.location.origin}/tools/kards?room=${roomId}`).catch(() => undefined);
    setLeftNotice('房间链接已复制');
    window.setTimeout(() => setLeftNotice(null), 2000);
  }

  function leaveRoom() {
    if (roomId) send({ type: 'LEAVE_ROOM', payload: { roomId } });
    disconnect();
    onExit();
  }

  function destroyRoom() {
    if (!roomId || !window.confirm('解散房间？双方都会被移出。')) return;
    send({ type: 'DELETE_ROOM', payload: { roomId } });
    disconnect();
    onExit();
  }

  function resetTable() {
    if (!roomId || !window.confirm('重置桌面：所有牌回到牌库并洗牌，kredits 归零。确认？')) return;
    cardAction({ action: 'RESET_TABLE' });
  }

  function renderCard(card: KardsRoomCard, size: 'sm' | 'md') {
    const meta = card.cardId ? cardMap.get(card.cardId) : null;
    const widthClass = size === 'md' ? 'w-16 md:w-20' : 'w-12 md:w-14';
    const isMine = card.owner === mySeat;
    return (
      <div
        key={card.id}
        draggable={isMine && !card.hidden}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', card.id);
          event.dataTransfer.effectAllowed = 'move';
        }}
        onDoubleClick={() => {
          if (isMine && !card.hidden) cardAction({ action: 'FLIP', cardId: card.id });
        }}
        onContextMenu={(event) => openMenu(event, card)}
        className={`group relative shrink-0 ${widthClass} transition ${isMine && !card.hidden ? 'cursor-grab hover:z-20 hover:-translate-y-1 active:cursor-grabbing' : ''}`}
        title={card.hidden ? '对方的手牌/牌库（保密）' : `${meta?.name || '未知卡牌'}${card.faceDown ? '（背面）' : ''}`}
      >
        <CardImage path={meta?.path} name={meta?.name} faceDown={card.faceDown || card.hidden} className={card.rotated && !card.hidden ? 'rotate-90 scale-[0.72]' : ''} />
        {!card.hidden && card.damage > 0 && (
          <span className="absolute -right-1 -top-1 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-950 bg-red-600 px-1 text-[11px] font-bold text-white shadow">
            {card.damage}
          </span>
        )}
        {!card.hidden && !card.faceDown && card.rotated && (
          <span className="absolute -left-1 bottom-1 rounded bg-sky-600/90 px-1 text-[9px] font-bold text-white">攻</span>
        )}
      </div>
    );
  }

  function renderZone(seat: number, zone: KardsZone, compact = false) {
    const zoneCards = cardsBySeatZone[seat]?.[zone] || [];
    const zoneInfo = ZONE_LABELS[zone] || { label: zone, hint: '' };
    const isMine = seat === mySeat;
    const isDeck = zone === 'deck';
    return (
      <div
        onDragOver={(event) => {
          if (isMine) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const cardId = event.dataTransfer.getData('text/plain');
          if (isMine && cardId) cardAction({ action: 'MOVE', cardId, zone });
        }}
        className={`flex min-h-[92px] min-w-[104px] flex-1 flex-col rounded-lg border p-1.5 transition ${isMine ? 'border-zinc-700/80 bg-zinc-900/40 hover:border-amber-500/40' : 'border-zinc-800/60 bg-zinc-950/30'} ${compact ? 'min-w-[88px]' : ''}`}
      >
        <div className="mb-1 flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="truncate">{zoneInfo.label}</span>
          <span className="shrink-0 text-zinc-600">{zoneCards.length}</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-wrap content-start items-start gap-1.5">
          {zoneCards.map((card) => renderCard(card, compact ? 'sm' : 'md'))}
          {zoneCards.length === 0 && (
            <div className="flex h-full w-full items-center justify-center py-2 text-[10px] text-zinc-700">{zoneInfo.hint}</div>
          )}
        </div>
        {isDeck && isMine && (
          <button
            onClick={() => cardAction({ action: 'DRAW', count: 1 })}
            className="mt-1 rounded border border-zinc-700 bg-zinc-900 py-0.5 text-[10px] text-zinc-400 transition hover:border-amber-500/50 hover:text-amber-300"
          >
            抽 1
          </button>
        )}
      </div>
    );
  }

  function renderSide(seat: number, position: 'top' | 'bottom') {
    const isMine = seat === mySeat;
    const player = seat === mySeat ? myPlayer : opponentPlayer;
    const turnActive = room ? room.turnSeat === seat : false;
    const kredits = room?.kredits[seat];
    const handCards = cardsBySeatZone[seat]?.hand || [];
    const isOpponentHand = !isMine;

    return (
      <div className={`relative flex flex-col gap-2 rounded-xl border p-2.5 ${turnActive ? 'border-amber-500/50 bg-amber-500/[0.04]' : 'border-zinc-800 bg-zinc-950/50'}`}>
        <div className="flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${player?.connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          <span className={`font-semibold ${isMine ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {isMine ? '你' : (player?.username || '等待加入…')}
          </span>
          {turnActive && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">行动中</span>}
          {isMine && kredits && (
            <span className="ml-auto flex items-center gap-1.5">
              <button onClick={() => cardAction({ action: 'KREDITS', delta: -1 })} className="h-6 w-6 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-red-500/60 hover:text-red-400">−</button>
              <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-sm font-bold text-amber-400">
                {kredits.current}<span className="text-[10px] text-zinc-500">/{kredits.max}</span>
              </span>
              <button onClick={() => cardAction({ action: 'KREDITS', delta: 1 })} className="h-6 w-6 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-400">+</button>
            </span>
          )}
          {!isMine && kredits && (
            <span className="ml-auto rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-sm font-bold text-zinc-300">
              {kredits.current}<span className="text-[10px] text-zinc-600">/{kredits.max}</span>
            </span>
          )}
        </div>

        {handCards.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
            <span className="shrink-0 text-[10px] uppercase tracking-wider text-zinc-600">手牌 {handCards.length}</span>
            {handCards.map((card) => renderCard(card, 'md'))}
          </div>
        )}

        <div className="flex gap-2">
          {renderZone(seat, 'hq')}
          {renderZone(seat, 'frontline')}
          {renderZone(seat, 'support')}
          {renderZone(seat, 'deck')}
          {renderZone(seat, 'discard')}
        </div>
        {position === 'bottom' && isMine && handCards.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-800 py-2 text-center text-[11px] text-zinc-600">
            手牌区（点牌库的「抽 1」，或拖拽牌库顶牌到此）
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* 顶栏 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-amber-400">{roomId || '------'}</span>
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          <span className="text-xs text-zinc-500">{isConnected ? '已连接' : '连接中…'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button onClick={() => cardAction({ action: 'DRAW', count: 1 })} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">抽 1</button>
          <button onClick={() => cardAction({ action: 'DRAW', count: 3 })} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">抽 3</button>
          <button onClick={() => cardAction({ action: 'DRAW', count: 7 })} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">抽 7</button>
          <button onClick={() => cardAction({ action: 'SHUFFLE' })} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">洗牌</button>
          <button onClick={() => cardAction({ action: 'PASS_TURN' })} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">移交回合</button>
          <button onClick={resetTable} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-red-500/50 hover:text-red-400">重置桌面</button>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs">
          <span className="hidden text-zinc-600 md:inline">右键卡牌 → 操作 · 双击翻面 · 拖拽移动</span>
          {leftNotice && <span className="text-amber-400">{leftNotice}</span>}
          <button onClick={copyRoomLink} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">复制房间链接</button>
          {mySeat === 0 && (
            <button onClick={destroyRoom} className="rounded-md border border-red-900/70 bg-red-950/40 px-2.5 py-1.5 text-red-300 transition hover:border-red-500 hover:text-red-200">解散</button>
          )}
          <button onClick={leaveRoom} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">退出</button>
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-center text-sm text-red-300">
          {error}
          <button onClick={onExit} className="ml-3 rounded-md border border-red-800 px-2.5 py-1 text-xs hover:bg-red-900/40">返回</button>
        </div>
      )}

      {!room && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          {isConnected ? (mode === 'join' ? '正在加入房间…' : '正在创建房间…') : '正在连接对战服务器…'}
        </div>
      )}

      {room && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
          {renderSide(opponentSeat, 'top')}
          {renderSide(mySeat, 'bottom')}
          {room.log.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-500" style={{ scrollbarWidth: 'thin' }}>
              <span className="shrink-0 text-zinc-600">操作记录</span>
              {room.log.slice(0, 12).map((entry, index) => (
                <span key={`${entry.at}-${index}`} className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5">
                  {entry.seat === mySeat ? '你' : `对手`}: {entry.text}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 右键菜单 */}
      {menu && room && (
        <div
          data-card-menu
          className="fixed z-50 w-40 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/95 py-1 text-xs text-zinc-200 shadow-2xl shadow-black/60 backdrop-blur"
          style={{ left: menu.x, top: menu.y }}
        >
          {[
            { label: '翻面 / 翻开', payload: { action: 'FLIP', cardId: menu.cardId } },
            { label: '旋转（攻/防）', payload: { action: 'ROTATE', cardId: menu.cardId } },
            { label: '伤害 +1', payload: { action: 'DAMAGE', cardId: menu.cardId, delta: 1 } },
            { label: '伤害 −1', payload: { action: 'DAMAGE', cardId: menu.cardId, delta: -1 } },
            { label: '回手牌', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'hand' } },
            { label: '移到前线', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'frontline' } },
            { label: '移到支援行', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'support' } },
            { label: '放上 HQ', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'hq' } },
            { label: '弃置', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'discard' } },
            { label: '放回牌库', payload: { action: 'MOVE', cardId: menu.cardId, zone: 'deck' } },
          ].map((item) => (
            <button
              key={item.label}
              onClick={() => {
                cardAction(item.payload);
                setMenu(null);
              }}
              className="block w-full px-3 py-1.5 text-left transition hover:bg-amber-500/20 hover:text-amber-300"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
