'use client';

/**
 * 扑克牌面 SVG：自绘矢量牌面，无版权素材依赖，任意尺寸都清晰。
 * 牌面编码与服务端一致：点数 2..9/T/J/Q/K/A + 花色 s/h/d/c，例如 "Ah"、"Td"。
 */

const SUIT_SYMBOL: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const SUIT_COLOR: Record<string, string> = { s: '#0f172a', c: '#0f172a', h: '#be123c', d: '#be123c' };

function rankLabel(rank: string): string {
  return rank === 'T' ? '10' : rank;
}

export default function PlayingCard({
  card,
  width = 62,
  faceDown = false,
  dimmed = false,
  className = '',
}: {
  card?: string | null;
  width?: number;
  faceDown?: boolean;
  dimmed?: boolean;
  className?: string;
}) {
  const height = Math.round(width * 1.4);
  const hidden = faceDown || !card;

  if (hidden) {
    return (
      <svg viewBox="0 0 100 140" width={width} height={height} className={className} role="img" aria-label="暗牌">
        <defs>
          <linearGradient id="card-back-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1e3a8a" />
            <stop offset="100%" stopColor="#312e81" />
          </linearGradient>
          <pattern id="card-back-pattern" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill="none" />
            <circle cx="5" cy="5" r="1.6" fill="#93c5fd" opacity="0.5" />
          </pattern>
        </defs>
        <rect x="1" y="1" width="98" height="138" rx="9" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="1.5" />
        <rect x="5" y="5" width="90" height="130" rx="7" fill="url(#card-back-body)" />
        <rect x="5" y="5" width="90" height="130" rx="7" fill="url(#card-back-pattern)" />
        <rect x="12" y="12" width="76" height="116" rx="5" fill="none" stroke="#bfdbfe" strokeWidth="1.2" opacity="0.6" />
      </svg>
    );
  }

  const rank = card.slice(0, -1);
  const suit = card.slice(-1).toLowerCase();
  const symbol = SUIT_SYMBOL[suit] || '?';
  const color = SUIT_COLOR[suit] || '#0f172a';
  const label = rankLabel(rank);

  return (
    <svg
      viewBox="0 0 100 140"
      width={width}
      height={height}
      className={className}
      style={dimmed ? { filter: 'saturate(0.5) brightness(0.75)' } : undefined}
      role="img"
      aria-label={`${label}${symbol}`}
    >
      <defs>
        <linearGradient id="card-face-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#f1f5f9" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="98" height="138" rx="9" fill="url(#card-face-body)" stroke="#cbd5e1" strokeWidth="1.5" />
      <text x="12" y="30" fill={color} fontSize={label.length > 1 ? 24 : 28} fontWeight="900" fontFamily="ui-sans-serif, system-ui, sans-serif">{label}</text>
      <text x="13" y="50" fill={color} fontSize="20" fontFamily="ui-sans-serif, system-ui, sans-serif">{symbol}</text>
      <text x="50" y="82" textAnchor="middle" dominantBaseline="central" fill={color} fontSize="46" fontFamily="ui-sans-serif, system-ui, sans-serif" opacity="0.9">{symbol}</text>
      <g transform="rotate(180 50 70)">
        <text x="12" y="30" fill={color} fontSize={label.length > 1 ? 24 : 28} fontWeight="900" fontFamily="ui-sans-serif, system-ui, sans-serif">{label}</text>
        <text x="13" y="50" fill={color} fontSize="20" fontFamily="ui-sans-serif, system-ui, sans-serif">{symbol}</text>
      </g>
    </svg>
  );
}
