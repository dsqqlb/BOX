'use client';

/**
 * 出牌方向箭头：桌面上对称的两条弧形箭头，指向当前出牌方向，并朝该方向缓慢旋转。
 * 顺时针时整体顺时针转，逆时针时反向转（和育碧那款电子 UNO 一样）。
 */

export default function DirectionArrows({
  direction,
  size = 210,
  className = '',
}: {
  direction: 1 | -1;
  size?: number;
  className?: string;
}) {
  const active = direction === -1 ? '#38bdf8' : '#f5b21a';
  const spin = direction === -1
    ? 'animate-spin [animation-duration:26s] [animation-direction:reverse]'
    : 'animate-spin [animation-duration:26s]';

  return (
    <svg viewBox="0 0 200 200" width={size} height={size} className={`${spin} ${className}`} aria-hidden="true">
      <circle cx={100} cy={100} r={70} fill="none" stroke="#ffffff" strokeWidth={1.5} opacity={0.12} />
      <g fill="none" stroke={active} strokeWidth={7} strokeLinecap="round" opacity={0.85}>
        <path d="M 30 100 A 70 70 0 0 1 170 100" />
        <path d="M 170 100 A 70 70 0 0 1 30 100" />
      </g>
      <g fill={active} opacity={0.9}>
        <polygon points="162,88 178,88 170,107" />
        <polygon points="22,112 38,112 30,93" />
      </g>
    </svg>
  );
}