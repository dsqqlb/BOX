'use client';

/**
 * 刮刮乐（/tools/scratch-cards）—— 阶段 1 数据层 + 阶段 2 桌面手感。
 *
 * 布局：左侧是**竖排商店**（四种票各自大小/形状/颜色都不同，票面由 TicketArt 按配置画出来），
 * 右侧是桌子（右上兑奖机、右下碎纸机占位），桌上的票可以随手拖动。
 *
 * 已经能做的：看余额 / 纸屑 → 侧边栏买票（服务端事务扣钱、按种子生成票面、落库）
 * → 票落到桌面（坐标入库）→ 自由拖动摆位（松手写库，刷新后还在原处）→ 看流水。
 *
 * 后续阶段：点击聚焦把票放大成真票并刮开（阶段 3）、兑奖机与碎纸机结账（阶段 4）、升级树（阶段 5）。
 * 「金钱」与德州扑克共用同一份娱乐筹码，所以这里的余额和那边是同一个数字。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  buyTicket, fetchCatalog, fetchLedger, fetchProfile, fetchTickets, redeemTicket, revealTicket,
  saveTicketPosition, shredTicket, ScratchApiError,
} from '@/lib/scratch/api';
import {
  formatDelta, formatMoney, formatPercent, getTicketDefinition, getTicketShape, LEDGER_KIND_LABELS,
} from '@/lib/scratch/catalog';
import type {
  ScratchCatalog, ScratchCatalogTicket, ScratchLedgerEntry, ScratchOutcome, ScratchProfile, ScratchTicket,
} from '@/lib/scratch/types';
import TicketArt from './TicketArt';
import TicketFocus from './TicketFocus';

const NOTICE_MS = 3600;
/** 票在桌面上被夹住的范围（百分比），保证整张票始终留在桌布里。 */
const MIN_POS = 3;
const MAX_POS = 97;
/** 位移超过这么多像素才算「拖动」，否则当成「点一下」（阶段 3 会用它聚焦）。 */
const DRAG_THRESHOLD_PX = 5;

const STATUS_LABELS: Record<string, string> = {
  sealed: '未刮开',
  scratched: '已刮开',
  redeemed: '已兑奖',
  shredded: '已碎',
};

interface DragState {
  id: string;
  pointerId: number;
  /** 指针落点相对票中心的偏移（百分比），拖动时保持手指与票的相对位置。 */
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

/** 碎纸机吐出来的一小片纸屑（纯视觉，1 秒左右后自动清掉）。 */
interface ScrapParticle {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  color: string;
}

function clampPos(value: number): number {
  return Math.min(MAX_POS, Math.max(MIN_POS, Math.round(value * 10) / 10));
}

export default function ScratchApp() {
  const [profile, setProfile] = useState<ScratchProfile | null>(null);
  const [catalog, setCatalog] = useState<ScratchCatalog | null>(null);
  const [tickets, setTickets] = useState<ScratchTicket[]>([]);
  const [ledger, setLedger] = useState<ScratchLedgerEntry[]>([]);
  const [showLedger, setShowLedger] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<'redeem' | 'shred' | null>(null);
  /** 正在聚焦刮开的那张票（null = 在桌面视角）。 */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** 拖到碎纸机但还没刮开的票：先问一句再碎，避免误碎可能中奖的票。 */
  const [pendingShredId, setPendingShredId] = useState<string | null>(null);
  const [particles, setParticles] = useState<ScrapParticle[]>([]);
  const particleIdRef = useRef(0);

  const noticeTimer = useRef<number | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const redeemRef = useRef<HTMLDivElement | null>(null);
  const shredRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dropTargetRef = useRef<'redeem' | 'shred' | null>(null);
  const ticketsRef = useRef<ScratchTicket[]>([]);

  // 拖动过程中要读「最新」的票（state 更新是异步的），所以同步一份到 ref。
  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);

  const flash = useCallback((text: string, error = false) => {
    setNotice({ text, error });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  /** 一次拉齐四份数据：账户总览、商店目录、桌上的票、流水。 */
  const loadAll = useCallback(async () => {
    try {
      const [nextProfile, nextCatalog, nextTickets, nextLedger] = await Promise.all([
        fetchProfile(), fetchCatalog(), fetchTickets(), fetchLedger(),
      ]);
      setProfile(nextProfile);
      setCatalog(nextCatalog);
      setTickets(nextTickets.tickets);
      setLedger(nextLedger.entries);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof ScratchApiError ? error.message : '数据加载失败，请刷新页面重试。');
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const buy = useCallback(async (kind: string, name: string, price: number) => {
    if (buying) return;
    setBuying(kind);
    try {
      const result = await buyTicket(kind);
      setProfile((current) => (current ? { ...current, money: result.money } : current));
      flash(`买到一张「${name}」，花了 ${formatMoney(price)}，已经落到桌面上。`);
      await loadAll();
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '买票失败，请稍后再试。', true);
    } finally {
      setBuying(null);
    }
  }, [buying, flash, loadAll]);

  /** 只刷新账户总览（揭晓后统计变了，不必拉全部数据）。 */
  const refreshProfile = useCallback(async () => {
    try {
      setProfile(await fetchProfile());
    } catch {
      // 局部刷新失败不影响刮奖手感，下次操作还会再拉一次。
    }
  }, []);

  /** 刮开达标 → 服务端结算：拿回结算结果并更新桌上的这张票。 */
  const revealFor = useCallback(async (ticket: ScratchTicket, ratio: number): Promise<ScratchOutcome | null> => {
    try {
      const payload = await revealTicket(ticket.id, ratio);
      setTickets((list) => list.map((item) => (item.id === payload.ticket.id ? payload.ticket : item)));
      void refreshProfile();
      return payload.ticket.outcome;
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '结算失败，请稍后再试。', true);
      return null;
    }
  }, [flash, refreshProfile]);

  /** 碎纸机吐纸屑：在机器位置撒一把小纸片，1 秒多以后自动清掉。 */
  const burstParticles = useCallback((machineRef: React.RefObject<HTMLDivElement | null>) => {
    const machine = machineRef.current;
    const table = tableRef.current;
    if (!machine || !table) return;
    const tableRect = table.getBoundingClientRect();
    const rect = machine.getBoundingClientRect();
    const centerX = ((rect.left + rect.width / 2 - tableRect.left) / tableRect.width) * 100;
    const centerY = ((rect.top + rect.height / 2 - tableRect.top) / tableRect.height) * 100;
    const batch: ScrapParticle[] = Array.from({ length: 16 }, () => ({
      id: (particleIdRef.current += 1),
      x: centerX,
      y: centerY,
      dx: (Math.random() - 0.5) * 260,
      dy: (Math.random() - 0.75) * 220,
      rot: Math.random() * 720 - 360,
      delay: Math.random() * 140,
      color: Math.random() > 0.5 ? '#fdfaf1' : '#d9d2c0',
    }));
    setParticles((list) => [...list, ...batch]);
    const ids = new Set(batch.map((item) => item.id));
    window.setTimeout(() => {
      setParticles((list) => list.filter((item) => !ids.has(item.id)));
    }, 1400);
  }, []);

  /** 兑奖 / 碎纸：结算成功后票会离开桌面（不再是「未结算」状态），所以直接重拉列表。 */
  const settleTicket = useCallback(async (ticket: ScratchTicket, action: 'redeem' | 'shred'): Promise<void> => {
    try {
      if (action === 'redeem') {
        const payload = await redeemTicket(ticket.id);
        if (payload.money !== null) setProfile((current) => (current ? { ...current, money: payload.money as number } : current));
        flash(`兑奖成功：+${payload.prize} 币，钱已经进与德州扑克共用的那份余额。`);
      } else {
        const payload = await shredTicket(ticket.id);
        if (payload.scraps !== null) setProfile((current) => (current ? { ...current, scraps: payload.scraps as number } : current));
        burstParticles(shredRef);
        flash(`碎纸完成：「${ticket.name}」变成 ${payload.gained} 单位纸屑。`);
      }
      await loadAll();
    } catch (error) {
      const message = error instanceof ScratchApiError ? error.message : '结算失败，请稍后再试。';
      flash(message, true);
      throw new Error(message);
    }
  }, [burstParticles, flash, loadAll]);

  /** 拖到兑奖机：只有「已刮开且中奖」的票能换钱，其余情况说明原因。 */
  const handleRedeemDrop = useCallback(async (ticket: ScratchTicket) => {
    if (ticket.status === 'sealed') {
      flash('先点开这张票、把涂层刮开，才知道有没有中奖。', true);
      return;
    }
    if (!ticket.outcome?.won) {
      flash('这张票没中奖，拖到下面的碎纸机可以换纸屑。', true);
      return;
    }
    await settleTicket(ticket, 'redeem');
  }, [flash, settleTicket]);

  /** 拖到碎纸机：刮开过的直接碎；没刮开的先问一句，别把可能中奖的票误碎。 */
  const handleShredDrop = useCallback(async (ticket: ScratchTicket) => {
    if (ticket.status === 'sealed') {
      setPendingShredId(ticket.id);
      return;
    }
    await settleTicket(ticket, 'shred');
  }, [settleTicket]);

  /** 指针落点是否在某个机器上（阶段 4 用来结算，现在只做高亮与提示）。 */
  const detectDropTarget = useCallback((clientX: number, clientY: number): 'redeem' | 'shred' | null => {
    const machines: Array<['redeem' | 'shred', React.RefObject<HTMLDivElement | null>]> = [
      ['redeem', redeemRef],
      ['shred', shredRef],
    ];
    for (const [key, ref] of machines) {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return key;
    }
    return null;
  }, []);

  function startDrag(event: React.PointerEvent<HTMLDivElement>, ticket: ScratchTicket) {
    const table = tableRef.current;
    if (!table) return;
    const rect = table.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    dragRef.current = {
      id: ticket.id,
      pointerId: event.pointerId,
      offsetX: ticket.posX - pointerX,
      offsetY: ticket.posY - pointerY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    // 拿起来的票立刻压到最上层，别被别的票盖住。
    setTickets((list) => {
      const topZ = list.reduce((max, item) => Math.max(max, item.z), 0) + 1;
      return list.map((item) => (item.id === ticket.id ? { ...item, z: topZ } : item));
    });
    setDraggingId(ticket.id);
  }

  function moveDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const table = tableRef.current;
    if (!drag || !table || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startClientX) > DRAG_THRESHOLD_PX
      || Math.abs(event.clientY - drag.startClientY) > DRAG_THRESHOLD_PX) drag.moved = true;
    const rect = table.getBoundingClientRect();
    const x = clampPos(((event.clientX - rect.left) / rect.width) * 100 + drag.offsetX);
    const y = clampPos(((event.clientY - rect.top) / rect.height) * 100 + drag.offsetY);
    setTickets((list) => list.map((item) => (item.id === drag.id ? { ...item, posX: x, posY: y } : item)));
    const target = detectDropTarget(event.clientX, event.clientY);
    dropTargetRef.current = target;
    setDropTarget(target);
  }

  async function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDraggingId(null);
    const target = dropTargetRef.current;
    dropTargetRef.current = null;
    setDropTarget(null);

    const ticket = ticketsRef.current.find((item) => item.id === drag.id);
    if (!ticket) return;

    if (!drag.moved) {
      // 点一下（没拖动）= 聚焦这张票，放大成真票来刮。
      setFocusedId(ticket.id);
      return;
    }

    if (target === 'redeem' || target === 'shred') {
      // 拖进机器就算递交：位置先记下（拖过去了就摆在那儿），再按机器结算。
      try {
        await saveTicketPosition(ticket.id, { posX: ticket.posX, posY: ticket.posY, z: ticket.z });
      } catch {
        // 位置没存住不影响结算，忽略。
      }
      const submit = target === 'redeem' ? handleRedeemDrop : handleShredDrop;
      void submit(ticket).catch(() => {
        // 失败原因已经在 settleTicket 里 flash 过了，这里只吞掉 rejection。
      });
      return;
    }

    try {
      const saved = await saveTicketPosition(ticket.id, { posX: ticket.posX, posY: ticket.posY, z: ticket.z });
      setTickets((list) => list.map((item) => (item.id === saved.ticket.id ? saved.ticket : item)));
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '位置没保存成功，正在刷新…', true);
      await loadAll();
    }
  }

  const sortedTickets = [...tickets].sort((a, b) => a.z - b.z);
  const money = profile?.money ?? 0;
  const slotsFull = Boolean(profile && profile.usedSlots >= profile.tableSlots);
  const focusedTicket = focusedId ? tickets.find((item) => item.id === focusedId) ?? null : null;
  const focusedDefinition = focusedTicket ? getTicketDefinition(focusedTicket.kind) ?? null : null;
  const pendingShredTicket = pendingShredId ? tickets.find((item) => item.id === pendingShredId) ?? null : null;

  return (
    <div className="scr-root">
      <header className="scr-top">
        <div className="scr-brand">
          <span className="scr-brand-title">刮刮乐 · 阶段 4</span>
          <span className="scr-brand-sub">刮到哪看到哪；右上兑奖机换钱、右下碎纸机换纸屑</span>
        </div>

        <div className="scr-wallet">
          <span className="scr-wallet-value">{money}</span>
          <span className="scr-wallet-label">金钱（与德州扑克同一份筹码）</span>
        </div>
        <div className="scr-wallet is-scraps">
          <span className="scr-wallet-value">{profile?.scraps ?? 0}</span>
          <span className="scr-wallet-label">纸屑</span>
        </div>
        <span className="scr-chip">{profile ? `桌面 ${profile.usedSlots} / ${profile.tableSlots}` : '桌面 —'}</span>

        <button type="button" className="scr-top-button" onClick={() => setShowLedger((value) => !value)}>
          {showLedger ? '收起流水' : '收支流水'}
        </button>
        <Link className="scr-top-button" href="/">返回首页</Link>
      </header>

      <div className="scr-body">
        <aside className="scr-shop">
          <div className="scr-shop-head">
            <span className="scr-shop-head-title">商店</span>
            <span className="scr-shop-head-note">向上排开，各票大小形状配色都不同</span>
          </div>
          <div className="scr-shop-list">
            {(catalog?.tickets || []).map((ticket) => (
              <ShopItem
                key={ticket.key}
                ticket={ticket}
                money={money}
                slotsFull={slotsFull}
                buying={buying}
                onBuy={buy}
              />
            ))}
            {!catalog && <div className="scr-shop-card">商店载入中…</div>}
          </div>
        </aside>

        <div className="scr-table" ref={tableRef}>
          <div className={`scr-machine is-redeem${dropTarget === 'redeem' ? ' is-active' : ''}`} ref={redeemRef}>
            <span className="scr-machine-icon">🏦</span>
            <span className="scr-machine-name">兑奖机</span>
            <span className="scr-machine-note">中奖的票拖进来换成钱<br />钱进德州扑克同一份余额</span>
          </div>

          <div className={`scr-machine is-shred${dropTarget === 'shred' ? ' is-active' : ''}`} ref={shredRef}>
            <span className="scr-machine-icon">🗑️</span>
            <span className="scr-machine-name">碎纸机</span>
            <span className="scr-machine-note">任何票拖进来都能碎<br />1 张票 = 1 单位纸屑</span>
          </div>

          {sortedTickets.map((ticket) => {
            const definition = getTicketDefinition(ticket.kind);
            const shape = getTicketShape(ticket.kind);
            const won = Boolean(ticket.outcome?.won);
            return (
              <div
                key={ticket.id}
                className={`scr-ticket is-${shape.kind}${draggingId === ticket.id ? ' is-dragging' : ''}${won ? ' is-won' : ''}`}
                style={{
                  left: `${ticket.posX}%`,
                  top: `${ticket.posY}%`,
                  zIndex: 10 + ticket.z,
                  width: `${shape.tableWidth}%`,
                  aspectRatio: `${shape.aspect}`,
                }}
                onPointerDown={(event) => startDrag(event, ticket)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => void endDrag(event)}
                onPointerCancel={(event) => void endDrag(event)}
              >
                {definition && <TicketArt ticket={definition} legend={ticket.print?.legend ?? null} className="scr-ticket-art" />}
                <span className="scr-ticket-status">{STATUS_LABELS[ticket.status] || ticket.status}</span>
                {ticket.outcome && (
                  <span className={`scr-ticket-result${ticket.outcome.won ? ' is-win' : ''}`}>{ticket.outcome.headline}</span>
                )}
              </div>
            );
          })}

          {!loadError && sortedTickets.length === 0 && (
            <div className="scr-table-hint">
              桌子上还没有票。<br />
              在左边的商店里挑一张买下来，它会立刻落到这张桌子上；<br />
              拖着就能摆位置，点一下就会放大成一张真票，用手指刮开涂层。
            </div>
          )}

          {loadError && <div className="scr-table-hint">加载失败：{loadError}</div>}

          {pendingShredTicket && (
            <div className="scr-confirm">
              <span>「{pendingShredTicket.name}」还没刮开，碎掉就再也没机会中奖了。</span>
              <button
                type="button"
                className="scr-top-button"
                onClick={() => {
                  const target = pendingShredTicket;
                  setPendingShredId(null);
                  void settleTicket(target, 'shred').catch(() => {});
                }}
              >
                确认碎掉
              </button>
              <button
                type="button"
                className="scr-top-button"
                onClick={() => {
                  const target = pendingShredTicket;
                  setPendingShredId(null);
                  setFocusedId(target.id);
                }}
              >
                先刮一下
              </button>
            </div>
          )}

          {particles.map((particle) => (
            <span
              key={particle.id}
              className="scr-scrap"
              style={{
                left: `${particle.x}%`,
                top: `${particle.y}%`,
                background: particle.color,
                animationDelay: `${particle.delay}ms`,
                '--scr-dx': `${particle.dx}px`,
                '--scr-dy': `${particle.dy}px`,
                '--scr-rot': `${particle.rot}deg`,
              } as React.CSSProperties}
            />
          ))}

          {notice && <div className={`scr-notice${notice.error ? ' is-error' : ''}`}>{notice.text}</div>}
        </div>
      </div>

      {showLedger && (
        <div className="scr-ledger">
          <div className="scr-ledger-title">
            <span>收支流水（本工具视角）</span>
            <button type="button" className="scr-top-button" onClick={() => setShowLedger(false)}>关闭</button>
          </div>
          <div className="scr-ledger-list">
            {ledger.length === 0 && <div className="scr-ledger-note">还没有任何记录。</div>}
            {ledger.map((entry) => (
              <div key={entry.id} className="scr-ledger-row">
                <span className={entry.delta >= 0 ? 'is-plus' : 'is-minus'}>{formatDelta(entry.delta)}</span>
                <span className="scr-chip">{entry.currency === 'money' ? '金钱' : '纸屑'}</span>
                <span>{LEDGER_KIND_LABELS[entry.kind] || entry.kind}</span>
                <span className="scr-ledger-note">{entry.note || ''}</span>
                <span className="scr-ledger-time">
                  {new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {focusedTicket && focusedDefinition && (
        <TicketFocus
          definition={focusedDefinition}
          ticket={focusedTicket}
          onReveal={(ratio) => revealFor(focusedTicket, ratio)}
          onRedeem={() => settleTicket(focusedTicket, 'redeem')}
          onShred={() => settleTicket(focusedTicket, 'shred')}
          onClose={() => setFocusedId(null)}
        />
      )}
    </div>
  );
}

/** 侧边栏里的一张待售票：票面按它自己的 shape 画，所以每张的大小和形状都不一样。 */
function ShopItem({ ticket, money, slotsFull, buying, onBuy }: {
  ticket: ScratchCatalogTicket;
  money: number;
  slotsFull: boolean;
  buying: string | null;
  onBuy: (kind: string, name: string, price: number) => void;
}) {
  const affordable = money >= ticket.price;
  const disabled = !affordable || slotsFull || !ticket.unlocked || Boolean(buying);
  const label = buying === ticket.key ? '购买中…'
    : !ticket.unlocked ? '需要解锁'
      : slotsFull ? '桌面已满'
        : !affordable ? '金钱不足'
          : `买一张（${ticket.price} 币）`;

  return (
    <div className={`scr-shop-card is-${ticket.shape.kind}`} style={{ borderColor: `${ticket.theme.edge}66` }}>
      <div
        className="scr-shop-art"
        style={{
          aspectRatio: `${ticket.shape.aspect}`,
          // 宽度 = min(侧边栏宽度, 按高度上限换算出来的宽度)：横票自然变矮、竖票自然变窄，四张票大小一眼可分
          width: `min(100%, calc(13dvh * ${ticket.shape.aspect}))`,
        }}
      >
        <TicketArt ticket={ticket} className="scr-shop-svg" />
      </div>
      <div className="scr-shop-body">
        <div className="scr-shop-title-row">
          <span className="scr-shop-name" style={{ color: ticket.theme.accent }}>{ticket.name}</span>
          <span className="scr-shop-tagline">{ticket.tagline}</span>
        </div>
        <span className="scr-shop-rules">{ticket.rulesText}</span>
        <span className="scr-shop-meta">
          <span className="scr-chip">回收率 {formatPercent(ticket.expectedReturn)}</span>
          <span className="scr-chip">碎纸 +{ticket.shredScraps}</span>
          {!ticket.unlocked && <span className="scr-chip is-warn">未解锁</span>}
          {ticket.problems.length > 0 && <span className="scr-chip is-warn">配置问题 {ticket.problems.length}</span>}
        </span>
      </div>
      <button
        type="button"
        className="scr-shop-buy"
        disabled={disabled}
        onClick={() => onBuy(ticket.key, ticket.name, ticket.price)}
      >
        {label}
      </button>
    </div>
  );
}