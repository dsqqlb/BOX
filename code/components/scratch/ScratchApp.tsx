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

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  buyTicket, buyUpgrade, fetchCatalog, fetchLedger, fetchProfile, fetchTickets, fetchUpgrades,
  redeemTicket, resetUpgrades, revealTicket, saveMachine, saveTicketPosition, shredTicket,
  smeltScraps, ScratchApiError,
} from '@/lib/scratch/api';
import {
  formatDelta, formatMoney, formatPercent, getTicketDefinition, getTicketShape, LEDGER_KIND_LABELS,
} from '@/lib/scratch/catalog';
import type {
  ScratchCatalog, ScratchCatalogTicket, ScratchLedgerEntry, ScratchMachineId, ScratchOutcome,
  ScratchProfile, ScratchTicket, ScratchUpgradesPayload,
} from '@/lib/scratch/types';
import TicketArt from './TicketArt';
import TicketFocus from './TicketFocus';
import UpgradeAccordion from './UpgradeAccordion';
import { AutoScratchMachineArt, RedeemMachineArt, ShredderMachineArt } from './MachineArt';

const NOTICE_MS = 3600;
/** 票在桌面上被夹住的范围（百分比）。上边留多一点，别让票钻到「能力」栏底下。 */
const MIN_X = 3;
const MAX_X = 97;
const MIN_Y = 15;
const MAX_Y = 97;
/** 位移超过这么多像素才算「拖动」，否则当成「点一下」。 */
const DRAG_THRESHOLD_PX = 5;
/**
 * 桌面上票的 z 上限：拖一次抬一层，涨到上限就由服务端把整桌重新编号，
 * 免得 z 无限增长最后压住提示条、聚焦大票这些上层界面。
 */
const Z_LIMIT = 20;
/** 拖动中的票临时用的 z：盖住其他票，但仍在提示条（65）与大票（1000）之下。 */
const DRAG_Z_INDEX = 45;
/** 新票「从商店扔出来」时的飞行时长（毫秒）。 */
const FLY_MS = 880;
/** 随机落点范围（百分比）：上边留出「能力」栏的位置，左右别贴边。 */
const LANDING_X_MIN = 10;
const LANDING_Y_MIN = 20;
const LANDING_X_MAX = 89;
const LANDING_Y_MAX = 87;
/** 机器在桌面上的活动范围（百分比，指的是机器中心）。 */
const MACHINE_X_MIN = 9;
const MACHINE_X_MAX = 91;
const MACHINE_Y_MIN = 18;
const MACHINE_Y_MAX = 92;

const STATUS_LABELS: Record<string, string> = {
  sealed: '未刮开',
  scratched: '已刮开',
  redeemed: '已兑奖',
  shredded: '已碎',
};

interface DragState {
  id: string;
  /** 被拖的元素：拖动期间直接改它的 left/top，避免整棵界面重渲染。 */
  node: HTMLDivElement;
  pointerId: number;
  /** 指针落点相对票中心的偏移（百分比），拖动时保持手指与票的相对位置。 */
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  /** 拖动中最后一次算出的坐标（松手时才提交给 state 与服务器）。 */
  posX: number;
  posY: number;
}

/** 机器吐出来的粒子：碎纸机是纸屑、兑奖机是金币（纯视觉，1 秒多后自动清掉）。 */
interface MachineParticle {
  id: number;
  kind: 'scrap' | 'coin';
  x: number;
  y: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  color: string;
}

/** 机器上方飘起来的文字（+12 币 / 暴击 ×2 / +6 纸屑）。 */
interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  tone: 'money' | 'scrap';
}

/**
 * 一次飞行动画：左上的票从商店飞进桌面，机器刮完的票从机器弹回桌面，都走这一套。
 * **一段动作**：起点直接到终点，中途不设中间关键帧（所以是直线掠过、没有"先抛高再落下"的第二段），
 * 位置都是桌面百分比。
 */
interface Flight {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  rot0: number;
  rot1: number;
  ms: number;
}

/** 自动刮奖机手上正在刮的那张票。 */
interface AutoJob {
  ticketId: string;
  name: string;
  startedAt: number;
  durationMs: number;
}

/** 机器拖动状态：和票一样，拖动期间只改 DOM，松手才写 state 与服务器。 */
interface MachineDragState {
  id: ScratchMachineId;
  node: HTMLDivElement;
  /** 指针落点相对机器中心的偏移（百分比），拖动时手指与机器保持相对位置。 */
  offsetX: number;
  offsetY: number;
  startClientX: number;
  startClientY: number;
  x: number;
  y: number;
  moved: boolean;
}

/** 机器在桌面上的显示信息（位置从服务端下发，这里只补图标/名字/配色）。 */
const MACHINE_META: Record<ScratchMachineId, { name: string; icon: string; hint: string }> = {
  redeem: { name: '兑奖机', icon: '💵', hint: '中奖的票拖进来' },
  shred: { name: '碎纸机', icon: '♻️', hint: '没中奖的票拖进来' },
  auto: { name: '自动刮奖机', icon: '🤖', hint: '没刮开的票拖进来' },
};

/** 三台机器的图标（程序化 SVG，都在 MachineArt.tsx 里）。 */
const MACHINE_ART: Record<ScratchMachineId, (props: { className?: string }) => React.ReactElement> = {
  redeem: RedeemMachineArt,
  shred: ShredderMachineArt,
  auto: AutoScratchMachineArt,
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 票落地后的旋转角：由票 id 算出来，所以**每张票角度都不一样，但刷新后还在同一个角度**
 * （不用为了一个装饰性角度再加一列数据库字段）。
 */
function ticketRotation(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) % 100000;
  }
  return (hash % 290) / 10 - 14.5;
}

/**
 * 票摆在桌面上的角度：`rotation` 为 null（刚买来、还没摆正）时用票 id 算出来的随机角，
 * 一旦拖过或点开就写 0（摆正），之后刷新也还是正的。
 */
function ticketAngle(ticket: ScratchTicket): number {
  return ticket.rotation ?? ticketRotation(ticket.id);
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value * 10) / 10));
}

function clampX(value: number): number {
  return clampRange(value, MIN_X, MAX_X);
}

function clampY(value: number): number {
  return clampRange(value, MIN_Y, MAX_Y);
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
  /** 正在聚焦刮开的那张票（null = 在桌面视角）。 */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  /** 拖到碎纸机但还没刮开的票：先问一句再碎，避免误碎可能中奖的票。 */
  const [pendingShredId, setPendingShredId] = useState<string | null>(null);
  const [particles, setParticles] = useState<MachineParticle[]>([]);
  /** 机器上方飘着的「+N 币」文字。 */
  const [floats, setFloats] = useState<FloatText[]>([]);
  const particleIdRef = useRef(0);
  const floatIdRef = useRef(0);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [upgrades, setUpgrades] = useState<ScratchUpgradesPayload | null>(null);
  const [upgradesLoading, setUpgradesLoading] = useState(false);
  const [upgradeBusy, setUpgradeBusy] = useState<string | null>(null);
  /** 正在重置技能树。 */
  const [resetting, setResetting] = useState(false);
  /** 鼠标悬停/手指点选中的「能力」（展开详情）。 */
  const [shelfDetailId, setShelfDetailId] = useState<string | null>(null);
  /** 正在飞行的票：新买的从商店飞进来，机器刮完的从机器弹回桌面。 */
  const [flights, setFlights] = useState<Record<string, Flight>>({});
  /** 自动刮奖机上正在刮的那张票（null = 机器闲着）。 */
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null);

  const noticeTimer = useRef<number | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const redeemRef = useRef<HTMLDivElement | null>(null);
  const shredRef = useRef<HTMLDivElement | null>(null);
  const autoRef = useRef<HTMLDivElement | null>(null);
  /** 左侧商店列表：买票时用它算出「票是从哪儿扔出来的」。 */
  const shopRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const machineDragRef = useRef<MachineDragState | null>(null);
  const dropTargetRef = useRef<ScratchMachineId | null>(null);
  const ticketsRef = useRef<ScratchTicket[]>([]);
  const profileRef = useRef<ScratchProfile | null>(null);
  const machinesRef = useRef<ScratchProfile['machines'] | null>(null);
  /** 自动刮奖机的进度条与文字：用 rAF 直接改 DOM，避免每帧重渲染整张桌子。 */
  const autoBarRef = useRef<HTMLDivElement | null>(null);
  const autoTextRef = useRef<HTMLSpanElement | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const autoRafRef = useRef<number | null>(null);
  /** 机器手上那张票（用 ref 是因为拖动/提交这些窗级回调里要读最新值）。 */
  const autoJobRef = useRef<AutoJob | null>(null);

  // 拖动过程中要读「最新」的票（state 更新是异步的），所以同步一份到 ref。
  useEffect(() => { ticketsRef.current = tickets; }, [tickets]);
  useEffect(() => { profileRef.current = profile; machinesRef.current = profile?.machines ?? null; }, [profile]);

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
      const [nextProfile, nextCatalog, nextTickets, nextLedger, nextUpgrades] = await Promise.all([
        fetchProfile(), fetchCatalog(), fetchTickets(), fetchLedger(), fetchUpgrades(),
      ]);
      setProfile(nextProfile);
      setCatalog(nextCatalog);
      setTickets(nextTickets.tickets);
      setLedger(nextLedger.entries);
      // 升级数据平时也留着：桌面顶部的「能力」栏要靠它拿图标与说明。
      setUpgrades(nextUpgrades);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof ScratchApiError ? error.message : '数据加载失败，请刷新页面重试。');
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /** 把屏幕坐标换算成桌面百分比（飞行的起点终点都用它）。 */
  const percentFromClient = useCallback((clientX: number, clientY: number) => {
    const table = tableRef.current;
    if (!table) return { x: 50, y: 50 };
    const rect = table.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  /** 随机落点：在桌面安全区域里随便挑一个（避开顶上的「能力」栏与左右边缘）。 */
  const randomLanding = useCallback(() => ({
    x: randomBetween(LANDING_X_MIN, LANDING_X_MAX),
    y: randomBetween(LANDING_Y_MIN, LANDING_Y_MAX),
  }), []);

  /**
   * 让一张票飞一下：**一段动作**，起点直奔终点，路上匀速自转。
   * 落点要先写进 state（票自己的 left/top），动画只负责把过程演出来。
   */
  const startFlight = useCallback((
    ticketId: string,
    from: { x: number; y: number },
    to: { x: number; y: number },
    ms: number,
    landRotation: number,
  ) => {
    setFlights((current) => ({
      ...current,
      [ticketId]: {
        id: ticketId,
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
        rot0: landRotation + randomBetween(-200, 200),
        rot1: landRotation,
        ms,
      },
    }));
  }, []);

  /** 动画结束就把飞行记录删掉，票安静待在落点上（再点它就能聚焦）。 */
  const endFlight = useCallback((ticketId: string) => {
    setFlights((current) => {
      if (!current[ticketId]) return current;
      const next = { ...current };
      delete next[ticketId];
      return next;
    });
  }, []);

  /**
   * 摆正一张票：桌面上歪着放的票，一旦被拖动或点开就不再歪着（rotation = 0 并写库，刷新后也是正的）。
   * 只是外观状态，写库失败也不打断手感。
   */
  const straighten = useCallback((ticketId: string) => {
    setTickets((list) => list.map((item) => (item.id === ticketId && item.rotation !== 0
      ? { ...item, rotation: 0 }
      : item)));
    void saveTicketPosition(ticketId, { rotation: 0 }).catch(() => {});
  }, []);

  /**
   * 买票：付完钱，票**从左边商店里被扔出来** —— 初速度、角度、落点全是随机的，
   * 所以每张票落在桌上的位置和摆放角度都不一样（角度由票 id 决定，刷新后还是同一个角度）。
   */
  const buy = useCallback(async (
    kind: string, name: string, price: number, originEl: HTMLElement | null,
  ) => {
    if (buying) return;
    setBuying(kind);
    try {
      const result = await buyTicket(kind);
      const landing = randomLanding();
      const rect = originEl?.getBoundingClientRect();
      const origin = rect
        ? percentFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : { x: -4, y: 50 };
      setTickets((list) => [...list, { ...result.ticket, posX: landing.x, posY: landing.y, z: Z_LIMIT }]);
      setProfile((current) => (current ? { ...current, money: result.money, usedSlots: current.usedSlots + 1 } : current));
      startFlight(result.ticket.id, origin, landing, FLY_MS, ticketAngle(result.ticket));
      flash(`买到一张「${name}」，花了 ${formatMoney(price)}，从商店扔到桌上了。`);
      // 落点是随机算出来的，所以必须写库（写不进去也只是这张票位置不理想）。
      try {
        await saveTicketPosition(result.ticket.id, { posX: landing.x, posY: landing.y, z: Z_LIMIT });
      } catch { /* 忽略：loadAll 会拿到服务端给的默认位置 */ }
      await loadAll();
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '买票失败，请稍后再试。', true);
    } finally {
      setBuying(null);
    }
  }, [buying, flash, loadAll, percentFromClient, randomLanding, startFlight]);

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

  /** 取桌面上某个元素（机器）的中心，换算成桌面百分比。 */
  const elementCenter = useCallback((element: HTMLElement | null): { x: number; y: number } | null => {
    const table = tableRef.current;
    if (!element || !table) return null;
    return percentFromClient(
      element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
      element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
    );
  }, [percentFromClient]);

  /**
   * 机器特效：在机器位置撒一把粒子（碎纸机撒纸屑、兑奖机撒金币），
   * 再往机器上方飘一行字（+N 币 / +N 纸屑），一秒多以后自动清掉。
   */
  const burst = useCallback((
    machineRef: React.RefObject<HTMLDivElement | null>,
    kind: 'scrap' | 'coin',
    amount?: number,
  ) => {
    const center = elementCenter(machineRef.current);
    if (!center) return;
    const batch: MachineParticle[] = Array.from(
      { length: kind === 'coin' ? 18 : 16 },
      () => ({
        id: (particleIdRef.current += 1),
        kind,
        x: center.x,
        y: center.y,
        dx: (Math.random() - 0.5) * (kind === 'coin' ? 300 : 260),
        dy: (Math.random() - 0.75) * (kind === 'coin' ? 250 : 220),
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 140,
        color: kind === 'coin'
          ? (Math.random() > 0.5 ? '#ffd76a' : '#e8a92c')
          : (Math.random() > 0.5 ? '#fdfaf1' : '#d9d2c0'),
      }),
    );
    setParticles((list) => [...list, ...batch]);
    const ids = new Set(batch.map((item) => item.id));
    window.setTimeout(() => {
      setParticles((list) => list.filter((item) => !ids.has(item.id)));
    }, 1500);

    if (amount === undefined) return;
    const float: FloatText = {
      id: (floatIdRef.current += 1),
      x: center.x,
      y: center.y - 3,
      text: kind === 'coin' ? `+${amount} 币` : `+${amount} 纸屑`,
      tone: kind === 'coin' ? 'money' : 'scrap',
    };
    setFloats((list) => [...list, float]);
    window.setTimeout(() => {
      setFloats((list) => list.filter((item) => item.id !== float.id));
    }, 1500);
  }, [elementCenter]);

  /** 给机器加一下工作特效的 class（兑奖出货 / 碎纸启动 / 自动刮奖机运行）。 */
  const flashMachine = useCallback((
    machineRef: React.RefObject<HTMLDivElement | null>,
    className: string,
    ms = 900,
  ) => {
    const node = machineRef.current;
    if (!node) return;
    node.classList.add(className);
    window.setTimeout(() => node.classList.remove(className), ms);
  }, []);

  /** 兑奖 / 碎纸：结算成功后票会离开桌面（不再是「未结算」状态），所以直接重拉列表。 */
  const settleTicket = useCallback(async (ticket: ScratchTicket, action: 'redeem' | 'shred'): Promise<void> => {
    try {
      if (action === 'redeem') {
        const payload = await redeemTicket(ticket.id);
        if (payload.money !== null) setProfile((current) => (current ? { ...current, money: payload.money as number } : current));
        // 兑换特效：兑奖机闪光 + 撒金币 + 飘一行「+N 币」（暴击时字样也跟着变）
        flashMachine(redeemRef, 'is-payout', 1100);
        burst(redeemRef, 'coin', payload.prize);
        flash(payload.crit
          ? `暴击！「${ticket.name}」兑奖 +${payload.prize} 币（票面 ${payload.basePrize}）`
          : `兑奖成功：+${payload.prize} 币，钱已经进与德州扑克共用的那份余额。`);
      } else {
        const payload = await shredTicket(ticket.id);
        if (payload.scraps !== null) setProfile((current) => (current ? { ...current, scraps: payload.scraps as number } : current));
        flashMachine(shredRef, 'is-working', 800);
        burst(shredRef, 'scrap', payload.gained);
        flash(`碎纸完成：「${ticket.name}」变成 ${payload.gained} 单位纸屑。`);
      }
      await loadAll();
    } catch (error) {
      const message = error instanceof ScratchApiError ? error.message : '结算失败，请稍后再试。';
      flash(message, true);
      throw new Error(message);
    }
  }, [burst, flash, flashMachine, loadAll]);

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

  /** 打开技能树：顺手拉一次最新价格（纸屑与余额可能刚变过）。 */
  const openUpgrades = useCallback(async () => {
    setShowUpgrades(true);
    setUpgradesLoading(true);
    try {
      setUpgrades(await fetchUpgrades());
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '技能树数据没拿到，稍后再试。', true);
    } finally {
      setUpgradesLoading(false);
    }
  }, [flash]);

  /** 「自动巡桌」（能力栏里的 🛎️）：把桌面上还没刮开的票全部交给机器刮开结算。 */
  const runAutoScratchAll = useCallback(async () => {
    const sealed = ticketsRef.current.filter((item) => item.status === 'sealed');
    if (!sealed.length) {
      flash('桌面上没有未刮开的票。', true);
      return;
    }
    let done = 0;
    for (const item of sealed) {
      try {
        const payload = await revealTicket(item.id, 1);
        setTickets((list) => list.map((entry) => (entry.id === payload.ticket.id ? payload.ticket : entry)));
        done += 1;
      } catch {
        // 单张失败不影响其它票，最后统一报数。
      }
    }
    void refreshProfile();
    flash(`自动巡桌：替你把 ${done} 张票刮开了。`);
  }, [flash, refreshProfile]);

  /** 「自动兑奖」：桌面上所有中奖的票一键兑掉。 */
  const runAutoRedeemAll = useCallback(async () => {
    const winners = ticketsRef.current.filter((item) => item.outcome?.won);
    if (!winners.length) {
      flash('桌面上没有中奖的票。', true);
      return;
    }
    let total = 0;
    let crits = 0;
    for (const item of winners) {
      try {
        const payload = await redeemTicket(item.id);
        total += payload.prize;
        if (payload.crit) crits += 1;
      } catch {
        // 忽略单张失败
      }
    }
    await loadAll();
    flashMachine(redeemRef, 'is-payout', 1100);
    burst(redeemRef, 'coin', total);
    flash(`自动兑奖：${winners.length} 张中奖票共到账 ${total} 币${crits > 0 ? `（其中 ${crits} 次暴击）` : ''}。`);
  }, [burst, flash, flashMachine, loadAll]);

  /** 「自动碎纸」：桌面上所有「刮开且没中奖」的票一键碎掉。 */
  const runAutoShredAll = useCallback(async () => {
    const losers = ticketsRef.current.filter((item) => item.outcome && !item.outcome.won);
    if (!losers.length) {
      flash('桌面上没有「已刮开但没中奖」的票。', true);
      return;
    }
    let scraps = 0;
    for (const item of losers) {
      try {
        const payload = await shredTicket(item.id);
        scraps += payload.gained;
      } catch {
        // 忽略单张失败
      }
    }
    flashMachine(shredRef, 'is-working', 800);
    burst(shredRef, 'scrap', scraps);
    await loadAll();
    flash(`自动碎纸：碎掉 ${losers.length} 张，得到 ${scraps} 单位纸屑。`);
  }, [burst, flash, flashMachine, loadAll]);

  /** 「纸屑熔炼炉」：把纸屑按当前汇率换成钱。 */
  const runSmelt = useCallback(async () => {
    try {
      const payload = await smeltScraps();
      setProfile((current) => (current ? { ...current, money: payload.money, scraps: payload.scraps } : current));
      flash(`熔炼完成：${payload.spent} 纸屑 → ${payload.gain} 币（每 ${payload.rate} 换 1）。`);
      await loadAll();
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '熔炼失败，请稍后再试。', true);
    }
  }, [flash, loadAll]);

  /** 升一级：升级会改变售价、容量、解锁票种等，所以顺手刷新 profile 与商店目录。 */
  const upgradeOne = useCallback(async (id: string, name: string) => {
    if (upgradeBusy) return;
    setUpgradeBusy(id);
    try {
      const next = await buyUpgrade(id);
      setUpgrades(next);
      setProfile((current) => (current
        ? { ...current, money: next.money, scraps: next.scraps }
        : current));
      const [nextProfile, nextCatalog] = await Promise.all([fetchProfile(), fetchCatalog()]);
      setProfile(nextProfile);
      setCatalog(nextCatalog);
      flash(`${name} 升级成功。`);
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '升级失败，请稍后再试。', true);
      // 价格/余额可能已经变了，刷新一次面板，避免显示过期价格。
      try { setUpgrades(await fetchUpgrades()); } catch { /* 忽略 */ }
    } finally {
      setUpgradeBusy(null);
    }
  }, [flash, upgradeBusy]);

  /** 收起 / 放回一台机器（收起 = 进「能力」栏，位置记着，放回来还在原地）。 */
  const toggleMachine = useCallback(async (id: ScratchMachineId, folded: boolean) => {
    const current = machinesRef.current?.[id];
    if (!current) return;
    // 先本地改，界面立刻响应；服务器返回后以它为准。
    setProfile((prev) => (prev
      ? { ...prev, machines: { ...prev.machines, [id]: { ...current, folded } } }
      : prev));
    try {
      const payload = await saveMachine(id, { folded });
      setProfile((prev) => (prev ? { ...prev, machines: payload.machines } : prev));
      flash(folded ? `「${MACHINE_META[id].name}」收进能力栏了。` : `「${MACHINE_META[id].name}」放回桌面。`);
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '机器状态没保存成功。', true);
      try { setProfile(await fetchProfile()); } catch { /* 忽略 */ }
    }
  }, [flash]);

  /** 一键重置能力升级：清空全部等级，并把已花的金钱与纸屑按配置价格全额退还（前端已问过一遍）。 */
  const resetAll = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    try {
      const payload = await resetUpgrades();
      await loadAll();
      flash(`能力已重置：清空 ${payload.clearedLevels} 级，退还 金钱 ${payload.refundMoney} + 纸屑 ${payload.refundScraps}。`);
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '重置失败，请稍后再试。', true);
    } finally {
      setResetting(false);
    }
  }, [flash, loadAll, resetting]);

  /** 停掉自动刮奖机的进度条动画与计时。 */
  const stopAutoTicker = useCallback(() => {
    if (autoRafRef.current !== null) window.cancelAnimationFrame(autoRafRef.current);
    if (autoTimerRef.current !== null) window.clearTimeout(autoTimerRef.current);
    autoRafRef.current = null;
    autoTimerRef.current = null;
  }, []);

  useEffect(() => stopAutoTicker, [stopAutoTicker]);

  /** 自动刮奖机刮完：服务端结算，然后把票**弹回桌面**（和从商店扔出来是同一套飞行动画）。 */
  const finishAutoMachine = useCallback(async (ticket: ScratchTicket) => {
    stopAutoTicker();
    const from = elementCenter(autoRef.current) ?? { x: 50, y: 50 };
    try {
      const payload = await revealTicket(ticket.id, 1);
      const landing = randomLanding();
      // 一次 setState 里同时「把票放到新落点」和「结束 in-machine 状态、开始飞行」，避免闪一帧
      setTickets((list) => list.map((item) => (item.id === ticket.id
        ? { ...payload.ticket, posX: landing.x, posY: landing.y, z: Z_LIMIT }
        : item)));
      setAutoJob(null);
      startFlight(ticket.id, from, landing, 760, ticketAngle(payload.ticket));
      if (payload.ticket.outcome?.won) burst(autoRef, 'coin', payload.ticket.outcome.prize);
      flash(`自动刮奖机刮完「${ticket.name}」：${payload.ticket.outcome?.headline ?? '已结算'}，票弹回桌面了。`);
      try {
        await saveTicketPosition(ticket.id, { posX: landing.x, posY: landing.y, z: Z_LIMIT });
      } catch { /* 位置没存住不影响这张票 */ }
      void refreshProfile();
    } catch (error) {
      setAutoJob(null);
      flash(error instanceof ScratchApiError ? error.message : '自动刮奖机出错了，稍后再试。', true);
    }
  }, [burst, elementCenter, flash, randomLanding, refreshProfile, startFlight, stopAutoTicker]);

  /**
   * 把一张票交给自动刮奖机：机器转起来、顶上进度条按升级后的速度走（满级是立刻完成），
   * 进度走完就结算并把票弹回桌面。同一时间只带一张票，机器忙着的话先说明。
   */
  const runAutoMachine = useCallback((ticket: ScratchTicket) => {
    if (autoJobRef.current) {
      flash('自动刮奖机手上还有一张，等它刮完再来。', true);
      return;
    }
    if (ticket.status !== 'sealed' && ticket.revealed) {
      flash('这张票已经刮开过了。', true);
      return;
    }
    const durationMs = Math.max(0, profileRef.current?.effects.autoMachineMs ?? 0);
    const job: AutoJob = { ticketId: ticket.id, name: ticket.name, startedAt: performance.now(), durationMs };
    autoJobRef.current = job;
    setAutoJob(job);
    flashMachine(autoRef, 'is-working', Math.max(900, durationMs + 300));
    if (autoBarRef.current) autoBarRef.current.style.width = '0%';
    if (autoTextRef.current) autoTextRef.current.textContent = '0%';

    const tick = () => {
      const ratio = durationMs <= 0 ? 1 : Math.min(1, (performance.now() - job.startedAt) / durationMs);
      if (autoBarRef.current) autoBarRef.current.style.width = `${Math.round(ratio * 100)}%`;
      if (autoTextRef.current) autoTextRef.current.textContent = ratio >= 1 ? '马上好' : `${Math.round(ratio * 100)}%`;
      if (ratio < 1) autoRafRef.current = window.requestAnimationFrame(tick);
    };
    autoRafRef.current = window.requestAnimationFrame(tick);
    autoTimerRef.current = window.setTimeout(() => {
      autoJobRef.current = null;
      void finishAutoMachine(ticket);
    }, durationMs);
  }, [finishAutoMachine, flash, flashMachine]);

  /** 指针落点是否在某台机器上（兑奖机 / 碎纸机 / 自动刮奖机）。 */
  const detectDropTarget = useCallback((clientX: number, clientY: number): ScratchMachineId | null => {
    const machines: Array<[ScratchMachineId, React.RefObject<HTMLDivElement | null>]> = [
      ['redeem', redeemRef],
      ['shred', shredRef],
      ['auto', autoRef],
    ];
    for (const [key, ref] of machines) {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) continue;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) return key;
    }
    return null;
  }, []);

  /**
   * 开始拖动：只记状态 + 打一个高亮 class，**不动坐标 state**。
   *
   * 以前每个 pointermove 都 setState，12 张票（每张都是一个复杂 SVG）+ 商店卡片会整棵重渲染，
   * 于是掉帧、看起来像「拖不动」。现在拖动期间只改 DOM 的 left/top，松手才提交一次。
   */
  function beginDrag(event: React.PointerEvent<HTMLDivElement>, ticket: ScratchTicket) {
    const table = tableRef.current;
    if (!table || dragRef.current) return;
    const rect = table.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    dragRef.current = {
      id: ticket.id,
      node: event.currentTarget,
      pointerId: event.pointerId,
      offsetX: ticket.posX - pointerX,
      offsetY: ticket.posY - pointerY,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
      posX: ticket.posX,
      posY: ticket.posY,
    };
    setDraggingId(ticket.id);
    event.preventDefault();
  }

  /** 开始拖一台机器：和拖票一样，拖动期间只改 DOM，松手才提交。 */
  function beginMachineDrag(event: React.PointerEvent<HTMLDivElement>, id: ScratchMachineId) {
    const table = tableRef.current;
    const state = machinesRef.current?.[id];
    if (!table || !state || machineDragRef.current || dragRef.current) return;
    const rect = table.getBoundingClientRect();
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    machineDragRef.current = {
      id,
      node: event.currentTarget,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: state.x - pointerX,
      offsetY: state.y - pointerY,
      x: state.x,
      y: state.y,
      moved: false,
    };
    event.currentTarget.classList.add('is-dragging');
    event.preventDefault();
  }

  /** 机器高亮也走 DOM，避免拖动中触发 React 重渲染（重渲染会把票的位置打回 state 里的旧值）。 */
  function highlightMachine(target: ScratchMachineId | null) {
    redeemRef.current?.classList.toggle('is-active', target === 'redeem');
    shredRef.current?.classList.toggle('is-active', target === 'shred');
    autoRef.current?.classList.toggle('is-active', target === 'auto');
  }

  /** 拖动中的窗级监听：读的都是 ref，不会随重渲染失效，也不会因为指针跑出票而丢事件。 */
  function handlePointerMove(event: PointerEvent) {
    const machine = machineDragRef.current;
    const drag = dragRef.current;
    const table = tableRef.current;
    if (!table) return;

    // 拖机器：机器只有位置，松手写库即可。
    if (machine) {
      if (Math.abs(event.clientX - machine.startClientX) > DRAG_THRESHOLD_PX
        || Math.abs(event.clientY - machine.startClientY) > DRAG_THRESHOLD_PX) machine.moved = true;
      if (!machine.moved) return;
      const rect = table.getBoundingClientRect();
      machine.x = clampRange(((event.clientX - rect.left) / rect.width) * 100 + machine.offsetX, MACHINE_X_MIN, MACHINE_X_MAX);
      machine.y = clampRange(((event.clientY - rect.top) / rect.height) * 100 + machine.offsetY, MACHINE_Y_MIN, MACHINE_Y_MAX);
      machine.node.style.left = `${machine.x}%`;
      machine.node.style.top = `${machine.y}%`;
      return;
    }

    if (!drag) return;
    if (Math.abs(event.clientX - drag.startClientX) > DRAG_THRESHOLD_PX
      || Math.abs(event.clientY - drag.startClientY) > DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    const rect = table.getBoundingClientRect();
    drag.posX = clampX(((event.clientX - rect.left) / rect.width) * 100 + drag.offsetX);
    drag.posY = clampY(((event.clientY - rect.top) / rect.height) * 100 + drag.offsetY);
    drag.node.style.left = `${drag.posX}%`;
    drag.node.style.top = `${drag.posY}%`;
    const target = detectDropTarget(event.clientX, event.clientY);
    if (dropTargetRef.current !== target) {
      dropTargetRef.current = target;
      highlightMachine(target);
    }
  }

  /** 松手：拖的是机器就存位置；拖的是票就按落点（机器上 / 桌面上）处理。 */
  async function handlePointerUp() {
    // ① 机器拖动
    const machine = machineDragRef.current;
    if (machine) {
      machineDragRef.current = null;
      machine.node.classList.remove('is-dragging');
      if (!machine.moved) return;
      setProfile((prev) => (prev
        ? { ...prev, machines: { ...prev.machines, [machine.id]: { x: machine.x, y: machine.y, folded: false } } }
        : prev));
      try {
        const payload = await saveMachine(machine.id, { x: machine.x, y: machine.y });
        setProfile((prev) => (prev ? { ...prev, machines: payload.machines } : prev));
      } catch (error) {
        flash(error instanceof ScratchApiError ? error.message : '机器位置没保存成功。', true);
      }
      return;
    }

    // ② 票的拖动
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraggingId(null);
    const target = dropTargetRef.current;
    dropTargetRef.current = null;
    highlightMachine(null);

    const ticket = ticketsRef.current.find((item) => item.id === drag.id);
    if (!ticket) return;

    if (!drag.moved) {
      // 点一下（没拖动）= 聚焦这张票，放大成真票来刮；顺手把它摆正。
      straighten(ticket.id);
      setFocusedId(ticket.id);
      return;
    }

    // 拖起来的票抬到最前：z 压在 Z_LIMIT 内，超了由服务端重新编号。顺带摆正（拖过一次就不再歪着放）。
    const maxZ = ticketsRef.current.reduce((max, item) => Math.max(max, item.z), 0);
    const nextZ = Math.min(Z_LIMIT, maxZ + 1);
    setTickets((list) => list.map((item) => (item.id === ticket.id
      ? { ...item, posX: drag.posX, posY: drag.posY, z: nextZ, rotation: 0 }
      : item)));

    if (target) {
      // 拖进机器就算递交：位置先记下（拖过去了就摆在那儿），再按机器干活。
      try {
        await saveTicketPosition(ticket.id, { posX: drag.posX, posY: drag.posY, z: nextZ, rotation: 0 });
      } catch {
        // 位置没存住不影响结算，忽略。
      }
      const placed = { ...ticket, posX: drag.posX, posY: drag.posY };
      if (target === 'auto') {
        runAutoMachine(placed);
      } else {
        const submit = target === 'redeem' ? handleRedeemDrop : handleShredDrop;
        void submit(placed).catch(() => {
          // 失败原因已经在 settleTicket 里 flash 过了，这里只吞掉 rejection。
        });
      }
      return;
    }

    try {
      const saved = await saveTicketPosition(ticket.id, { posX: drag.posX, posY: drag.posY, z: nextZ, rotation: 0 });
      setTickets((list) => list.map((item) => (item.id === saved.ticket.id ? saved.ticket : item)));
    } catch (error) {
      flash(error instanceof ScratchApiError ? error.message : '位置没保存成功，正在刷新…', true);
      await loadAll();
    }
  }

  /**
   * 拖动事件挂在 window 上（只挂一次）：指针跑到别的票、机器或界面外都不会丢事件，
   * 也就不会再出现「拖到一半拖不动」。函数体从 ref 取，永远是最新的那一版。
   */
  const dragHandlersRef = useRef({ move: handlePointerMove, up: handlePointerUp });
  useEffect(() => { dragHandlersRef.current = { move: handlePointerMove, up: handlePointerUp }; });

  useEffect(() => {
    const onMove = (event: PointerEvent) => dragHandlersRef.current.move(event);
    const onUp = () => { void dragHandlersRef.current.up(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const sortedTickets = [...tickets].sort((a, b) => a.z - b.z);
  const money = profile?.money ?? 0;
  const slotsFull = Boolean(profile && profile.usedSlots >= profile.tableSlots);
  const focusedTicket = focusedId ? tickets.find((item) => item.id === focusedId) ?? null : null;
  const focusedDefinition = focusedTicket ? getTicketDefinition(focusedTicket.kind) ?? null : null;
  const pendingShredTicket = pendingShredId ? tickets.find((item) => item.id === pendingShredId) ?? null : null;
  /** 侧边栏只卖已解锁的票种（没解锁的不占位置）。 */
  const shopTickets = (catalog?.tickets || []).filter((ticket) => ticket.unlocked);
  const lockedCount = (catalog?.tickets || []).filter((ticket) => !ticket.unlocked).length;
  /** 桌面顶部「能力」栏：带 shelf 标记且已经点亮的节点。 */
  const shelfItems = (upgrades?.upgrades || []).filter((node) => node.shelf && node.level >= 1);
  const effects = profile?.effects;
  const autoScratchAll = Boolean(effects?.flags?.autoScratchAll);
  const machines = profile?.machines;
  /** 自动刮奖机是升级出来的：没过 1 级就不出现在桌上。 */
  const autoUnlocked = (effects?.levels?.auto ?? 0) >= 1;
  const machineIds: ScratchMachineId[] = autoUnlocked ? ['redeem', 'shred', 'auto'] : ['redeem', 'shred'];
  /** 桌面上的机器与收进「能力」栏的机器（收起状态存在服务端，换设备也一样）。 */
  const onTableMachines = machineIds.filter((id) => machines && !machines[id]?.folded);
  const foldedMachines = machineIds.filter((id) => machines?.[id]?.folded);
  const shelfDetail = shelfDetailId ? shelfItems.find((item) => item.id === shelfDetailId) ?? null : null;
  const focusedThreshold = focusedDefinition
    ? (catalog?.tickets || []).find((ticket) => ticket.key === focusedDefinition.key)?.threshold ?? focusedDefinition.scratch.threshold
    : 0;
  const focusedShredReward = focusedDefinition
    ? (catalog?.tickets || []).find((ticket) => ticket.key === focusedDefinition.key)?.shredScraps ?? focusedDefinition.shredScraps
    : 0;

  return (
    <div className="scr-root">
      <header className="scr-top">
        <div className="scr-brand">
          <span className="scr-brand-title">刮刮乐</span>
          <span className="scr-brand-sub">仅供娱乐，赌博有害 · 刮到哪看到哪，攒纸屑点亮能力</span>
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

        <button type="button" className="scr-top-button" onClick={() => { void openUpgrades(); }}>
          {showUpgrades ? '收起能力升级' : '能力升级'}
        </button>
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
          <div className="scr-shop-list" ref={shopRef}>
            {shopTickets.map((ticket) => (
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
            {lockedCount > 0 && (
              <div className="scr-shop-locked">
                还有 {lockedCount} 种票没解锁：能力升级里点亮「票种保险柜」就会出现。
              </div>
            )}
          </div>
        </aside>

        <div className="scr-table" ref={tableRef}>
          {/* 桌面顶部的「能力」栏：技能树里带物品标记且已点亮的节点摆在这里，收起来的机器也放这儿 */}
          <div className="scr-shelf">
            <span className="scr-shelf-label">能力</span>
            {shelfItems.length === 0 && foldedMachines.length === 0 && (
              <span className="scr-shelf-empty">还没获得：在升级面板里点亮带能力的节点（刮刀、自动刮奖机、幸运护符…）</span>
            )}
            {shelfItems.map((item) => (
              <div
                key={item.id}
                className={`scr-shelf-item${shelfDetailId === item.id ? ' is-active' : ''}`}
                onPointerEnter={() => setShelfDetailId(item.id)}
                onPointerLeave={() => setShelfDetailId(null)}
                onClick={() => setShelfDetailId((current) => (current === item.id ? null : item.id))}
              >
                <span className="scr-shelf-icon">{item.icon}</span>
                <span className="scr-shelf-pips">
                  {Array.from({ length: item.maxLevel }, (_, index) => (
                    <span key={`shelf-pip-${item.id}-${index}`} className={`scr-pip${index < item.level ? ' is-on' : ''}`} />
                  ))}
                </span>
              </div>
            ))}
            {foldedMachines.map((id) => (
              <button
                key={`folded-${id}`}
                type="button"
                className="scr-shelf-item is-machine"
                title={`把${MACHINE_META[id].name}放回桌面`}
                onClick={() => { void toggleMachine(id, false); }}
              >
                <span className="scr-shelf-icon">{MACHINE_META[id].icon}</span>
                <span className="scr-shelf-machine-name">{MACHINE_META[id].name}</span>
                <span className="scr-shelf-unfold">放回桌面</span>
              </button>
            ))}
          </div>

          {shelfDetail && (
            <div className="scr-shelf-detail">
              <div className="scr-shelf-detail-head">
                <span className="scr-shelf-icon">{shelfDetail.icon}</span>
                <span className="scr-shelf-detail-name">{shelfDetail.name}</span>
                <span className="scr-detail-level">{shelfDetail.level} / {shelfDetail.maxLevel}</span>
              </div>
              <p className="scr-shelf-detail-desc">{shelfDetail.desc}</p>
              <div className="scr-detail-effect">
                <span>现在：{shelfDetail.nowText}</span>
                <span className="scr-upgrade-next">{shelfDetail.nextText}</span>
              </div>
              {shelfDetail.id === 'autofocus' && (
                <button
                  type="button"
                  className="scr-top-button is-primary"
                  disabled={!autoScratchAll}
                  onClick={() => { void runAutoScratchAll(); }}
                >
                  {autoScratchAll ? '一键刮开桌面所有未刮开的票' : '未启用'}
                </button>
              )}
              {shelfDetail.id === 'autobank' && (
                <button
                  type="button"
                  className="scr-top-button is-primary"
                  disabled={!effects?.flags?.autoRedeemAll}
                  onClick={() => { void runAutoRedeemAll(); }}
                >
                  {effects?.flags?.autoRedeemAll ? '一键兑奖桌面所有中奖票' : '未启用'}
                </button>
              )}
              {shelfDetail.id === 'autoshred' && (
                <button
                  type="button"
                  className="scr-top-button is-primary"
                  disabled={!effects?.flags?.autoShredAll}
                  onClick={() => { void runAutoShredAll(); }}
                >
                  {effects?.flags?.autoShredAll ? '一键碎掉桌面所有没中奖的票' : '未启用'}
                </button>
              )}
              {shelfDetail.id === 'smelter' && (
                <button
                  type="button"
                  className="scr-top-button is-primary"
                  disabled={!effects?.exchange}
                  onClick={() => { void runSmelt(); }}
                >
                  {effects?.exchange ? `熔炼全部纸屑（每 ${effects.exchange} 换 1 币）` : '未启用'}
                </button>
              )}
            </div>
          )}

          {/* 桌面上的机器：位置可由玩家拖动、可以收进「能力」栏（都存服务端） */}
          {onTableMachines.map((id) => {
            const state = machines?.[id];
            if (!state) return null;
            const Art = MACHINE_ART[id];
            const working = id === 'auto' && autoJob !== null;
            return (
              <div
                key={id}
                className={`scr-machine is-${id}${working ? ' is-busy' : ''}`}
                style={{ left: `${state.x}%`, top: `${state.y}%` }}
                ref={id === 'redeem' ? redeemRef : id === 'shred' ? shredRef : autoRef}
                onPointerDown={(event) => beginMachineDrag(event, id)}
              >
                <button
                  type="button"
                  className="scr-machine-fold"
                  title={`把${MACHINE_META[id].name}收进「能力」栏`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => { void toggleMachine(id, true); }}
                >
                  ⌄
                </button>
                <Art className="scr-machine-art" />
                <span className="scr-machine-name">{MACHINE_META[id].name}</span>

                {id === 'auto' && (
                  <span className="scr-machine-gauge">
                    <span className="scr-machine-bar"><i ref={autoBarRef} /></span>
                    <span className="scr-machine-percent" ref={autoTextRef}>
                      {autoJob ? `${autoJob.name}…` : '待机'}
                    </span>
                  </span>
                )}

                <span className="scr-machine-note">
                  {id === 'redeem' && (
                    <>
                      中奖的票拖进来换钱<br />
                      {effects && effects.prizeBonus > 0
                        ? `兑奖机加成 +${Math.round(effects.prizeBonus * 100)}%${effects.critChance > 0 ? ` · 暴击 ${Math.round(effects.critChance * 100)}%` : ''}`
                        : '钱进德州扑克同一份余额'}
                    </>
                  )}
                  {id === 'shred' && (
                    <>
                      任何票拖进来都能碎<br />
                      1 张票 = {1 + (effects?.shredBonus ?? 0)} 单位纸屑{effects && effects.shredBonus > 0 ? '（已升级）' : ''}
                    </>
                  )}
                  {id === 'auto' && (
                    <>
                      {autoJob ? '正在替你把这张票刮开' : '没刮开的票拖进来，它自己刮'}<br />
                      {(effects?.autoMachineMs ?? 0) <= 0
                        ? '满级：立刻完成'
                        : `约 ${((effects?.autoMachineMs ?? 0) / 1000).toFixed(1)} 秒一张（升级更快）`}
                    </>
                  )}
                </span>
              </div>
            );
          })}

          {sortedTickets.map((ticket) => {
            const definition = getTicketDefinition(ticket.kind);
            const shape = getTicketShape(ticket.kind);
            const won = Boolean(ticket.outcome?.won);
            const flight = flights[ticket.id];
            const inMachine = autoJob?.ticketId === ticket.id;
            return (
              <div
                key={ticket.id}
                className={`scr-ticket is-${shape.kind}${draggingId === ticket.id ? ' is-dragging' : ''}${won ? ' is-won' : ''}${flight ? ' is-flying' : ''}${inMachine ? ' is-in-machine' : ''}`}
                style={{
                  left: `${ticket.posX}%`,
                  top: `${ticket.posY}%`,
                  // 拖动中的票临时置顶；其余按入库的 z 排（z 由服务端压在上限内，不会盖住上级界面）。
                  zIndex: draggingId === ticket.id ? DRAG_Z_INDEX : (flight ? DRAG_Z_INDEX + 1 : 10 + ticket.z),
                  width: `${shape.tableWidth}%`,
                  aspectRatio: `${shape.aspect}`,
                  // 摆放角度：刚买来（还没摆正）是随机角，拖过或点开过就是正的；飞行时交给动画。
                  transform: flight ? undefined : `translate(-50%, -50%) rotate(${ticketAngle(ticket)}deg)`,
                  ...(flight
                    ? {
                      '--scr-from-x': `${flight.fromX}%`,
                      '--scr-from-y': `${flight.fromY}%`,
                      '--scr-to-x': `${flight.toX}%`,
                      '--scr-to-y': `${flight.toY}%`,
                      '--scr-rot0': `${flight.rot0}deg`,
                      '--scr-rot1': `${flight.rot1}deg`,
                      '--scr-fly-ms': `${flight.ms}ms`,
                    }
                    : {}),
                } as React.CSSProperties}
                onPointerDown={flight || inMachine ? undefined : (event) => beginDrag(event, ticket)}
                onAnimationEnd={flight ? () => endFlight(ticket.id) : undefined}
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
              在左边的商店里挑一张买下来，它会从商店里被扔到桌上（落点和角度每次随机）；<br />
              拖着能摆位置、点一下放大成真票刮开；桌上的机器都能拖，也能收进顶上的「能力」栏。
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
              className={`scr-particle is-${particle.kind}`}
              style={{
                left: `${particle.x}%`,
                top: `${particle.y}%`,
                background: particle.kind === 'coin' ? undefined : particle.color,
                animationDelay: `${particle.delay}ms`,
                '--scr-dx': `${particle.dx}px`,
                '--scr-dy': `${particle.dy}px`,
                '--scr-rot': `${particle.rot}deg`,
                '--scr-particle-color': particle.color,
              } as React.CSSProperties}
            />
          ))}

          {floats.map((float) => (
            <span
              key={float.id}
              className={`scr-float is-${float.tone}`}
              style={{ left: `${float.x}%`, top: `${float.y}%` }}
            >
              {float.text}
            </span>
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
          brushPercent={profile?.effects.brushPercent ?? focusedDefinition.scratch.brush}
          autoPointsPerSecond={profile?.effects.autoPointsPerSecond ?? 0}
          prizeBonus={profile?.effects.prizeBonus ?? 0}
          critChance={profile?.effects.critChance ?? 0}
          shredReward={focusedShredReward}
          threshold={focusedThreshold}
          onReveal={(ratio) => revealFor(focusedTicket, ratio)}
          onRedeem={() => settleTicket(focusedTicket, 'redeem')}
          onShred={() => settleTicket(focusedTicket, 'shred')}
          onClose={() => setFocusedId(null)}
        />
      )}

      {showUpgrades && (
        <UpgradeAccordion
          payload={upgrades}
          loading={upgradesLoading}
          busyId={upgradeBusy}
          resetting={resetting}
          onBuy={(id, name) => { void upgradeOne(id, name); }}
          onReset={() => { void resetAll(); }}
          onClose={() => setShowUpgrades(false)}
        />
      )}
    </div>
  );
}

/** 侧边栏里的一张待售票：票面按它自己的 shape 画，所以每张的大小和形状都不一样。
 *  用 memo 包一层：拖动票据或弹窗开关时不必重画这几张票面。 */
const ShopItem = memo(function ShopItem({ ticket, money, slotsFull, buying, onBuy }: {
  ticket: ScratchCatalogTicket;
  money: number;
  slotsFull: boolean;
  buying: string | null;
  onBuy: (kind: string, name: string, price: number, originEl: HTMLElement | null) => void;
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
          <span className="scr-chip">中奖率 {formatPercent(ticket.winChance)}</span>
          <span className="scr-chip">碎纸 +{ticket.shredScraps}</span>
          {ticket.price < ticket.priceBase && (
            <span className="scr-chip is-good">会员价（原 {ticket.priceBase} 币）</span>
          )}
          {!ticket.unlocked && <span className="scr-chip is-warn">未解锁</span>}
          {ticket.problems.length > 0 && <span className="scr-chip is-warn">配置问题 {ticket.problems.length}</span>}
        </span>
      </div>
      <button
        type="button"
        className="scr-shop-buy"
        disabled={disabled}
        onClick={(event) => onBuy(ticket.key, ticket.name, ticket.price, event.currentTarget)}
      >
        {label}
      </button>
    </div>
  );
});