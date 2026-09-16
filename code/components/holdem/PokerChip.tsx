'use client';

/**
 * 赌场筹码 SVG：经典配色 + 边缘凹槽 + 内圈虚线，纯矢量绘制，无外部图片依赖。
 * 面额沿用赌场惯例：1 白、5 红、25 绿、100 黑、500 紫、1000 金、5000 橙。
 */

export const CHIP_DENOMINATIONS = [5000, 1000, 500, 100, 25, 5, 1] as const;
export type ChipValue = (typeof CHIP_DENOMINATIONS)[number];

type ChipStyle = { body: string; bodyDark: string; edge: string; ring: string; text: string };

const CHIP_STYLES: Record<number, ChipStyle> = {
  1: { body: '#f8fafc', bodyDark: '#cbd5e1', edge: '#64748b', ring: '#94a3b8', text: '#1e293b' },
  5: { body: '#dc2626', bodyDark: '#991b1b', edge: '#fca5a5', ring: '#fee2e2', text: '#ffffff' },
  25: { body: '#15803d', bodyDark: '#14532d', edge: '#86efac', ring: '#dcfce7', text: '#ffffff' },
  100: { body: '#1e293b', bodyDark: '#0f172a', edge: '#94a3b8', ring: '#e2e8f0', text: '#ffffff' },
  500: { body: '#7e22ce', bodyDark: '#581c87', edge: '#d8b4fe', ring: '#f3e8ff', text: '#ffffff' },
  1000: { body: '#d97706', bodyDark: '#92400e', edge: '#fcd34d', ring: '#fef3c7', text: '#ffffff' },
  5000: { body: '#ea580c', bodyDark: '#9a3412', edge: '#fdba74', ring: '#ffedd5', text: '#ffffff' },
};

function styleFor(value: number): ChipStyle {
  const known = CHIP_DENOMINATIONS.find((denomination) => denomination === value);
  return CHIP_STYLES[known ?? 100] || CHIP_STYLES[100];
}

/** 大额缩写：1000 → 1K，5000 → 5K，便于在小尺寸筹码上显示。 */
export function formatChipValue(value: number): string {
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}K`;
  return String(value);
}

export function formatChips(amount: number): string {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.trunc(amount || 0)));
}

/** 把任意金额拆成尽量少的筹码面额，用于底池/下注额的堆叠展示。 */
export function breakIntoChips(amount: number, maxChips = 12): ChipValue[] {
  let remaining = Math.max(0, Math.trunc(amount || 0));
  const chips: ChipValue[] = [];
  for (const denomination of CHIP_DENOMINATIONS) {
    while (remaining >= denomination && chips.length < maxChips) {
      chips.push(denomination);
      remaining -= denomination;
    }
  }
  return chips;
}

export default function PokerChip({
  value,
  size = 48,
  className = '',
  title,
}: {
  value: number;
  size?: number;
  className?: string;
  title?: string;
}) {
  const style = styleFor(value);
  const gradientId = `chip-face-${value}`;
  // 边缘 6 个凹槽：用旋转的圆角矩形贴在轮辐上，形成经典筹码边纹。
  const notches = [0, 60, 120, 180, 240, 300];

  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={title || `${value} 筹码`}>
      {title ? <title>{title}</title> : null}
      <defs>
        <radialGradient id={gradientId} cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={style.body} />
          <stop offset="70%" stopColor={style.body} />
          <stop offset="100%" stopColor={style.bodyDark} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill={style.bodyDark} />
      <circle cx="50" cy="50" r="46" fill={`url(#${gradientId})`} />
      {notches.map((angle) => (
        <rect
          key={angle}
          x="44"
          y="1.5"
          width="12"
          height="15"
          rx="3"
          fill={style.edge}
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      <circle cx="50" cy="50" r="33" fill="none" stroke={style.ring} strokeWidth="1.5" strokeDasharray="4 3" opacity="0.75" />
      <circle cx="50" cy="50" r="28" fill={style.bodyDark} opacity="0.35" />
      <circle cx="50" cy="50" r="27" fill="none" stroke={style.ring} strokeWidth="1" opacity="0.6" />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill={style.text}
        fontSize={formatChipValue(value).length >= 3 ? 20 : 24}
        fontWeight="900"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {formatChipValue(value)}
      </text>
    </svg>
  );
}

/** 筹码堆：把金额拆成面额后错位叠放，用于底池与每个座位的下注额。 */
export function ChipStack({ amount, size = 26, className = '' }: { amount: number; size?: number; className?: string }) {
  const chips = breakIntoChips(amount, 8);
  if (!chips.length) return null;
  return (
    <div className={`inline-flex items-end ${className}`} title={`${formatChips(amount)} 筹码`}>
      <div className="relative" style={{ width: size + (chips.length - 1) * 5, height: size }}>
        {chips.map((chip, index) => (
          <div key={`${chip}-${index}`} className="absolute" style={{ left: index * 5, top: -index * 1.5, zIndex: index }}>
            <PokerChip value={chip} size={size} />
          </div>
        ))}
      </div>
      <span className="ml-2 text-xs font-black tabular-nums text-amber-100 drop-shadow">{formatChips(amount)}</span>
    </div>
  );
}
