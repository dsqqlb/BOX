'use client';

/**
 * 德州扑克：大厅 → 等待室 → 牌桌。
 * 客户端只负责展示与发指令；发牌、下注合法性、边池与摊牌全部由服务端裁定。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useWebSocket, getWsUrl } from '@/lib/useWebSocket';
import HoldemTable from '@/components/holdem/HoldemTable';
import PokerChip, { CHIP_DENOMINATIONS, formatChips, formatChipValue } from '@/components/holdem/PokerChip';
import {
  BOT_LEVEL_OPTIONS, THINK_SECOND_OPTIONS,
  type HoldemAccount, type HoldemLedgerEntry, type HoldemLobbyRoom, type HoldemRoomView,
} from '@/lib/holdem';

const LEDGER_KIND_LABEL: Record<string, string> = {
  grant: '开户赠送', reset: '模拟筹码补给', 'buy-in': '上桌买入', 'cash-out': '离桌结算', settle: '牌局结算',
};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options?.body ? { 'Content-Type': 'application/json' } : {}), ...(options?.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error || '请求失败，请稍后重试。');
  return body as T;
}

function SimulatedTopUpModal({ account, onClose, onConfirm }: { account: HoldemAccount | null; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const eligible = Boolean(account?.canReset);
  const refillTarget = account?.startingChips || 0;

  const confirm = async () => {
    if (!eligible || submitting) return;
    setSubmitting(true);
    try { await onConfirm(); onClose(); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end bg-black/75 p-0 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="top-up-title" onMouseDown={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-t-3xl border border-amber-300/35 bg-gradient-to-b from-[#165b3a] to-[#08251a] shadow-2xl sm:rounded-3xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-amber-200/15 px-5 py-4">
          <div><div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-300">Entertainment only</div><h2 id="top-up-title" className="mt-0.5 text-xl font-black text-amber-100">筹码充值中心</h2></div>
          <button onClick={onClose} className="rounded-full p-2 text-2xl leading-none text-emerald-100/70 hover:bg-white/10" aria-label="关闭">×</button>
        </div>
        <div className="p-5">
          <div className="rounded-xl border border-amber-300/30 bg-amber-950/35 px-3 py-2 text-xs leading-5 text-amber-100"><strong>模拟支付演示：</strong>这里不会连接支付平台、不会生成订单，也不会扣除任何真实货币；所有筹码都是娱乐虚拟币。</div>
          <div className="mt-4 rounded-2xl border border-amber-300/30 bg-black/25 p-4 text-center"><div className="mx-auto flex w-fit items-center gap-2"><PokerChip value={refillTarget} size={38} /><span className="text-2xl font-black text-amber-100">{formatChips(refillTarget)}</span></div><div className="mt-2 text-sm font-black text-emerald-50">娱乐筹码补给</div><div className="mt-1 text-xs text-emerald-100/60">成功后账户将补足到初始筹码额度</div><div className="mt-3 inline-flex rounded-full bg-amber-400/15 px-3 py-1 text-xs font-black text-amber-200">演示支付 · ¥ 0.00</div></div>
          {!eligible && <p className="mt-3 text-xs leading-5 text-amber-200/80">你的余额还可以继续买入。为防止无限增发，模拟补给只会在余额低于 {formatChips(account?.minBuyIn || 100)} 时开放。</p>}
          <button onClick={() => void confirm()} disabled={!eligible || submitting} className="mt-4 w-full rounded-xl bg-amber-400 py-3 text-sm font-black text-emerald-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-45">{submitting ? '正在完成模拟支付…' : eligible ? '确认模拟支付（不会扣款）' : '当前无需模拟补给'}</button>
        </div>
      </div>
    </div>
  );
}

export default function TexasHoldemPage() {
  const [account, setAccount] = useState<HoldemAccount | null>(null);
  const [ledger, setLedger] = useState<HoldemLedgerEntry[]>([]);
  const [lobby, setLobby] = useState<HoldemLobbyRoom[]>([]);
  const [room, setRoom] = useState<HoldemRoomView | null>(null);
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [showTopUp, setShowTopUp] = useState(false);

  const [smallBlind, setSmallBlind] = useState(25);
  const [bigBlind, setBigBlind] = useState(50);
  const [buyIn, setBuyIn] = useState(2000);
  const buyInRef = useRef(buyIn);
  const [thinkSeconds, setThinkSeconds] = useState<number>(15);
  const [maxSeats, setMaxSeats] = useState(6);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [botLevel, setBotLevel] = useState<string>('normal');
  const [raiseTo, setRaiseTo] = useState(0);
  const [wsActive, setWsActive] = useState(false);
  const pendingIntent = useRef<{ kind: 'create' | 'join'; roomId?: string } | null>(null);
  const wsUrl = wsActive ? getWsUrl('/ws?holdem=1') : null;

  const refreshAccount = useCallback(async () => {
    try { setAccount(await api<HoldemAccount>('/api/holdem/account')); }
    catch (error) { setNotice(error instanceof Error ? error.message : '加载筹码账户失败。'); }
  }, []);
  const refreshLobby = useCallback(async () => {
    try { setLobby((await api<{ rooms: HoldemLobbyRoom[] }>('/api/holdem/rooms')).rooms); }
    catch { /* 大厅列表失败不阻塞主流程 */ }
  }, []);

  useEffect(() => { void refreshAccount(); void refreshLobby(); }, [refreshAccount, refreshLobby]);
  useEffect(() => {
    if (room) return;
    const timer = window.setInterval(() => void refreshLobby(), 5000);
    return () => window.clearInterval(timer);
  }, [room, refreshLobby]);

  const { isConnected, sendMessage } = useWebSocket(wsUrl, {
    onOpen: () => {
      setConnecting(false);
      const intent = pendingIntent.current;
      if (!intent) return;
      if (intent.kind === 'create') sendMessage({ type: 'CREATE_ROOM', payload: { smallBlind, bigBlind, buyIn: buyInRef.current, thinkSeconds, maxSeats } });
      else sendMessage({ type: 'JOIN_ROOM', payload: { roomId: intent.roomId } });
      pendingIntent.current = null;
    },
    onMessage: (message) => {
      if (message.type === 'ROOM_STATE') { setRoom(message.payload as HoldemRoomView); setNotice(''); }
      else if (message.type === 'ROOM_CLOSED') { setNotice(message.payload?.reason || '房间已关闭。'); setRoom(null); setWsActive(false); void refreshAccount(); void refreshLobby(); }
      else if (message.type === 'ERROR') setNotice(message.payload?.message || '操作失败。');
    },
    onClose: () => { setConnecting(false); },
  });

  useEffect(() => {
    if (!isConnected || !room) return;
    const timer = window.setInterval(() => sendMessage({ type: 'PING', payload: {} }), 30000);
    return () => window.clearInterval(timer);
  }, [isConnected, room, sendMessage]);

  const myHandPlayer = room?.hand?.players.find((player) => player.seat === room.seat) || null;
  const legal = room?.hand?.legal || null;
  const isMyTurn = Boolean(legal && room?.hand && !room.hand.complete);
  const mySeat = room?.seats.find((seat) => seat.seat === room.seat) || null;
  useEffect(() => { if (legal) setRaiseTo(legal.minRaiseTo); }, [legal?.seat, legal?.minRaiseTo, room?.hand?.street, room?.hand?.handNumber]);

  const normalizeBuyIn = (value: number) => Math.min(10000000, Math.max(Math.max(100, bigBlind * 2), Math.trunc(value || 0)));
  const commitBuyIn = (value: number) => {
    const normalized = normalizeBuyIn(value);
    buyInRef.current = normalized;
    setBuyIn(normalized);
    return normalized;
  };
  const startCreate = () => {
    if (!account) return;
    const requestedBuyIn = commitBuyIn(buyIn);
    if (requestedBuyIn > account.chips) { setNotice(`买入 ${formatChips(requestedBuyIn)} 超过账户余额 ${formatChips(account.chips)}。`); return; }
    setNotice(''); setConnecting(true); pendingIntent.current = { kind: 'create' }; setWsActive(true);
  };
  const startJoin = (roomId: string) => {
    if (!/^\d{6}$/.test(roomId)) { setNotice('请输入 6 位房间号。'); return; }
    setNotice(''); setConnecting(true); pendingIntent.current = { kind: 'join', roomId }; setWsActive(true);
  };
  const act = (action: string, amount?: number) => { if (room) sendMessage({ type: 'ACTION', payload: { roomId: room.roomId, action, amount } }); };
  const leaveTable = () => {
    if (!room) return;
    sendMessage({ type: room.isHost ? 'DELETE_ROOM' : 'LEAVE_ROOM', payload: { roomId: room.roomId } });
    setRoom(null); setWsActive(false); window.setTimeout(() => { void refreshAccount(); void refreshLobby(); }, 400);
  };
  const openLedger = async () => {
    setShowLedger(true);
    try { setLedger((await api<{ entries: HoldemLedgerEntry[] }>('/api/holdem/ledger')).entries); }
    catch (error) { setNotice(error instanceof Error ? error.message : '加载流水失败。'); }
  };
  const resetChips = async () => {
    try {
      setAccount(await api<HoldemAccount>('/api/holdem/account', { method: 'POST', body: JSON.stringify({ action: 'reset' }) }));
      setNotice('模拟支付已完成：已补充娱乐虚拟筹码。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '模拟补给失败。'); }
  };
  const raiseChipButtons = useMemo(() => legal ? CHIP_DENOMINATIONS.filter((denomination) => denomination <= legal.maxRaiseTo) : [], [legal?.maxRaiseTo]);
  const clampRaise = (value: number) => legal ? Math.max(legal.minRaiseTo, Math.min(Math.round(value), legal.maxRaiseTo)) : 0;

  if (!room) return (
    <main className="min-h-screen bg-gradient-to-b from-[#0b2f1f] via-[#08251a] to-[#04140e] text-emerald-50">
      <header className="sticky top-0 z-30 border-b border-emerald-900/60 bg-[#08251a]/90 backdrop-blur"><div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6"><Link href="/" className="text-sm text-emerald-200/70 transition-colors hover:text-amber-300">← 返回首页</Link><span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black tracking-widest text-amber-200">TEXAS HOLD&apos;EM</span></div></header>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <section className="relative overflow-hidden rounded-3xl border-4 border-amber-900/50 p-6 shadow-2xl sm:p-8" style={{ background: 'radial-gradient(ellipse at 30% 20%, #1f7a4d 0%, #14663f 45%, #0a3d24 100%)' }}>
          <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-black tracking-tight text-amber-100 sm:text-4xl">德州扑克 ♠️</h1><p className="mt-2 max-w-xl text-sm text-emerald-50/80">服务端权威发牌与结算，可开房联机，也可以叫机器人陪你打。筹码与账户绑定，是纯娱乐虚拟筹码。</p></div>
            <div className="rounded-2xl border border-amber-300/25 bg-black/35 p-4 text-right backdrop-blur"><div className="text-[10px] font-black uppercase tracking-[0.25em] text-emerald-100/60">我的筹码</div><div className="mt-1 flex items-center justify-end gap-2"><PokerChip value={1000} size={30} /><span className="text-3xl font-black tabular-nums text-amber-200">{account ? formatChips(account.chips) : '—'}</span></div>{account && <div className="mt-1 text-[11px] text-emerald-100/60">共 {account.handsPlayed} 手 · 赢 {account.handsWon} 手</div>}<div className="mt-2 flex justify-end gap-2"><button onClick={openLedger} className="rounded-lg bg-emerald-900/70 px-3 py-1.5 text-xs font-bold text-emerald-100 hover:bg-emerald-800">筹码流水</button><button onClick={() => setShowTopUp(true)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-emerald-950 hover:bg-amber-400">充值</button></div></div>
          </div>
        </section>
        {notice && <div className="mt-4 rounded-xl border border-amber-400/40 bg-amber-950/50 px-4 py-3 text-sm text-amber-100">{notice}</div>}
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-emerald-800/60 bg-black/30 p-5"><h2 className="text-lg font-black text-amber-100">开一张新桌</h2><p className="mt-1 text-xs text-emerald-100/60">盲注、任意合法买入和思考时长都由你决定，建好后在等待室里加机器人。</p>
            <div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-bold text-emerald-100/80">小盲注<input type="number" min={1} value={smallBlind} onChange={(event) => { const value = Math.max(1, Math.trunc(Number(event.target.value) || 1)); setSmallBlind(value); if (bigBlind <= value) setBigBlind(value * 2); }} className="mt-1 w-full rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-amber-400" /></label><label className="text-xs font-bold text-emerald-100/80">大盲注<input type="number" min={smallBlind + 1} value={bigBlind} onChange={(event) => setBigBlind(Math.max(smallBlind + 1, Math.trunc(Number(event.target.value) || smallBlind + 1)))} className="mt-1 w-full rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-amber-400" /></label><label className="text-xs font-bold text-emerald-100/80">买入筹码<input type="number" min={Math.max(100, bigBlind * 2)} max={10000000} step={1} value={buyIn || ''} onChange={(event) => { const value = Math.trunc(Number(event.target.value) || 0); buyInRef.current = value; setBuyIn(value); }} onBlur={(event) => { commitBuyIn(Number(event.currentTarget.value)); }} className="mt-1 w-full rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-amber-400" /><span className="mt-1 block font-normal text-emerald-100/50">任意整数；最低 {formatChips(Math.max(100, bigBlind * 2))}</span></label><label className="text-xs font-bold text-emerald-100/80">座位数<select value={maxSeats} onChange={(event) => setMaxSeats(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-2 text-sm text-emerald-50 outline-none focus:border-amber-400">{[2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 人桌</option>)}</select></label></div>
            <div className="mt-3"><div className="text-xs font-bold text-emerald-100/80">每次思考时长（超时由机器人托管本次决策）</div><div className="mt-2 flex gap-2">{THINK_SECOND_OPTIONS.map((option) => <button key={option} onClick={() => setThinkSeconds(option)} className={`flex-1 rounded-lg px-2 py-2 text-sm font-black transition-colors ${thinkSeconds === option ? 'bg-amber-500 text-emerald-950' : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'}`}>{option} 秒</button>)}</div></div>
            <button onClick={startCreate} disabled={connecting || !account} className="mt-4 w-full rounded-xl bg-amber-500 py-3 font-black text-emerald-950 shadow-lg transition hover:bg-amber-400 disabled:opacity-50">{connecting ? '正在开桌…' : `开桌并买入 ${formatChips(buyIn)}`}</button>
          </section>
          <section className="rounded-2xl border border-emerald-800/60 bg-black/30 p-5"><h2 className="text-lg font-black text-amber-100">加入牌桌</h2><div className="mt-3 flex gap-2"><input value={joinRoomId} onChange={(event) => setJoinRoomId(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位房间号" inputMode="numeric" className="min-w-0 flex-1 rounded-lg border border-emerald-700/60 bg-emerald-950/60 px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-emerald-50 outline-none focus:border-amber-400" /><button onClick={() => startJoin(joinRoomId)} disabled={connecting} className="rounded-lg bg-emerald-600 px-5 py-2.5 font-black text-white hover:bg-emerald-500 disabled:opacity-50">加入</button></div><h3 className="mt-5 text-xs font-black uppercase tracking-widest text-emerald-100/50">正在进行的牌桌</h3><div className="mt-2 max-h-72 space-y-2 overflow-y-auto">{lobby.length === 0 ? <div className="rounded-xl bg-emerald-950/40 py-8 text-center text-sm text-emerald-100/50">目前没有开着的牌桌</div> : lobby.map((entry) => <button key={entry.roomId} onClick={() => startJoin(entry.roomId)} disabled={connecting} className="flex w-full items-center justify-between gap-3 rounded-xl border border-emerald-800/60 bg-emerald-950/50 px-4 py-3 text-left transition hover:border-amber-400/60 hover:bg-emerald-900/50 disabled:opacity-50"><div><div className="font-mono text-xl font-black tracking-wider text-amber-200">{entry.roomId}</div><div className="mt-0.5 text-[11px] text-emerald-100/60">房主 {entry.hostUsername} · 盲注 {entry.smallBlind}/{entry.bigBlind} · 买入 {formatChips(entry.buyIn)} · {entry.seatedCount}/{entry.maxSeats} 人{entry.phase === 'playing' && <span className="text-amber-300"> · 进行中</span>}</div></div><span className="whitespace-nowrap text-sm font-bold text-emerald-300">入座 →</span></button>)}</div></section>
        </div>
      </div>
      {showLedger && <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-0 sm:items-center sm:justify-center sm:p-4" onMouseDown={() => setShowLedger(false)}><div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-emerald-800 bg-[#08251a] p-5 sm:rounded-3xl" onMouseDown={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-lg font-black text-amber-100">筹码流水</h2><button onClick={() => setShowLedger(false)} className="text-2xl text-emerald-200/60">×</button></div><div className="mt-3 space-y-2">{ledger.length === 0 ? <p className="py-8 text-center text-sm text-emerald-100/50">还没有筹码变动记录。</p> : ledger.map((entry) => <div key={entry.id} className="flex items-center justify-between rounded-xl bg-emerald-950/50 px-3 py-2.5 text-sm"><div><div className="font-bold text-emerald-50">{LEDGER_KIND_LABEL[entry.kind] || entry.kind}</div><div className="text-[11px] text-emerald-100/50">{new Date(entry.createdAt).toLocaleString('zh-CN')}{entry.roomId && entry.roomId !== 'pending' ? ` · 房间 ${entry.roomId}` : ''}</div></div><div className="text-right"><div className={`font-black tabular-nums ${entry.delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{entry.delta > 0 ? '+' : ''}{formatChips(entry.delta)}</div><div className="text-[11px] text-emerald-100/50">余额 {formatChips(entry.balance)}</div></div></div>)}</div></div></div>}
      {showTopUp && <SimulatedTopUpModal account={account} onClose={() => setShowTopUp(false)} onConfirm={resetChips} />}
    </main>
  );

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-[#0b2f1f] via-[#08251a] to-[#04140e] text-emerald-50">
      <header className="z-30 shrink-0 border-b border-emerald-900/60 bg-[#08251a]/90 backdrop-blur"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-2.5"><div className="flex min-w-0 items-center gap-2 sm:gap-3"><span className="font-mono text-lg font-black tracking-widest text-amber-200 sm:text-xl">{room.roomId}</span><span className="truncate text-[10px] text-emerald-100/60 sm:text-[11px]">盲注 {room.smallBlind}/{room.bigBlind} · 思考 {room.thinkSeconds}s · {room.isHost ? '你是房主' : `房主 ${room.hostUsername}`}</span>{!isConnected && <span className="rounded bg-rose-500/25 px-2 py-0.5 text-[10px] font-bold text-rose-200">连接中断</span>}</div><div className="flex items-center gap-2"><button onClick={() => navigator.clipboard?.writeText(room.roomId).catch(() => {})} className="rounded-lg bg-emerald-900/70 px-2.5 py-1.5 text-[10px] font-bold text-emerald-100 sm:px-3 sm:text-xs">复制房间号</button><button onClick={leaveTable} className="rounded-lg bg-rose-900/60 px-2.5 py-1.5 text-[10px] font-bold text-rose-100 hover:bg-rose-800 sm:px-3 sm:text-xs">{room.isHost ? '解散并离桌' : '离桌结算'}</button></div></div></header>
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-2 py-2 sm:px-4">
        {notice && <div className="mb-2 shrink-0 rounded-xl border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-xs text-amber-100 sm:text-sm">{notice}</div>}
        <div className="min-h-[12rem] flex-1"><HoldemTable room={room} /></div>
        {room.phase === 'waiting' && <section className="mx-auto mt-2 max-h-[33dvh] w-full max-w-3xl shrink-0 overflow-y-auto rounded-2xl border border-emerald-800/60 bg-black/35 p-3 sm:mt-3 sm:p-4"><div className="flex items-baseline justify-between gap-2"><h2 className="text-base font-black text-amber-100 sm:text-lg">等待室</h2><p className="text-[10px] text-emerald-100/60">满 2 人即可开局</p></div><p className="mt-1 text-[11px] text-emerald-100/60">分享房间号邀请朋友，或添加机器人。</p>{room.isHost ? <><div className="mt-3 flex flex-wrap gap-1.5">{BOT_LEVEL_OPTIONS.map((option) => <button key={option.value} onClick={() => setBotLevel(option.value)} className={`rounded-lg px-2.5 py-1.5 text-xs font-black transition-colors ${botLevel === option.value ? 'bg-sky-500 text-white' : 'bg-emerald-900/60 text-emerald-100 hover:bg-emerald-800'}`}>{option.label}<span className="ml-1 font-medium opacity-70">{option.hint}</span></button>)}</div><div className="mt-2 flex flex-wrap gap-2"><button onClick={() => sendMessage({ type: 'ADD_BOT', payload: { roomId: room.roomId, level: botLevel } })} disabled={!room.seats.some((seat) => seat.empty)} className="rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white hover:bg-sky-500 disabled:opacity-40">＋ 添加机器人</button>{room.seats.filter((seat) => seat.isBot).map((seat) => <button key={seat.seat} onClick={() => sendMessage({ type: 'REMOVE_BOT', payload: { roomId: room.roomId, seat: seat.seat } })} className="rounded-xl bg-emerald-900/60 px-3 py-2 text-xs font-bold text-emerald-100 hover:bg-rose-900/60">移除 {seat.botName} ✕</button>)}</div><button onClick={() => sendMessage({ type: 'START_GAME', payload: { roomId: room.roomId } })} disabled={!room.canStart} className="mt-3 w-full rounded-xl bg-amber-500 py-2.5 text-sm font-black text-emerald-950 shadow-lg transition hover:bg-amber-400 disabled:opacity-40">{room.canStart ? '开始牌局' : '至少需要两位有筹码的玩家'}</button></> : <p className="mt-3 rounded-xl bg-emerald-950/50 px-3 py-2 text-xs text-emerald-100/70">等待房主开始牌局…</p>}{mySeat && mySeat.stack <= 0 && <button onClick={() => sendMessage({ type: 'REBUY', payload: { roomId: room.roomId } })} className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-xs font-black text-white hover:bg-emerald-500">重新买入 {formatChips(room.buyIn)} 筹码</button>}</section>}
        {room.phase === 'playing' && <section className="mx-auto mt-2 max-h-[33dvh] w-full max-w-3xl shrink-0 overflow-y-auto rounded-2xl border border-emerald-800/60 bg-black/40 p-3 sm:mt-3 sm:p-4">{myHandPlayer?.holeCards && <div className="mb-2 text-center text-[11px] text-emerald-100/70">你的手牌 <span className="font-black text-amber-200">{myHandPlayer.holeCards.join(' ')}</span>{myHandPlayer.handDescription && <span className="ml-2 text-yellow-200">（{myHandPlayer.handDescription}）</span>}</div>}{isMyTurn && legal ? <><div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2"><button onClick={() => act('fold')} className="rounded-xl bg-rose-700 px-3 py-2 text-sm font-black text-white hover:bg-rose-600 sm:px-5 sm:py-3">弃牌</button>{legal.canCheck && <button onClick={() => act('check')} className="rounded-xl bg-emerald-700 px-3 py-2 text-sm font-black text-white hover:bg-emerald-600 sm:px-5 sm:py-3">过牌</button>}{legal.canCall && <button onClick={() => act('call')} className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-black text-white hover:bg-emerald-500 sm:px-5 sm:py-3">跟注 {formatChips(legal.toCall)}</button>}{legal.canRaise && !legal.isAllInOnly && <button onClick={() => act('raise', clampRaise(raiseTo))} className="rounded-xl bg-amber-500 px-3 py-2 text-sm font-black text-emerald-950 hover:bg-amber-400 sm:px-5 sm:py-3">加注到 {formatChips(clampRaise(raiseTo))}</button>}<button onClick={() => act('allin')} className="rounded-xl bg-orange-600 px-3 py-2 text-sm font-black text-white hover:bg-orange-500 sm:px-5 sm:py-3">全下 {formatChips(legal.stack)}</button></div>{legal.canRaise && !legal.isAllInOnly && <div className="mt-2 rounded-xl border border-amber-500/25 bg-emerald-950/50 p-2"><div className="flex items-center justify-between text-[10px] text-emerald-100/70"><span>点筹码累加加注额</span><span className="font-black tabular-nums text-amber-200">加注到 {formatChips(clampRaise(raiseTo))}</span></div><div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">{raiseChipButtons.map((denomination) => <button key={denomination} onClick={() => setRaiseTo((current) => clampRaise(current + denomination))} className="transition-transform hover:-translate-y-1 active:translate-y-0" title={`加 ${formatChipValue(denomination)}`}><PokerChip value={denomination} size={34} /></button>)}</div><input type="range" min={legal.minRaiseTo} max={legal.maxRaiseTo} value={clampRaise(raiseTo)} onChange={(event) => setRaiseTo(clampRaise(Number(event.target.value)))} className="mt-2 w-full accent-amber-400" /><div className="mt-1 flex flex-wrap justify-center gap-1 text-[10px]"><button onClick={() => setRaiseTo(legal.minRaiseTo)} className="rounded-lg bg-emerald-900/70 px-2 py-1 font-bold text-emerald-100">最小加注</button><button onClick={() => setRaiseTo(clampRaise(legal.committed + legal.toCall + Math.round(legal.pot / 2)))} className="rounded-lg bg-emerald-900/70 px-2 py-1 font-bold text-emerald-100">半池</button><button onClick={() => setRaiseTo(clampRaise(legal.committed + legal.toCall + legal.pot))} className="rounded-lg bg-emerald-900/70 px-2 py-1 font-bold text-emerald-100">一池</button><button onClick={() => setRaiseTo(legal.maxRaiseTo)} className="rounded-lg bg-emerald-900/70 px-2 py-1 font-bold text-emerald-100">全下额</button></div></div>}</> : <p className="py-1 text-center text-xs text-emerald-100/60">{room.hand?.complete ? '本手已结束，正在准备下一手…' : '等待其他玩家行动…'}</p>}{mySeat && mySeat.stack <= 0 && room.hand?.complete && <button onClick={() => sendMessage({ type: 'REBUY', payload: { roomId: room.roomId } })} className="mt-2 w-full rounded-xl bg-emerald-600 py-2 text-xs font-black text-white hover:bg-emerald-500">筹码输光了，重新买入 {formatChips(room.buyIn)}</button>}</section>}
        <details className="mx-auto mt-1.5 w-full max-w-3xl shrink-0 rounded-xl border border-emerald-900/60 bg-black/25 px-3 py-1.5"><summary className="cursor-pointer text-[10px] font-black uppercase tracking-widest text-emerald-100/50">牌桌记录</summary><div className="mt-1 max-h-[12dvh] space-y-1 overflow-y-auto text-[10px]">{[...(room.hand?.log || []), ...room.log].slice(0, 40).map((entry, index) => <div key={`${entry.at}-${index}`} className="flex gap-2 text-emerald-100/70"><span className="tabular-nums text-emerald-100/40">{new Date(entry.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span><span>{entry.text}</span></div>)}</div></details>
      </div>
    </main>
  );
}
