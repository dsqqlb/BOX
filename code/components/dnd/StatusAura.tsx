'use client';

// 状态环绕动效：每种buff/debuff在角色卡片周围/边缘渲染一组专属的动态粒子，
// 而不是卡片内部的滤镜叠加。遥控器(page.tsx)和主屏幕(display/page.tsx)共用同一份视觉逻辑，
// 只通过 scale 参数调整尺寸（主屏幕卡片更大，粒子也应等比放大）。
//
// 用法：把 <StatusAura /> 作为卡片的"外层兄弟节点"渲染（父容器不能有 overflow-hidden，
// 否则超出卡片边界的粒子会被裁掉），具体动画定义在 app/globals.css 的
// "状态环绕动效" 区块（aura-* 系列class）。

import { CardEffectKey } from '@/lib/statusEffects';

interface StatusAuraProps {
  effect: CardEffectKey;
  color: string; // 十六进制颜色，驱动这个状态专属的粒子配色
  scale?: number; // 尺寸倍率，遥控器用1，主屏幕用更大的卡片时传>1
}

// 固定的粒子分布参数（用index公式算出，而不是Math.random），避免每次重渲染时粒子跳来跳去
function px(n: number, scale: number) {
  return `${Math.round(n * scale)}px`;
}

export default function StatusAura({ effect, color, scale = 1 }: StatusAuraProps) {
  switch (effect) {
    // ---- 增益光环：柔和的光点绕卡片旋转，传达"被祝福保护"的安心感 ----
    case 'buffGlow':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div
            className="absolute inset-[-14%] rounded-2xl aura-ring"
            style={{ borderColor: color, color, animationDuration: '2.2s' }}
          />
          {[0, 90, 180, 270].map((angle, i) => (
            <div
              key={i}
              className="absolute top-1/2 left-1/2 rounded-full aura-orbit-dot"
              style={{
                width: px(9, scale),
                height: px(9, scale),
                backgroundColor: color,
                boxShadow: `0 0 ${px(10, scale)} ${color}`,
                '--orbit-radius': px(64, scale),
                animationDuration: '3.4s',
                animationDelay: `${(angle / 360) * -3.4}s`,
                transform: `rotate(${angle}deg)`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      );

    // ---- 加速：左右两侧高速光线掠过，传达"变快了"的临场感 ----
    case 'haste':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[15, 50, 85].map((top, i) => (
            <div key={`l${i}`} className="absolute aura-streak" style={{
              top: `${top}%`, left: '-26%', width: px(30, scale), backgroundColor: color,
              boxShadow: `0 0 ${px(8, scale)} ${color}`,
              animationDuration: '0.9s', animationDelay: `${i * 0.25}s`,
            }} />
          ))}
          {[25, 60, 90].map((top, i) => (
            <div key={`r${i}`} className="absolute aura-streak" style={{
              top: `${top}%`, right: '-26%', width: px(30, scale), backgroundColor: color,
              boxShadow: `0 0 ${px(8, scale)} ${color}`,
              animationDuration: '0.9s', animationDelay: `${i * 0.25 + 0.4}s`,
              transform: 'scaleX(-1)',
            }} />
          ))}
        </div>
      );

    // ---- 狂暴：四角猛烈的火焰状光斑闪动 ----
    case 'rage':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[
            { top: '-14%', left: '-14%' }, { top: '-14%', right: '-14%' },
            { bottom: '-14%', left: '-14%' }, { bottom: '-14%', right: '-14%' },
          ].map((pos, i) => (
            <div key={i} className="absolute aura-flame" style={{
              ...pos,
              width: px(26, scale), height: px(32, scale),
              background: `radial-gradient(circle, ${color}, ${color}80 55%, transparent 75%)`,
              animationDelay: `${i * 0.15}s`,
            }} />
          ))}
        </div>
      );

    // ---- 恐慌：紫色的不安气流在卡片周围飘散 ----
    case 'tremble':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[10, 45, 80].map((left, i) => (
            <div key={i} className="absolute aura-wisp" style={{
              left: `${left}%`, bottom: '-6%',
              width: px(10, scale), height: px(10, scale),
              backgroundColor: color,
              animationDuration: `${2.4 + i * 0.3}s`, animationDelay: `${i * 0.5}s`,
            }} />
          ))}
        </div>
      );

    // ---- 目盲：灰黑色浓雾在卡片上方缓慢翻涌 ----
    case 'blind':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[20, 50, 78].map((left, i) => (
            <div key={i} className="absolute aura-wisp" style={{
              left: `${left}%`, top: '-4%',
              width: px(16, scale), height: px(12, scale),
              backgroundColor: '#0f172a',
              animationDuration: `${3 + i * 0.4}s`, animationDelay: `${i * 0.6}s`,
            }} />
          ))}
        </div>
      );

    // ---- 魅惑：粉色的心意菱形缓慢飘起 ----
    case 'charm':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[8, 32, 62, 88].map((left, i) => (
            <div key={i} className="absolute aura-heart" style={{
              left: `${left}%`,
              width: px(8, scale), height: px(8, scale),
              backgroundColor: color,
              transform: 'rotate(45deg)',
              animationDuration: `${2.6 + i * 0.3}s`, animationDelay: `${i * 0.5}s`,
            }} />
          ))}
        </div>
      );

    // ---- 耳聋：声波环从卡片两侧向外扩散消失 ----
    case 'deafen':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {['-14%', '50%'].map((pos, i) => (
            <div key={i} className="absolute top-1/2 -translate-y-1/2 rounded-full aura-ring" style={{
              left: i === 0 ? pos : undefined,
              right: i === 1 ? pos : undefined,
              width: px(30, scale), height: px(30, scale),
              borderColor: color,
              animationDuration: '1.8s', animationDelay: `${i * 0.7}s`,
            }} />
          ))}
        </div>
      );

    // ---- 擒抱/束缚：斜纹锁链在卡片边缘轻微晃动 ----
    case 'chain':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="absolute aura-chain" style={{
              top: `${20 + i * 28}%`, left: '-6%', right: '-6%',
              height: px(4, scale),
              background: `repeating-linear-gradient(45deg, ${color} 0px, ${color} ${px(4, scale)}, transparent ${px(4, scale)}, transparent ${px(10, scale)})`,
              animationDelay: `${i * 0.2}s`,
            }} />
          ))}
        </div>
      );

    // ---- 失能/倒地/昏迷：灰色虚弱气息缓慢下沉 ----
    case 'faint':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[15, 50, 85].map((left, i) => (
            <div key={i} className="absolute aura-wisp opacity-60" style={{
              left: `${left}%`, top: '40%',
              width: px(10, scale), height: px(10, scale),
              backgroundColor: color,
              animationDuration: `${3.5 + i * 0.4}s`, animationDelay: `${i * 0.7}s`,
            }} />
          ))}
        </div>
      );

    // ---- 隐形：虚线轮廓在卡片外围忽隐忽现 ----
    case 'invisible':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-[-12%] rounded-2xl aura-dash-ring" style={{ borderColor: color }} />
        </div>
      );

    // ---- 麻痹：静电火花沿卡片边缘随机跳动 ----
    case 'paralyze':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[
            { top: '2%', left: '-16%' }, { top: '28%', left: '108%' },
            { top: '60%', left: '-18%' }, { top: '86%', left: '110%' },
            { top: '8%', left: '46%' }, { top: '92%', left: '52%' },
          ].map((pos, i) => (
            <div key={i} className="absolute aura-spark" style={{
              ...pos,
              width: px(7, scale), height: px(20, scale),
              backgroundColor: color,
              boxShadow: `0 0 ${px(10, scale)} ${color}, 0 0 ${px(4, scale)} #fff`,
              animationDelay: `${i * 0.24}s`,
            }} />
          ))}
        </div>
      );

    // ---- 石化：卡片四角浮现灰白裂纹，缓慢闪烁 ----
    case 'petrify':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[
            { top: '2%', left: '2%', rotate: '20deg' },
            { top: '4%', right: '6%', rotate: '-25deg' },
            { bottom: '6%', left: '8%', rotate: '-15deg' },
            { bottom: '3%', right: '4%', rotate: '30deg' },
          ].map((pos, i) => (
            <div key={i} className="absolute aura-crack" style={{
              top: pos.top, left: pos.left, right: pos.right, bottom: pos.bottom,
              width: px(18, scale), height: px(2, scale),
              backgroundColor: color,
              transform: `rotate(${pos.rotate})`,
              animationDelay: `${i * 0.4}s`,
            }} />
          ))}
        </div>
      );

    // ---- 力竭：暗红色气息从底部两角缓慢升起侵蚀 ----
    case 'exhaustion':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[10, 40, 70, 92].map((left, i) => (
            <div key={i} className="absolute aura-particle-rise" style={{
              left: `${left}%`,
              width: px(7, scale), height: px(7, scale),
              backgroundColor: color,
              filter: 'blur(1px)',
              '--aura-duration': `${2.6 + i * 0.3}s`,
              '--aura-delay': `${i * 0.5}s`,
            } as React.CSSProperties} />
          ))}
        </div>
      );

    // ---- 中毒：绿色毒液泡泡沿卡片两侧向上飘升 ----
    case 'poison':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[
            { left: '2%', size: 9 }, { left: '20%', size: 7 }, { left: '80%', size: 10 },
            { left: '97%', size: 7 }, { left: '50%', size: 8 },
          ].map((b, i) => (
            <div key={i} className="absolute rounded-full aura-particle-rise" style={{
              left: b.left,
              width: px(b.size, scale), height: px(b.size, scale),
              backgroundColor: color,
              boxShadow: `0 0 ${px(8, scale)} ${color}`,
              '--aura-duration': `${2.2 + i * 0.3}s`,
              '--aura-delay': `${i * 0.4}s`,
            } as React.CSSProperties} />
          ))}
        </div>
      );

    // ---- 震慑：明黄色光点快速环绕卡片上方旋转 ----
    case 'stun':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          {[0, 120, 240].map((angle, i) => (
            <div key={i} className="absolute rounded-full aura-orbit-dot" style={{
              top: '-6%', left: '50%',
              width: px(7, scale), height: px(7, scale),
              backgroundColor: color,
              boxShadow: `0 0 ${px(5, scale)} ${color}`,
              '--orbit-radius': px(40, scale),
              animationDuration: '1.4s',
              animationDelay: `${(angle / 360) * -1.4}s`,
              transform: `rotate(${angle}deg)`,
            } as React.CSSProperties} />
          ))}
        </div>
      );

    // ---- 濒死：最高优先级的血色心跳冲击波，一圈圈向外扩散 ----
    case 'dying':
      return (
        <div className="absolute inset-0 pointer-events-none" aria-hidden>
          <div className="absolute inset-[-6%] rounded-2xl aura-heartbeat" style={{ borderColor: color }} />
          <div className="absolute inset-[-6%] rounded-2xl aura-heartbeat" style={{ borderColor: color, animationDelay: '0.65s' }} />
          {[20, 80].map((left, i) => (
            <div key={i} className="absolute aura-particle-rise" style={{
              left: `${left}%`,
              width: px(6, scale), height: px(6, scale),
              backgroundColor: color,
              '--aura-duration': '2.2s',
              '--aura-delay': `${i * 0.6}s`,
            } as React.CSSProperties} />
          ))}
        </div>
      );

    default:
      return null;
  }
}
