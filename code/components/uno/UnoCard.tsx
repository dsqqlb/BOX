'use client';

/**
 * 自绘 SVG 卡面（无任何外部素材依赖，任意尺寸都清晰）。
 *
 * 造型参考育碧那款电子 UNO：白卡 + 圆角彩色牌身 + 中间白色椭圆里的图案 + 两角数字，
 * 万能牌是四色风车，牌背是深蓝底 + 红色椭圆 + 斜体 UNO。
 *
 * 拓展牌走兜底分支：直接取 catalog 里 `art.glyph` 的文字，所以以后加拓展包不用改这个文件。
 */

import { useId } from 'react';
import type { UnoCardView, UnoCatalog } from '@/lib/uno/types';
import { colorHex, cardGlyph, kindName } from '@/lib/uno/catalog';

const VIEW_W = 120;
const VIEW_H = 180;
const OFFICIAL = ['#e63329', '#f5b21a', '#2f9e44', '#1c6fd6'];

/** 万能牌风车用的四色：优先取 catalog，缺了就用官方色兜底。 */
function wildColors(catalog: UnoCatalog | null): string[] {
  const colors = (catalog?.colors || []).map((color) => color.hex);
  return OFFICIAL.map((hex, index) => colors[index] || hex);
}

/** 牌面中央的图案：数字用文字，禁止/反转/+2 用手绘矢量。 */
function Glyph({ card, catalog, ink }: { card: UnoCardView; catalog: UnoCatalog | null; ink: string }) {
  if (card.kind === 'skip') {
    return (
      <g stroke={ink} strokeWidth={9} fill="none" strokeLinecap="round">
        <circle cx={0} cy={0} r={30} />
        <line x1={-21} y1={21} x2={21} y2={-21} />
      </g>
    );
  }

  if (card.kind === 'reverse') {
    return (
      <g fill={ink}>
        <path d="M-30 -4 L-6 -18 L-6 10 Z" />
        <path d="M30 4 L6 18 L6 -10 Z" />
        <rect x={-26} y={-5} width={52} height={9} rx={4} />
      </g>
    );
  }

  if (card.kind === 'draw2' || card.kind === 'wild4') {
    const count = card.kind === 'draw2' ? 2 : 4;
    return (
      <g>
        <g fill={ink} opacity={0.9}>
          <rect x={-36} y={-28} width={26} height={38} rx={5} transform="rotate(-14 -23 -9)" />
          <rect x={10} y={-14} width={26} height={38} rx={5} transform="rotate(14 23 5)" />
        </g>
        <text x={0} y={32} textAnchor="middle" fill={ink} fontSize={34} fontWeight="900" fontFamily="ui-sans-serif, system-ui, sans-serif">
          +{count}
        </text>
      </g>
    );
  }

  return (
    <text
      x={0}
      y={card.kind === 'number' ? 16 : 12}
      textAnchor="middle"
      fill={ink}
      fontSize={card.kind === 'number' ? 62 : 34}
      fontWeight="900"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      {cardGlyph(catalog, card)}
    </text>
  );
}

export default function UnoCard({
  card,
  catalog = null,
  width = 96,
  faceDown = false,
  dimmed = false,
  playable = false,
  className = '',
  style,
}: {
  card?: UnoCardView | null;
  catalog?: UnoCatalog | null;
  width?: number;
  faceDown?: boolean;
  dimmed?: boolean;
  playable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const height = Math.round((width * VIEW_H) / VIEW_W);
  const rawId = useId();
  // 牌背渐变必须每个实例一个 id：桌面上牌背有很多张，
  // 而且座位里的小牌背在小屏上是 display:none 的，共用 id 会让那张拿不到渐变。
  const backId = `uno-back-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  if (faceDown || !card) {
    return (
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width={width} height={height} className={className} style={style} role="img" aria-label="牌背">
        <defs>
          <linearGradient id={backId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1b2a5c" />
            <stop offset="100%" stopColor="#0b1230" />
          </linearGradient>
        </defs>
        <rect x={2} y={2} width={VIEW_W - 4} height={VIEW_H - 4} rx={15} fill="#f8fafc" />
        <rect x={7} y={7} width={VIEW_W - 14} height={VIEW_H - 14} rx={12} fill={`url(#${backId})`} />
        <g transform="rotate(-20 60 90)">
          <ellipse cx={60} cy={90} rx={40} ry={26} fill="#e63329" stroke="#ffffff" strokeWidth={2.5} opacity={0.92} />
          <text x={60} y={101} textAnchor="middle" fill="#ffd54a" fontSize={30} fontWeight="900" fontStyle="italic" fontFamily="ui-sans-serif, system-ui, sans-serif">
            UNO
          </text>
        </g>
      </svg>
    );
  }

  const isWild = card.color === 'wild';
  const body = colorHex(catalog, card.color);
  const label = card.kind === 'number' ? String(card.value) : cardGlyph(catalog, card);

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width={width}
      height={height}
      className={className}
      style={{
        ...style,
        filter: dimmed ? 'saturate(.55) brightness(.72)' : playable ? 'drop-shadow(0 0 9px rgba(110,231,183,.8))' : undefined,
      }}
      role="img"
      aria-label={card.kind === 'number' ? `${card.value}` : kindName(catalog, card.kind)}
    >
      <rect
        x={2}
        y={2}
        width={VIEW_W - 4}
        height={VIEW_H - 4}
        rx={15}
        fill="#f8fafc"
        stroke={playable ? '#6ee7b7' : '#cbd5e1'}
        strokeWidth={playable ? 3 : 1.5}
      />
      <rect x={7} y={7} width={VIEW_W - 14} height={VIEW_H - 14} rx={12} fill={body} />

      {isWild && (
        <g>
          {[
            { cx: 34, cy: 44, rotate: -18 },
            { cx: 86, cy: 44, rotate: 18 },
            { cx: 34, cy: 136, rotate: 18 },
            { cx: 86, cy: 136, rotate: -18 },
          ].map((corner, index) => (
            <ellipse
              key={`${corner.cx}-${corner.cy}`}
              cx={corner.cx}
              cy={corner.cy}
              rx={30}
              ry={22}
              fill={wildColors(catalog)[index]}
              transform={`rotate(${corner.rotate} ${corner.cx} ${corner.cy})`}
            />
          ))}
          <ellipse cx={60} cy={90} rx={42} ry={31} fill="#1f2430" stroke="#ffffff" strokeWidth={2.5} transform="rotate(-20 60 90)" />
        </g>
      )}

      {!isWild && <ellipse cx={60} cy={90} rx={42} ry={31} fill="#ffffff" transform="rotate(-20 60 90)" />}

      <g transform="rotate(-20 60 90) translate(60 90)">
        <Glyph card={card} catalog={catalog} ink={isWild ? '#ffffff' : '#111827'} />
      </g>

      <g fill={isWild ? '#f8fafc' : '#111827'} fontSize={22} fontWeight="900" fontFamily="ui-sans-serif, system-ui, sans-serif">
        <text x={16} y={32}>{label}</text>
        <g transform="rotate(180 60 90)">
          <text x={16} y={32}>{label}</text>
        </g>
      </g>
    </svg>
  );
}