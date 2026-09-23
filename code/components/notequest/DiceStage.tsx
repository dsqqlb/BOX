'use client';

/**
 * NoteQuest 的 3D 骰子回放层。
 *
 * 引擎是"即时结算"的：动作一返回，掷骰结果就已经写进状态与日志。
 * 这一层只是把刚才那批掷骰按顺序播给玩家看（复用先攻主屏那套 3D 引擎，
 * 与 EDH 记血器用的是同一个组件 @/components/dnd/DiceRoller）。
 *
 * 节奏：投掷动画结束 → 卡片上显示明细 → 停留 2 秒 → 自动投下一颗；
 * 动画还在飞的时候点屏幕不会跳过，避免把引擎正在进行的物理判定吃掉。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import DiceRoller, { type DiceRollRequest } from '@/components/dnd/DiceRoller';
import type { RollRecord } from '@/lib/notequest/types';

/** 引擎看门狗：正常的投掷 2~4 秒出结果，超过这个时间就当失败并继续往下播。 */
const ROLL_WATCHDOG_MS = 12000;
/** 结果卡停留时间。 */
const HOLD_MS = 2000;

/**
 * 把引擎的展示用 notation（比如「2d6取高」）收敛成 3D 引擎认识的纯 NdS 表达式，
 * 并用 `@点数` 把**引擎已经算好的结果钉在骰面上**。
 *
 * 这一步是「骰子显示和结果不符」的修复关键：以前只把表达式交给 3D 引擎，
 * 它自己物理滚出随机点数，于是屏幕上看到的骰子和卡片上的结果两张皮。
 * DiceNotation 支持 `2d6@3,5` 这种强制结果（引擎内部会 swapDiceFace），
 * 所以现在看到的每一颗骰子都等于引擎真正用的那一次掷骰。
 */
function engineNotation(roll: RollRecord): string {
  const match = roll.notation.match(/(\d*)d(\d+)/i);
  const count = match?.[1] ? Number(match[1]) : 1;
  const sides = match?.[2] ? Number(match[2]) : 6;
  const faces = (roll.values ?? []).filter((value) => Number.isFinite(value) && value > 0);
  const base = `${Math.max(1, count)}d${sides}`;
  if (!faces.length) return base;
  return `${base}@${faces.join(',')}`;
}

interface DiceStageProps {
  rolls: RollRecord[];
  onDone: () => void;
  diceScale?: number;
}

export default function DiceStage({ rolls, onDone, diceScale = 1 }: DiceStageProps) {
  const [index, setIndex] = useState(0);
  const [request, setRequest] = useState<DiceRollRequest | null>(null);
  const [settled, setSettled] = useState(false);
  const watchdogRef = useRef<number | null>(null);
  const holdRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  const current = rolls[index] ?? null;

  useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

  const clearTimers = useCallback(() => {
    if (watchdogRef.current) { window.clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (holdRef.current) { window.clearTimeout(holdRef.current); holdRef.current = null; }
  }, []);

  const advance = useCallback(() => {
    clearTimers();
    setIndex((value) => value + 1);
  }, [clearTimers]);

  const handleComplete = useCallback(() => {
    clearTimers();
    setSettled(true);
    holdRef.current = window.setTimeout(() => advance(), HOLD_MS);
  }, [advance, clearTimers]);

  useEffect(() => {
    if (!current) {
      onDoneRef.current();
      return;
    }
    setSettled(false);
    setRequest({ id: `${current.id}-${index}`, notation: engineNotation(current) });
    watchdogRef.current = window.setTimeout(() => { setSettled(true); holdRef.current = window.setTimeout(() => advance(), HOLD_MS); }, ROLL_WATCHDOG_MS);
    return clearTimers;
  }, [current, index, advance, clearTimers]);

  if (!current) return null;

  return (
    <div
      className="nq-dice-overlay"
      onPointerDown={(event) => {
        // 只允许在结果已经落地时点击推进，避免打断引擎正在进行的一次投掷
        if (!settled) return;
        event.preventDefault();
        advance();
      }}
    >
      <div className="nq-dice-canvas">
        <DiceRoller rollRequest={request} diceScale={diceScale} onRollComplete={() => handleComplete()} />
      </div>
      <div className={`nq-dice-card${settled ? ' is-settled' : ''}`}>
        <p className="nq-dice-goal">为了</p>
        <p className="nq-dice-label">{current.label}</p>
        <p className="nq-dice-notation">{current.notation}</p>
        {settled ? (
          <p className="nq-dice-total">
            <span className="nq-dice-detail">{current.detail}</span>
            <span className="nq-dice-equals">=</span>
            <span className="nq-dice-value">{current.total}</span>
          </p>
        ) : (
          <p className="nq-dice-total nq-dice-total-pending">骰子还在滚……</p>
        )}
        <p className="nq-dice-hint">{index + 1} / {rolls.length} · 点一下继续</p>
      </div>
    </div>
  );
}