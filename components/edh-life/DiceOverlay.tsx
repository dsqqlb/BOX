'use client';

/**
 * EDH 记血器 —— 3D 骰盘 / 硬币遮罩层。
 *
 * 复用先攻主屏那套 3D 引擎（components/dnd/DiceRoller + dice-box-threejs）。
 * 与主屏的差别，都是为"四个人围着一张方桌、其中两个人看到的是倒过来的画面"设计的：
 *
 *   1. 结果面板**上下各一份，下面那份旋转 180°**，四个方向都能正着读到结果；
 *   2. 收起方式两种：**7 秒后自动消失**，或**点击任意处立即消失**；
 *   3. 骰盘常驻挂载（不随收起卸载），页面进来自动预热，第二次投掷不用重下 three.js。
 *
 * 关于 kh/kl：骰子引擎只认 NdS，不认识"取高取低"。带 kh/kl 的表达式由页面先用
 * lib/diceExpression 解析成纯 NdS 交给引擎，再把引擎的原始点数用 evaluateRecipe
 * 重新分账（被丢弃的骰子划线变灰，总计按保留的骰子算）。这些都发生在这一层：
 * 引擎结果一回来就立刻重算，所以面板显示的永远是筛过之后的结果。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import DiceRoller, { type DiceRollRequest, type DiceRollResult } from '@/components/dnd/DiceRoller';
import {
  evaluateRecipe, type EngineResultSet, type EvaluatedExpression, type ExprNode, type FlattenedRecipe,
} from '@/lib/diceExpression';
import { coinFaceForValue, coinLabel, type RollRecord } from '@/lib/edh-life/types';

export const AUTO_DISMISS_MS = 7000;
/**
 * 引擎看门狗：骰子引擎在一次投掷还没结束（物理还在落地判定）时收到新的投掷，
 * 会把新的那次吞掉——完成回调永远不触发，界面就永久停在骰盘上。
 * 所以这里给"发出请求 → 收到结果"加一个上限，超时就当作这次投掷失败并收起遮罩，
 * 至少不会把界面锁死。正常的投掷一般 2~4 秒出结果。
 */
export const ROLL_WATCHDOG_MS = 12000;
/** 两次投掷之间留一点间隔，让引擎把上一轮异步清场做完。 */
const ROLL_GAP_MS = 200;

export type RollKind = 'dice' | 'coin';

export interface ActiveRoll {
  kind: RollKind;
  /** 展示用的原始输入（自定义表达式就显示用户写的那串） */
  notation: string;
  /** 真正交给 3D 引擎的纯 NdS 表达式 */
  engineNotation: string;
  seat: number | null;
  /** 引擎用的形状纹理（硬币会传 { d2: ... }） */
  shapeTextures?: Record<string, string>;
  /** 带 kh/kl 的表达式：摇完要按这份配方重新分账 */
  recipe?: FlattenedRecipe;
  exprNode?: ExprNode;
}

interface DiceOverlayProps {
  /** 非空即触发一次投掷（用 id 判重） */
  request: DiceRollRequest | null;
  activeRoll: ActiveRoll | null;
  /** 只缩放 3D 骰子本身，不改画布尺寸（设置里可调） */
  diceScale?: number;
  onComplete: (result: DiceRollResult, roll: ActiveRoll, record: RollRecord) => void;
  onDismiss?: () => void;
}

/** 面板上的一块骰子：值 + 是否被 kh/kl 丢弃 + 形状；硬币块用 face 表示面别 */
interface PanelItem {
  key: string;
  text: string;
  sub?: string;
  discarded?: boolean;
}

interface PanelGroup {
  key: string;
  label?: string;
  items: PanelItem[];
}

interface PanelData {
  title: string;
  notation: string;
  totalLabel: string;
  total: string;
  groups: PanelGroup[];
  coinFace?: 'one' | 'sun';
  accent: string;
}

/** 引擎结果 → evaluateRecipe 需要的形状（顺带过滤掉 kh/kl 丢弃的骰子） */
function toEngineSets(result: DiceRollResult): EngineResultSet[] {
  return result.sets.map((set) => ({
    sides: set.sides,
    rolls: (set.rolls || []).map((roll) => ({ value: roll.value, id: roll.id })),
  }));
}

function buildCoinPanel(roll: ActiveRoll, result: DiceRollResult): PanelData {
  const items: PanelItem[] = [];
  let coinFace: 'one' | 'sun' | undefined;
  for (const set of result.sets) {
    const rolls = set.rolls && set.rolls.length ? set.rolls : [{ value: set.total, id: 0 }];
    for (const die of rolls) {
      const face = coinFaceForValue(die.value);
      coinFace = face;
      items.push({ key: `coin-${die.id}`, text: coinLabel(face), sub: face === 'sun' ? '正面' : '反面' });
    }
  }
  return {
    title: '硬币',
    notation: '正 / 反',
    totalLabel: '结果',
    total: coinFace ? coinLabel(coinFace) : '—',
    groups: [{ key: 'coin', items }],
    coinFace,
    accent: coinFace === 'sun' ? '#f0c25a' : '#e0b060',
  };
}

function buildDicePanel(roll: ActiveRoll, result: DiceRollResult, evaluated: EvaluatedExpression | null): PanelData {
  // 带 kh/kl：按配方分组展示，丢弃的骰子划线变灰，总计用筛选后的值
  if (evaluated) {
    const groups: PanelGroup[] = evaluated.groups.map((group, index) => ({
      key: `g${index}`,
      label: `${group.count}d${group.sides}${group.keep ? `（取${group.keep.mode === 'kh' ? '高' : '低'}${group.keep.amount}）` : ''}${group.sign < 0 ? ' 减' : ''}`,
      items: group.rolls.map((diceRoll) => ({
        key: `g${index}-${diceRoll.id}`,
        text: String(diceRoll.value),
        sub: `d${group.sides}`,
        discarded: diceRoll.discarded,
      })),
    }));
    return {
      title: '掷骰结果',
      notation: roll.notation,
      totalLabel: '总计',
      total: String(evaluated.total),
      groups,
      accent: '#c9a3ff',
    };
  }

  // 普通 NdS：原样显示引擎给的点数
  const groups: PanelGroup[] = result.sets.map((set, index) => ({
    key: `s${index}`,
    label: `${set.num}${set.type}`,
    items: (set.rolls && set.rolls.length
      ? set.rolls.map((die) => ({ key: `s${index}-${die.id}`, text: String(die.value), sub: set.type }))
      : Array.from({ length: set.num }, (_, i) => ({ key: `s${index}-${i}`, text: String(set.total / Math.max(set.num, 1)), sub: set.type }))),
  }));
  return {
    title: '掷骰结果',
    notation: roll.notation,
    totalLabel: '总计',
    total: String(result.total),
    groups,
    accent: '#c9a3ff',
  };
}

export default function DiceOverlay({ request, activeRoll, diceScale = 1, onComplete, onDismiss }: DiceOverlayProps) {
  const [visible, setVisible] = useState(false);
  const [panel, setPanel] = useState<PanelData | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 引擎正在投掷：这期间不能把新请求交给它，否则那次投掷会被吞掉（完成回调永不触发，界面卡死在骰盘上）。
  // 所以新请求先排队，等当前这次结束后立刻自动发出。
  const engineBusyRef = useRef(false);
  const queuedRef = useRef<DiceRollRequest | null>(null);
  const [engineRequest, setEngineRequest] = useState<DiceRollRequest | null>(null);
  // 引擎卡死时递增：作为 DiceRoller 的 key，强制重建一个干净的 3D 骰盘实例。
  const [engineEpoch, setEngineEpoch] = useState(0);
  const attemptRef = useRef<{ notation: string; tries: number } | null>(null);
  const gapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前这一轮的信息用 ref 保存：投掷 effect 只认 request.id，
  // 绝不能因为 activeRoll 变化而重跑——否则收起遮罩（activeRoll 置空）会被当成新投掷，
  // 表现就是"点一下屏幕又投一次"。
  const activeRollRef = useRef<ActiveRoll | null>(null);
  const lastHandledIdRef = useRef<string | null>(null);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => { activeRollRef.current = activeRoll; }, [activeRoll]);

  const clearTimers = useCallback(() => {
    if (dismissTimerRef.current) { clearTimeout(dismissTimerRef.current); dismissTimerRef.current = null; }
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (gapRef.current) { clearTimeout(gapRef.current); gapRef.current = null; }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setVisible(false);
    setPanel(null);
    attemptRef.current = null;
    onDismiss?.();
  }, [clearTimers, onDismiss]);

  /** 引擎空闲时才能真的投；忙就先排队，等 handleComplete 里再发。 */
  const issueIfIdle = useCallback(() => {
    if (engineBusyRef.current) return;
    const next = queuedRef.current;
    if (!next) return;
    queuedRef.current = null;
    engineBusyRef.current = true;
    clearTimers();
    // 给引擎留一点点喘息：上一轮的清场是异步的（clearDice 里有 setTimeout 渲染）
    gapRef.current = setTimeout(() => {
      setEngineRequest(next);
      watchdogRef.current = setTimeout(() => {
        const attempt = attemptRef.current;
        const tries = (attempt?.tries ?? 0) + 1;
        engineBusyRef.current = false;
        if (attempt && tries <= 1) {
          console.warn('[edh-life] 骰子引擎未返回结果，重建骰盘并重投一次');
          attemptRef.current = { notation: attempt.notation, tries };
          queuedRef.current = { id: `retry_${Date.now()}`, notation: attempt.notation };
          setEngineEpoch((value) => value + 1);
          setEngineRequest(null);
          issueIfIdle();
          return;
        }
        console.warn('[edh-life] 骰子引擎连续两次未返回结果，收起骰盘');
        attemptRef.current = null;
        queuedRef.current = null;
        setEngineRequest(null);
        setVisible(false);
        setPanel(null);
        onDismiss?.();
      }, ROLL_WATCHDOG_MS);
    }, ROLL_GAP_MS);
  }, [clearTimers, onDismiss]);

  // 新的一次投掷：只认 request.id 变化，避免被 activeRoll 之类的变化重复触发
  useEffect(() => {
    if (!request) return;
    if (request.id === lastHandledIdRef.current) return;
    lastHandledIdRef.current = request.id;
    clearTimers();
    setVisible(true);
    setPanel(null);
    // 同一时刻只保留最新的一次请求（连点两次只投最后一次）
    queuedRef.current = request;
    attemptRef.current = { notation: request.notation, tries: 0 };
    issueIfIdle();
  }, [request, clearTimers, issueIfIdle]);

  // 这个回调必须保持稳定：DiceRoller 内部用它触发"投掷完成 → 显示结果"，
  // 如果它每次渲染都换新函数，配合下面 DiceRoller 的重挂就会重复投掷。
  const handleComplete = useCallback((result: DiceRollResult) => {
    const roll = activeRollRef.current;
    if (!roll) return;
    const evaluated = roll.recipe ? evaluateRecipe(roll.recipe, toEngineSets(result)) : null;
    const data = roll.kind === 'coin'
      ? buildCoinPanel(roll, result)
      : buildDicePanel(roll, result, evaluated);
    setPanel(data);

    const isCoin = roll.kind === 'coin';
    const values = result.sets.flatMap((set) => (set.rolls?.length ? set.rolls.map((die) => die.value) : [set.total]));
    const record: RollRecord = {
      id: `roll_${Date.now()}`,
      at: Date.now(),
      source: isCoin ? 'coin' : 'dice',
      notation: isCoin ? 'coin' : roll.notation,
      total: isCoin ? (data.coinFace === 'one' ? 1 : 2) : (evaluated ? evaluated.total : result.total),
      seat: roll.seat,
      values,
      coinFace: data.coinFace,
    };
    onCompleteRef.current?.(result, roll, record);

    // 结果出来后再开始 7 秒倒计时（动画期间不计时）
    clearTimers();
    engineBusyRef.current = false;
    attemptRef.current = null;
    dismissTimerRef.current = setTimeout(() => dismiss(), AUTO_DISMISS_MS);
    // 排队里还有新的一次（比如连点两次）：这一轮显示完就自动接着投
    gapRef.current = setTimeout(() => { issueIfIdle(); }, ROLL_GAP_MS * 2);
  }, [clearTimers, dismiss, issueIfIdle]);

  useEffect(() => clearTimers, [clearTimers]);

  return (
    <div
      className={`edh-dice-overlay${visible ? ' is-visible' : ''}`}
      aria-hidden={!visible}
      onPointerDown={(e) => {
        // 点击任意处立即收起（骰盘本身不需要交互）
        if (visible) { e.preventDefault(); dismiss(); }
      }}
    >
      <div className="edh-dice-canvas">
        <DiceRoller key={engineEpoch} rollRequest={engineRequest} diceScale={diceScale} onRollComplete={handleComplete} />
      </div>

      {panel && (
        <>
          <ResultPanel data={panel} position="top" />
          <ResultPanel data={panel} position="bottom" />
          <div className="edh-dice-hint">点击任意处立即收起</div>
        </>
      )}
    </div>
  );
}

function ResultPanel({ data, position }: { data: PanelData; position: 'top' | 'bottom' }) {
  return (
    <div className={`edh-result-panel edh-result-${position}`} style={{ transform: position === 'bottom' ? 'rotate(180deg)' : undefined }}>
      <div className="edh-result-head">
        <span className="edh-result-title">{data.title}</span>
        <span className="edh-result-notation">{data.notation}</span>
      </div>
      <div className="edh-result-items">
        {data.groups.map((group) => (
          <div key={group.key} className="edh-result-group">
            {group.label && <span className="edh-result-group-label">{group.label}</span>}
            <div className="edh-result-group-dice">
              {group.items.map((item) => (
                <div
                  key={item.key}
                  className={`edh-result-die${item.discarded ? ' is-discarded' : ''}${data.coinFace ? ' is-coin' : ''}`}
                >
                  <span className="edh-result-die-value">{item.text}</span>
                  {item.sub && <span className="edh-result-die-sub">{item.sub}</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="edh-result-total" style={{ color: data.accent }}>
        <span className="edh-result-total-label">{data.totalLabel}</span>
        <span className="edh-result-total-value">{data.total}</span>
      </div>
    </div>
  );
}
