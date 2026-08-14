'use client';

// 3D骰子投掷组件：封装 dice-box-threejs（vendored在 ./dice-box-threejs，MIT协议，
// 原项目 https://github.com/3d-dice/dice-box-threejs），只在主屏幕上使用。
//
// 这个库不是React组件，是一个纯JS类，自己管理Three.js场景/Cannon-es物理引擎/渲染循环，
// 所以这里用 useRef+useEffect 在客户端手动初始化它，不能在SSR/静态预渲染阶段执行。
//
// 用法：外部通过 rollRequest 传入一次性的"投掷请求"（骰子表达式+唯一ID），
// 组件监测到 rollRequest.id 变化就触发一次新的投掷，动画结束后回调 onRollComplete。

import { useEffect, useRef, useState } from 'react';
import type { FlattenedRecipe } from '@/lib/diceExpression';

export interface DiceRollRequest {
  id: string;       // 唯一ID，用于判断是否是"新的"投掷请求（同一个ID不会重复触发）
  notation: string;  // 骰子表达式，如 "2d6+1d8"，语法见 DiceNotation.js
  // 按形状(d4/d6/d8/d10/d12/d20)单独指定的纹理，纹理图本身盖住骰子表面，
  // 颜色方案(colorset)不影响最终视觉，所以这里不再需要颜色相关字段
  shapeTextures?: Partial<Record<string, string>>;
  // 可选的"自定义表达式配方"(骰子分组+kh/kl取高取低+符号)：只有遥控器"自定义掷骰"标签页用表达式
  // 发起投掷时才会带上，主屏幕据此重新计算kh/kl明细+决定高亮哪些骰子。
  recipe?: FlattenedRecipe;
}

export interface DiceRollResultSet {
  num: number;
  type: string;   // 如 "d6"
  sides: number;
  total: number;
  // 这一组里每一颗骰子的原始点数(按摇出顺序)+骰子在引擎diceList里的全局索引(id)：
  // 自定义表达式的kh/kl取高取低需要拿到这份原始数据重新计算(引擎不认识kh/kl，total是"全部加总"，
  // 不是取高取低后的结果)，id还用于告诉3D场景该给哪几颗具体的骰子网格加发光描边。
  rolls?: { value: number; id: number }[];
}

export interface DiceRollResult {
  notation: string;
  sets: DiceRollResultSet[];
  modifier: number;
  total: number;
}

// 取高/取低高亮特效目标：投掷结果算完(kh/kl筛选完)之后，告诉3D场景该给哪几颗骰子加发光轮廓。
// id对应DiceRollResultSet.rolls[].id（骰子在引擎diceList里的全局索引），color决定描边颜色。
export interface DiceHighlightTarget {
  id: number;
  color: 'gold' | 'red';
}

// 多颗骰子重投请求：requestId变化就触发一次批量重投，dieIds对应引擎diceList里的全局索引。
export interface DiceRerollRequest {
  requestId: string;
  dieIds: number[];
}

interface DiceRollerProps {
  rollRequest: DiceRollRequest | null;
  onRollComplete?: (result: DiceRollResult) => void;
  onRollStart?: () => void;
  // 上一次投掷算出的kh/kl高亮目标：这个数组变化时（同一次投掷完成后才会有值），
  // 给对应的骰子网格加发光描边。传空数组/undefined则清空高亮。
  highlights?: DiceHighlightTarget[];
  // 仅缩放3D骰子网格，不改变随浏览器自适应的骰盘画布尺寸或计算结果面板。
  diceScale?: number;
  // 单颗骰子重投请求：场景里其余骰子原地不动，只让这一颗重新物理抛掷
  rerollRequest?: DiceRerollRequest | null;
  // 重投动画播完后回调，结果数组顺序与请求dieIds一致，父组件据此重新计算kh/kl明细+广播新结果
  onRerollComplete?: (requestId: string, results: { dieId: number; value: number }[]) => void;
}

export default function DiceRoller({ rollRequest, onRollComplete, onRollStart, highlights, diceScale = 1, rerollRequest, onRerollComplete }: DiceRollerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<any>(null);
  const readyRef = useRef(false);
  const lastRolledIdRef = useRef<string | null>(null);
  const pendingRequestRef = useRef<DiceRollRequest | null>(null);
  const lastRerollRequestIdRef = useRef<string | null>(null);
  const rerollingRef = useRef(false); // 同一时刻只处理一次重投，避免同一颗骰子的动画还没播完就又叠加一次
  const [ready, setReady] = useState(false);
  // 纹理配置：组件挂载时的初始快照，仅用于DiceBox构造函数的初始参数。
  // 注意——实际渲染时<DiceRoller>并不会每次投掷都重新挂载：display/page.tsx让结果展示停留
  // 120秒才收起，只要用户在这个窗口内换了骰子外观预设再投下一轮，diceRollRequest只是被替换成
  // 新对象，组件实例是同一个，不会重新走这段挂载逻辑。所以每次真正投掷前必须用下面的effect
  // 把最新的shapeTextures同步给已存在的DiceBox实例(updateConfig)，不能只依赖这个挂载时的快照。
  // colorset固定用'white'当基础颜色方案——纹理图本身会盖住骰子表面，颜色方案对最终视觉没有影响，
  // 只是dice-box-threejs内部仍然需要一个有效的colorset来算文字/描边等辅助信息，随便给个默认值即可。
  const shapeTexturesRef = useRef(rollRequest?.shapeTextures || {});

  // 初始化DiceBox（只在挂载时做一次）
  useEffect(() => {
    let cancelled = false;

    // 给容器一个唯一id，DiceBox构造函数需要一个选择器字符串
    const containerId = 'dice-roller-canvas-' + Math.random().toString(36).slice(2);
    if (containerRef.current) containerRef.current.id = containerId;

    import('./dice-box-threejs/index.js').then(async (mod) => {
      if (cancelled || !containerRef.current) return;
      const DiceBox = mod.default;

      const box = new DiceBox(`#${containerId}`, {
        assetPath: '/dice-assets/',
        sounds: true,
        theme_colorset: 'white',
        theme_shapeTextures: shapeTexturesRef.current,
        theme_material: 'glass',
        theme_surface: 'green-felt',
        gravity_multiplier: 400,
        light_intensity: 0.8,
        shadows: true,
        strength: 1.4, // 投掷力度稍强一点，动效更有冲击力
        onRollComplete: (result: DiceRollResult) => {
          onRollComplete?.(result);
        },
      });

      try {
        await box.initialize();
      } catch (e) {
        console.error('❌ 3D骰子初始化失败:', e);
        return;
      }

      if (cancelled) return;
      // 初始值必须在ready前应用：缩放effect可能已在初始化期间执行并提前返回。
      box.setDiceScale(diceScale);
      boxRef.current = box;
      readyRef.current = true;
      setReady(true);

      // 初始化期间可能已经有一个投掷请求在排队，初始化完成后立刻补投
      if (pendingRequestRef.current) {
        const req = pendingRequestRef.current;
        pendingRequestRef.current = null;
        lastRolledIdRef.current = req.id;
        onRollStart?.();
        box.updateConfig({ theme_shapeTextures: req.shapeTextures || {} }).then(() => {
          box.roll(req.notation);
        });
      }
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听投掷请求变化：每次真正投掷前，先把这次请求带的shapeTextures同步给DiceBox
  // (updateConfig会触发loadTheme重新加载纹理)，再真正roll——这样即使组件实例是复用的旧实例
  // (没有重新挂载)，纹理也总是跟这一次投掷选中的外观预设保持一致，不会停留在上一次的旧纹理。
  useEffect(() => {
    if (!rollRequest || rollRequest.id === lastRolledIdRef.current) return;

    if (!readyRef.current || !boxRef.current) {
      // 骰子还没初始化完，先记下来，初始化完成后自动补投一次
      pendingRequestRef.current = rollRequest;
      return;
    }

    lastRolledIdRef.current = rollRequest.id;
    onRollStart?.();
    boxRef.current.updateConfig({ theme_shapeTextures: rollRequest.shapeTextures || {} }).then(() => {
      boxRef.current.roll(rollRequest.notation);
    });
  }, [rollRequest, onRollStart]);

  // 直接缩放引擎内的骰子网格；画布/骰盘容器保持全尺寸自适应。
  useEffect(() => {
    if (!readyRef.current || !boxRef.current) return;
    boxRef.current.setDiceScale(diceScale);
  }, [diceScale]);

  // kh/kl高亮：结果算完后父组件才会给highlights传值，这里直接转发给3D引擎去加发光描边。
  // 组件每次投掷都是全新挂载（见display/page.tsx），所以不用担心"上一轮"残留高亮混进这一轮。
  useEffect(() => {
    if (!readyRef.current || !boxRef.current) return;
    boxRef.current.applyHighlights(highlights || []);
  }, [highlights]);

  // 批量重投：同一请求中的骰子由3D引擎同时物理抛掷，其余骰子保持原位。
  useEffect(() => {
    if (!rerollRequest || rerollRequest.requestId === lastRerollRequestIdRef.current) return;
    if (!readyRef.current || !boxRef.current || rerollingRef.current || rerollRequest.dieIds.length === 0) return;

    lastRerollRequestIdRef.current = rerollRequest.requestId;
    rerollingRef.current = true;
    const { requestId, dieIds } = rerollRequest;

    boxRef.current.reroll(dieIds).then((results: { value: number }[]) => {
      rerollingRef.current = false;
      const completed = dieIds.flatMap((dieId, index) => {
        const value = results[index]?.value;
        return typeof value === 'number' ? [{ dieId, value }] : [];
      });
      if (completed.length) onRerollComplete?.(requestId, completed);
    }).catch(() => {
      rerollingRef.current = false;
    });
  }, [rerollRequest, onRerollComplete]);

  return (
    <div className="absolute inset-0 w-full h-full">
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
          骰盘加载中...
        </div>
      )}
    </div>
  );
}
