'use client';

/**
 * 能力升级面板：**按分类折叠的下拉菜单**（取代原来的横向技能树）。
 *
 * 为什么改成下拉菜单：技能树要拖着找节点、还要顺着连线看前置，节点一多就变成"在一张图里找自己"；
 * 分类折叠面板每一类就是一段，展开就能从上往下看完，谁是前置、差多少资源一眼就清楚。
 *
 * 数据结构没变（还是服务端下发的分类 + 节点），所以以后往 upgrades.json 里加节点只是多一行。
 * 交互：点分类标题展开/收起；行尾按钮点一下解锁；**按住整行 3 秒**也能解锁（行底有进度条）。
 * 面板本身不做任何数值计算——等级、前置、价格、效果文案都来自服务端。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScratchUpgrade, ScratchUpgradesPayload } from '@/lib/scratch/types';

interface UpgradeAccordionProps {
  payload: ScratchUpgradesPayload | null;
  loading: boolean;
  /** 正在解锁的那一项 id。 */
  busyId: string | null;
  /** 正在重置技能树。 */
  resetting: boolean;
  onBuy: (id: string, name: string) => void;
  onReset: () => void;
  onClose: () => void;
}

/** 按住多久算解锁。 */
const HOLD_MS = 3000;
const HOLD_TICK_MS = 50;

interface Group {
  id: string;
  name: string;
  icon: string;
  color: string;
  nodes: ScratchUpgrade[];
  lit: number;
  levels: number;
  maxLevels: number;
  ready: number;
}

export default function UpgradeAccordion({
  payload, loading, busyId, resetting, onBuy, onReset, onClose,
}: UpgradeAccordionProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [holdId, setHoldId] = useState<string | null>(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const [askingReset, setAskingReset] = useState(false);
  const holdTimerRef = useRef<number | null>(null);
  const holdStartRef = useRef(0);
  const autoOpenedRef = useRef(false);

  const nodes = payload?.upgrades || [];
  const categories = payload?.categories || [];

  /** 按分类分组：分类顺序照配置，节点顺序也照配置（所以"谁在谁前面"由配置说了算）。 */
  const groups = useMemo<Group[]>(() => categories.map((category) => {
    const list = nodes.filter((node) => node.category === category.id);
    return {
      id: category.id,
      name: category.name,
      icon: category.icon || '⭐',
      color: category.color,
      nodes: list,
      lit: list.filter((node) => node.level >= 1).length,
      levels: list.reduce((sum, node) => sum + node.level, 0),
      maxLevels: list.reduce((sum, node) => sum + node.maxLevel, 0),
      ready: list.filter((node) => node.buyable).length,
    };
  }).filter((group) => group.nodes.length > 0), [categories, nodes]);

  // 第一次拿到数据时自动展开"最有钱途"的那一类：有可解锁节点的第一组，否则第一组。
  useEffect(() => {
    if (!payload || autoOpenedRef.current || !groups.length) return;
    autoOpenedRef.current = true;
    const first = groups.find((group) => group.ready > 0) || groups[0];
    setOpen({ [first.id]: true });
  }, [groups, payload]);

  const cancelHold = useCallback(() => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    setHoldId(null);
    setHoldProgress(0);
  }, []);

  useEffect(() => () => {
    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current);
  }, []);

  /** 按住不放：整行底部的进度条走满 3 秒就解锁。 */
  const startHold = useCallback((node: ScratchUpgrade) => {
    if (!node.buyable || busyId || holdTimerRef.current !== null) return;
    holdStartRef.current = performance.now();
    setHoldId(node.id);
    setHoldProgress(0);
    const tick = () => {
      const ratio = Math.min(1, (performance.now() - holdStartRef.current) / HOLD_MS);
      setHoldProgress(ratio);
      if (ratio >= 1) {
        cancelHold();
        onBuy(node.id, node.name);
        return;
      }
      holdTimerRef.current = window.setTimeout(tick, HOLD_TICK_MS);
    };
    holdTimerRef.current = window.setTimeout(tick, HOLD_TICK_MS);
  }, [busyId, cancelHold, onBuy]);

  const stateOf = (node: ScratchUpgrade) => {
    if (node.root) return { key: 'root', label: '起点' };
    if (node.maxed) return { key: 'maxed', label: '已满级' };
    if (!node.requiresMet) return { key: 'locked', label: '前置未点亮' };
    if (!node.affordable) return { key: 'costly', label: '资源不足' };
    return { key: 'ready', label: '可解锁' };
  };

  const refund = payload?.refundPreview;
  const canReset = Boolean(refund && refund.levels > 0);
  const toggle = (id: string) => setOpen((current) => ({ ...current, [id]: !current[id] }));
  const openAll = () => setOpen(Object.fromEntries(groups.map((group) => [group.id, true])));
  const closeAll = () => setOpen({});

  return (
    <div className="scr-panel scr-acc">
      <div className="scr-panel-head">
        <span className="scr-panel-title">
          <span>🏗️ 能力升级</span>
          <span className="scr-panel-sub">按分类展开；点行尾按钮解锁，按住整行 3 秒也行</span>
        </span>
        <span className="scr-chip is-money">金钱 {payload?.money ?? 0}</span>
        <span className="scr-chip is-scraps">纸屑 {payload?.scraps ?? 0}</span>
        <button type="button" className="scr-top-button" onClick={openAll}>全部展开</button>
        <button type="button" className="scr-top-button" onClick={closeAll}>全部收起</button>
        <button
          type="button"
          className="scr-top-button is-danger"
          disabled={!canReset || resetting}
          onClick={() => setAskingReset(true)}
        >
          {resetting ? '重置中…' : '一键重置'}
        </button>
        <button type="button" className="scr-top-button" onClick={onClose}>关闭</button>
      </div>

      {/* 重置要问一遍：把「清空多少级、退多少资源」摆出来再让人点确认 */}
      {askingReset && (
        <div className="scr-acc-confirm">
          <span>
            确定重置能力升级？会清空全部 <b>{refund?.levels ?? 0}</b> 级，
            并全额退还 金钱 <b>{refund?.money ?? 0}</b> + 纸屑 <b>{refund?.scraps ?? 0}</b>。
            已解锁的票种、升好的刮刀都会回到起点——退的只是资源，等级不保留。
          </span>
          <button
            type="button"
            className="scr-top-button is-primary"
            disabled={resetting}
            onClick={() => { setAskingReset(false); onReset(); }}
          >
            确认重置
          </button>
          <button type="button" className="scr-top-button" onClick={() => setAskingReset(false)}>取消</button>
        </div>
      )}

      <div className="scr-acc-body">
        {loading && !payload && <div className="scr-panel-note">升级数据载入中…</div>}
        {groups.map((group) => {
          const expanded = Boolean(open[group.id]);
          const percent = group.maxLevels ? Math.round((group.levels / group.maxLevels) * 100) : 0;
          return (
            <section
              key={group.id}
              className={`scr-acc-group${expanded ? ' is-open' : ''}`}
              style={{ '--scr-acc-color': group.color } as React.CSSProperties}
            >
              <button type="button" className="scr-acc-head" onClick={() => toggle(group.id)}>
                <span className="scr-acc-caret">{expanded ? '▾' : '▸'}</span>
                <span className="scr-acc-icon">{group.icon}</span>
                <span className="scr-acc-name">{group.name}</span>
                <span className="scr-acc-count">{group.lit} / {group.nodes.length} 项点亮 · {percent}%</span>
                {group.ready > 0 && <span className="scr-acc-badge">{group.ready} 项可解锁</span>}
                <span className="scr-acc-meter"><i style={{ width: `${percent}%` }} /></span>
              </button>
              {expanded && (
                <GroupList
                  group={group}
                  payload={payload}
                  busyId={busyId}
                  holdId={holdId}
                  holdProgress={holdProgress}
                  onBuy={onBuy}
                  onHoldStart={startHold}
                  onHoldCancel={cancelHold}
                  stateOf={stateOf}
                />
              )}
            </section>
          );
        })}
      </div>

      {holdId && <div className="scr-hold-hint">按住解锁中 · {Math.round(holdProgress * 100)}%（松手取消）</div>}
    </div>
  );
}

/** 一组里的节点列表：每行 = 图标 + 名称/等级/说明/效果 + 价格与解锁按钮。 */
function GroupList({ group, payload, busyId, holdId, holdProgress, onBuy, onHoldStart, onHoldCancel, stateOf }: {
  group: Group;
  payload: ScratchUpgradesPayload | null;
  busyId: string | null;
  holdId: string | null;
  holdProgress: number;
  onBuy: (id: string, name: string) => void;
  onHoldStart: (node: ScratchUpgrade) => void;
  onHoldCancel: () => void;
  stateOf: (node: ScratchUpgrade) => { key: string; label: string };
}) {
  return (
    <div className="scr-acc-list">
      {group.nodes.map((node) => {
        const state = stateOf(node);
        const holding = holdId === node.id;
        return (
          <div
            key={node.id}
            className={`scr-acc-row is-${state.key}${holding ? ' is-holding' : ''}`}
            onPointerDown={(event) => {
              // 按在「解锁」按钮上不算按住行（否则长按 3 秒会解锁两次）。
              if ((event.target as HTMLElement).closest('.scr-acc-buy')) return;
              onHoldStart(node);
            }}
            onPointerUp={onHoldCancel}
            onPointerLeave={onHoldCancel}
            onPointerCancel={onHoldCancel}
          >
            <span className="scr-acc-row-icon">{node.icon}</span>

            <div className="scr-acc-row-main">
              <div className="scr-acc-row-head">
                <span className="scr-acc-row-name">{node.name}</span>
                <span className="scr-acc-pips">
                  {Array.from({ length: node.maxLevel }, (_, index) => (
                    <span key={`pip-${node.id}-${index}`} className={`scr-pip${index < node.level ? ' is-on' : ''}`} />
                  ))}
                </span>
                <span className="scr-acc-row-level">{node.level} / {node.maxLevel}</span>
                <span className={`scr-acc-state is-${state.key}`}>{state.label}</span>
              </div>
              <span className="scr-acc-row-desc">{node.desc}</span>
              <div className="scr-acc-row-effect">
                <span>现在：{node.nowText}</span>
                <span className="scr-upgrade-next">下一级：{node.nextText}</span>
              </div>
              {node.requiresText && <span className="scr-acc-row-locked">{node.requiresText}</span>}
            </div>

            <div className="scr-acc-row-end">
              {node.cost ? (
                <>
                  <span className="scr-acc-cost">
                    <span className={(payload?.money ?? 0) >= node.cost.money ? '' : 'is-lack'}>💰 {node.cost.money}</span>
                    <span className={(payload?.scraps ?? 0) >= node.cost.scraps ? '' : 'is-lack'}>🧻 {node.cost.scraps}</span>
                  </span>
                  <button
                    type="button"
                    className="scr-top-button is-primary scr-acc-buy"
                    disabled={!node.buyable || Boolean(busyId)}
                    onClick={(event) => {
                      // 点按钮 = 立刻解锁；顺手取消行上的按住计时，免得重复触发。
                      event.stopPropagation();
                      onHoldCancel();
                      onBuy(node.id, node.name);
                    }}
                  >
                    {busyId === node.id ? '解锁中…' : '解锁'}
                  </button>
                </>
              ) : (
                <span className="scr-acc-cost is-none">{node.root ? '开局点亮' : '已满级'}</span>
              )}
            </div>

            {holding && <span className="scr-acc-holdbar"><i style={{ width: `${holdProgress * 100}%` }} /></span>}
          </div>
        );
      })}
    </div>
  );
}