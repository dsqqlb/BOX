'use client';

// 骰子形状图标：结果面板里每颗骰子从"纯文字"换成"能看出是D几的形状轮廓"。
// 遥控器和主屏幕共用这一个组件——用简化的几何轮廓代表每种面数(不追求3D还原度，只求一眼区分)：
// D4三角形 / D6正方形 / D8菱形 / D10风筝形(D100共用+00角标) / D12五边形 / D20六边形，
// 这也是桌游类App(Roll20等)常见的简化画法。轮廓中间叠数字，轮廓下方再加一个"D几"小字标，
// 双重标识，不用只靠形状去猜。

export type DiceShapeIconState = 'idle' | 'selected' | 'used' | 'rerolling';

interface DiceShapeIconProps {
  sides: number;
  value: number;
  state?: DiceShapeIconState;
  onClick?: () => void;
  size?: number; // 图标整体边长(正方形容器)，默认56
  className?: string;
}

// 每种面数的SVG轮廓path，统一画在 0~100 的viewBox里，方便和文字叠加对齐
const SHAPE_PATHS: Record<number, string> = {
  4: 'M50 6 L94 88 L6 88 Z', // 三角形
  6: 'M12 12 L88 12 L88 88 L12 88 Z', // 正方形
  8: 'M50 4 L92 50 L50 96 L8 50 Z', // 菱形
  10: 'M50 4 L88 36 L74 92 L26 92 L12 36 Z', // 风筝形(五边形变体，D10常见画法)
  12: 'M50 4 L93 36 L77 90 L23 90 L7 36 Z', // 五边形
  20: 'M50 4 L92 27 L92 73 L50 96 L8 73 L8 27 Z', // 正六边形
  2: 'M50 10 A40 40 0 1 1 49.9 10 Z', // 硬币(圆形)
};

// D100借用D10的轮廓，靠角标"00"区分；其它未列出的面数(理论上不会出现，SUPPORTED_SIDES已限定范围)兜底用六边形
function getShapePath(sides: number): string {
  if (sides === 100) return SHAPE_PATHS[10];
  return SHAPE_PATHS[sides] || SHAPE_PATHS[20];
}

const STATE_STYLES: Record<DiceShapeIconState, { stroke: string; fill: string; textColor: string; opacity: number }> = {
  idle: { stroke: '#a855f7', fill: 'rgba(168,85,247,0.12)', textColor: '#e9d5ff', opacity: 1 },
  selected: { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.2)', textColor: '#fef3c7', opacity: 1 },
  used: { stroke: '#475569', fill: 'rgba(71,85,105,0.15)', textColor: '#64748b', opacity: 0.6 },
  rerolling: { stroke: '#facc15', fill: 'rgba(250,204,21,0.15)', textColor: '#fde68a', opacity: 1 },
};

export default function DiceShapeIcon({
  sides,
  value,
  state = 'idle',
  onClick,
  size = 56,
  className = '',
}: DiceShapeIconProps) {
  const style = STATE_STYLES[state];
  const clickable = (state === 'idle' || state === 'selected') && !!onClick;
  const shapeLabel = sides === 100 ? 'D100' : `D${sides}`;

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={`relative flex flex-col items-center gap-0.5 transition-transform ${
        clickable ? 'cursor-pointer hover:scale-110' : 'cursor-default'
      } ${state === 'rerolling' ? 'animate-pulse' : ''} ${className}`}
      style={{ opacity: style.opacity, width: size }}
      title={clickable ? (state === 'selected' ? `取消选择这颗D${sides}` : `选择这颗D${sides}重投（当前${value}点）`) : undefined}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} className="drop-shadow-sm">
        <path
          d={getShapePath(sides)}
          fill={style.fill}
          stroke={style.stroke}
          strokeWidth={5}
          strokeLinejoin="round"
        />
        <text
          x="50"
          y={sides === 4 ? 68 : 58}
          textAnchor="middle"
          fontSize={sides === 4 ? 26 : 30}
          fontWeight="900"
          fill={style.textColor}
        >
          {value}
        </text>
        {sides === 100 && (
          <text x="50" y="82" textAnchor="middle" fontSize="14" fontWeight="700" fill={style.textColor}>
            ×10
          </text>
        )}
      </svg>
      {/* 形状轮廓下方的文字标识，双重保险区分是D几，不用只靠轮廓形状去猜 */}
      <span className="text-[10px] font-bold tracking-wide" style={{ color: style.stroke }}>
        {shapeLabel}
      </span>
      {/* 已用过重投机会的小角标 */}
      {state === 'used' && (
        <span
          className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-black text-slate-950"
          style={{ backgroundColor: '#94a3b8' }}
          title="已重投过，不能再重投"
        >
          ↻
        </span>
      )}
    </button>
  );
}
