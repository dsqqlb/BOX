'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  frontline: { label: '前线', hint: '共享前线：双方单位在此交战' },
  support: { label: '支援阵线', hint: '部署单位与总部' },
  deck: { label: '牌库', hint: '抽牌来源' },
  discard: { label: '墓地', hint: '弃置/阵亡' },
};

function action(send: (message: { type: string; payload: unknown }) => void, roomId: string | undefined, payload: Record<string, unknown>) {
  if (!roomId) return;
  send({ type: 'ACTION', payload: { roomId, ...payload } });
}

function BattleTableInner({ catalog, mode, initialRoomId, deckCards, onExit, onRetry }: BattleTableProps & { onRetry: () => void }) {
  const cardMap = useMemo(() => buildCardMap(catalog.cards), [catalog]);
  const [room, setRoom] = useState<KardsRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [leftNotice, setLeftNotice] = useState<string | null>(null);

  // 与先攻追踪器共用 /ws 通道（?kards=1 区分协议），保证代理/隧道只需转发 /ws 一个路径。
  const wsUrl = typeof window === 'undefined' ? '' : getWsUrl('/ws?kards=1');
  const { isConnected, sendMessage, disconnect } = useWebSocket(wsUrl, {
    onOpen: () => {
      setConnectionError(null);
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
    onError: () => {
      setConnectionError(
        '无法连接对战服务器：请确认服务已重启（server/index.js 不支持热更新）、账号拥有 kards 权限，且当前网络可访问 WebSocket。',
      );
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

  function renderZone(seat: number, zone: KardsZone, mode: 'row' | 'stack', accent = false) {
    // 前线是共享行：双方单位都在这一行里；其余区域按座位过滤。
    const zoneCards = zone === 'frontline'
      ? (room?.cards || []).filter((card) => card.zone === 'frontline').sort((a, b) => a.order - b.order)
      : (cardsBySeatZone[seat]?.[zone] || []);
    const zoneInfo = ZONE_LABELS[zone] || { label: zone, hint: '' };
    const isMine = seat === mySeat;
    const isDeck = zone === 'deck';
    const canDrop = zone === 'frontline' ? true : isMine;
    const dropProps = {
      onDragOver: (event: React.DragEvent) => {
        if (canDrop) event.preventDefault();
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const cardId = event.dataTransfer.getData('text/plain');
        if (canDrop && cardId) cardAction({ action: 'MOVE', cardId, zone });
      },
    };
    const borderClass = accent
      ? 'border-amber-500/30 bg-gradient-to-b from-zinc-900/70 to-zinc-950/70 hover:border-amber-400/60'
      : canDrop
        ? 'border-zinc-700/80 bg-zinc-900/40 hover:border-amber-500/40'
        : 'border-zinc-800/60 bg-zinc-950/30';

    const header = (
      <div className="mb-1 flex items-center justify-between gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
        <span className={`truncate ${accent ? 'text-amber-400/90' : ''}`}>{zoneInfo.label}</span>
        <span className={`shrink-0 rounded-full px-1.5 text-[10px] ${zoneCards.length ? 'bg-zinc-800 text-zinc-400' : 'text-zinc-700'}`}>{zoneCards.length}</span>
      </div>
    );

    if (mode === 'row') {
      return (
        <div {...dropProps} className={`flex min-h-[104px] min-w-0 flex-col rounded-lg border p-1.5 transition ${borderClass}`}>
          {header}
          <div className="flex min-h-0 flex-1 items-start gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
            {zoneCards.map((card) => renderCard(card, 'md'))}
            {zoneCards.length === 0 && (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-700">{zoneInfo.hint}</div>
            )}
          </div>
        </div>
      );
    }

    // stack：牌库/墓地/HQ 的叠放样式，最多展示最近 3 张
    const visible = zoneCards.slice(-3);
    return (
      <div {...dropProps} className={`flex flex-col rounded-lg border p-1.5 transition ${borderClass}`}>
        {header}
        <div className="relative h-[96px] w-full">
          {visible.map((card, index) => (
            <div
              key={card.id}
              className="absolute left-0 right-0"
              style={{ top: index * 6, transform: `rotate(${(index - 1) * 2}deg)`, zIndex: index }}
            >
              {renderCard(card, 'sm')}
            </div>
          ))}
          {zoneCards.length === 0 && (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-700">{zoneInfo.hint}</div>
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

  function renderHand(seat: number) {
    const isMine = seat === mySeat;
    const handCards = cardsBySeatZone[seat]?.hand || [];
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto py-0.5" style={{ scrollbarWidth: 'thin' }}>
        <span className={`shrink-0 text-[10px] uppercase tracking-wider ${isMine ? 'text-zinc-600' : 'text-zinc-700'}`}>
          手牌 {handCards.length}
        </span>
        {handCards.map((card) => renderCard(card, 'md'))}
        {handCards.length === 0 && isMine && (
          <span className="text-[10px] text-zinc-700">空（点牌库「抽 1」或把牌拖回来）</span>
        )}
      </div>
    );
  }

  function renderSupportRow(seat: number) {
    const isMine = seat === mySeat;
    const player = seat === mySeat ? myPlayer : opponentPlayer;
    const turnActive = room ? room.turnSeat === seat : false;
    const kredits = room?.kredits[seat];
    return (
      <div className={`rounded-lg border p-1.5 transition ${turnActive ? 'border-amber-500/40 bg-amber-500/[0.03]' : 'border-zinc-800 bg-zinc-950/40'}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${player?.connected ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
          <span className={`font-semibold ${isMine ? 'text-zinc-100' : 'text-zinc-300'}`}>
            {isMine ? '你' : (player?.username || '等待加入…')}
          </span>
          {turnActive && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">行动中</span>}
          {kredits && (
            <span className="ml-auto flex items-center gap-1.5">
              {isMine ? (
                <>
                  <button onClick={() => cardAction({ action: 'KREDITS', delta: -1 })} className="h-6 w-6 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-red-500/60 hover:text-red-400">−</button>
                  <span className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 font-mono text-sm font-bold text-amber-400">
                    {kredits.current}<span className="text-[10px] text-zinc-500">/{kredits.max}</span>
                  </span>
                  <button onClick={() => cardAction({ action: 'KREDITS', delta: 1 })} className="h-6 w-6 rounded-md border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-emerald-500/60 hover:text-emerald-400">+</button>
                </>
              ) : (
                <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 font-mono text-sm font-bold text-zinc-300">
                  {kredits.current}<span className="text-[10px] text-zinc-600">/{kredits.max}</span>
                </span>
              )}
            </span>
          )}
        </div>
        <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-2">
          {renderZone(seat, 'hq', 'stack')}
          {renderZone(seat, 'support', 'row')}
        </div>
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
          <span className="hidden text-zinc-600 xl:inline">右键卡牌 → 操作 · 双击翻面 · 拖拽移动</span>
          {leftNotice && <span className="text-amber-400">{leftNotice}</span>}
          <button onClick={copyRoomLink} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-amber-500/50 hover:text-amber-300">复制房间链接</button>
          {mySeat === 0 && (
            <button onClick={destroyRoom} className="rounded-md border border-red-900/70 bg-red-950/40 px-2.5 py-1.5 text-red-300 transition hover:border-red-500 hover:text-red-200">解散</button>
          )}
          <button onClick={leaveRoom} className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100">退出</button>
        </div>
      </div>

      {connectionError && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300">
          <span>⚠️ {connectionError}</span>
          <button onClick={onRetry} className="rounded-md border border-red-700 px-3 py-1.5 text-xs hover:bg-red-900/40">重新连接</button>
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-center text-sm text-red-300">
          {error}
          <button onClick={onExit} className="ml-3 rounded-md border border-red-800 px-2.5 py-1 text-xs hover:bg-red-900/40">返回</button>
        </div>
      )}

      {!room && !error && !connectionError && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
          {isConnected ? (mode === 'join' ? '正在加入房间…' : '正在创建房间…') : '正在连接对战服务器…'}
        </div>
      )}

      {room && (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
          {renderHand(opponentSeat)}
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_96px] gap-2">
            {/* 中间三条横排：敌方支援阵线 / 共享前线 / 我方支援阵线 */}
            <div className="flex min-h-0 flex-col gap-2">
              {renderSupportRow(opponentSeat)}
              {renderZone(mySeat, 'frontline', 'row', true)}
              {renderSupportRow(mySeat)}
            </div>
            {/* 右侧：双方牌库与墓地 */}
            <div className="flex flex-col justify-between gap-2">
              <div className="flex flex-col gap-2">
                {renderZone(opponentSeat, 'deck', 'stack')}
                {renderZone(opponentSeat, 'discard', 'stack')}
              </div>
              <div className="flex flex-col gap-2">
                {renderZone(mySeat, 'deck', 'stack')}
                {renderZone(mySeat, 'discard', 'stack')}
              </div>
            </div>
          </div>
          {renderHand(mySeat)}
          {room.log.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto rounded-lg border border-zinc-800/70 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-500" style={{ scrollbarWidth: 'thin' }}>
              <span className="shrink-0 text-zinc-600">操作记录</span>
              {room.log.slice(0, 12).map((entry, index) => (
                <span key={`${entry.at}-${index}`} className="shrink-0 rounded-full bg-zinc-900 px-2 py-0.5">
                  {entry.seat === mySeat ? '你' : '对手'}: {entry.text}
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

export default function BattleTable(props: BattleTableProps) {
  const [session, setSession] = useState(0);
  return <BattleTableInner key={session} {...props} onRetry={() => setSession((s) => s + 1)} />;
}
