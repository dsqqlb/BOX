'use client';

/**
 * 票面美术：纯 SVG 程序化绘制，不依赖任何图片素材。
 *
 * 硬约束：**票一律是矩形**，形状差异只来自 shape.aspect（宽高比）——
 * 所以这里不画锯齿、斜切、圆孔之类的轮廓，只画矩形纸面 + 印刷内容 + 未刮开的涂层。
 * 颜色、长宽比、票名价格都来自 resources/content/scratch/tickets.json，加票种不用写新组件。
 */

import { useId } from 'react';
import type { ScratchLegend, ScratchTicketDefinition } from '@/lib/scratch/types';

const W = 200;

interface TicketArtProps {
  ticket: ScratchTicketDefinition;
  /** 票面上印着的公开信息（例如好运符号当张公布的中奖符号）；没有就印玩法标语的短句。 */
  legend?: ScratchLegend | null;
  className?: string;
}

export default function TicketArt({ ticket, legend = null, className = '' }: TicketArtProps) {
  const rawId = useId();
  // React 的 useId 里可能带 : 或 «» 之类的字符，清成字母数字再拼 id；清空了就兜一个常量。
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '') || 'ticket';
  const foilId = `scr-foil-${uid}`;
  const shape = ticket.shape;
  const theme = ticket.theme;
  const aspect = shape.aspect > 0 ? shape.aspect : 1.6;
  const H = Math.round(W / aspect);
  const pad = Math.round(H * 0.07);

  return (
    <svg
      className={className}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${ticket.name} 票面`}
    >
      <defs>
        <linearGradient id={foilId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={theme.foil} stopOpacity="0.95" />
          <stop offset="48%" stopColor="#eef1f5" stopOpacity="0.9" />
          <stop offset="100%" stopColor={theme.foil} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* 纸面就是一个矩形，没有别的轮廓 */}
      <rect x="0" y="0" width={W} height={H} fill={theme.paper} />
      <rect x="0" y="0" width={W} height={H * 0.2} fill={theme.accent} opacity="0.85" />
      <rect x="0" y={H * 0.2} width={W} height={Math.max(1.5, H * 0.012)} fill={theme.edge} />

      {/* 票名与票价 */}
      <text x={pad} y={H * 0.145} fontSize={H * 0.115} fontWeight="900" fill={theme.ink}>{ticket.name}</text>
      <text x={W - pad} y={H * 0.145} fontSize={H * 0.115} fontWeight="900" fill={theme.ink} textAnchor="end">{ticket.price}币</text>

      <Motif ticket={ticket} top={H * 0.2} height={H * 0.44} pad={pad} />

      {/* 刮开前公开的信息：例如好运符号印在票面上的「中奖符号」 */}
      <text
        x={W / 2}
        y={H * 0.7}
        fontSize={H * 0.075}
        fontWeight="800"
        fill={theme.edge}
        textAnchor="middle"
      >
        {legend ? `${legend.label} ${legend.symbol}　${legend.note}` : ticket.tagline}
      </text>

      {/* 未刮开的涂层 */}
      <rect x={pad} y={H * 0.74} width={W - pad * 2} height={H * 0.19} fill={`url(#${foilId})`} />
      <rect x={pad} y={H * 0.74} width={W - pad * 2} height={H * 0.19} fill="none" stroke={theme.edge} strokeWidth={Math.max(1, H * 0.012)} strokeDasharray={`${H * 0.06} ${H * 0.04}`} />
      <text x={W / 2} y={H * 0.865} fontSize={H * 0.075} fontWeight="700" fill="#5b6068" textAnchor="middle" opacity="0.9">涂层未刮开</text>
    </svg>
  );
}

/** 每种玩法的印刷图案：让四种票一眼分得开，尺寸随票的长宽比自适应。 */
function Motif({ ticket, top, height, pad }: { ticket: ScratchTicketDefinition; top: number; height: number; pad: number }) {
  const { accent, ink, edge } = ticket.theme;
  const avail = W - pad * 2;
  const midY = top + height / 2;

  if (ticket.rules === 'three-match') {
    const r = Math.min(height * 0.28, avail / 8.5);
    return (
      <g>
        {[0, 1, 2].map((index) => (
          <g key={`coin-${index}`}>
            <circle cx={pad + r + index * (r * 2.7)} cy={midY} r={r} fill={accent} stroke={edge} strokeWidth={Math.max(1, r * 0.08)} />
            <text x={pad + r + index * (r * 2.7)} y={midY + r * 0.36} fontSize={r * 1.1} fontWeight="900" fill={ink} textAnchor="middle">币</text>
          </g>
        ))}
        <text x={W - pad} y={midY + r * 0.4} fontSize={Math.min(height * 0.5, r * 1.4)} fontWeight="900" fill={edge} textAnchor="end">×3</text>
      </g>
    );
  }

  if (ticket.rules === 'lucky-symbol') {
    const symbols = ticket.symbols && ticket.symbols.length ? ticket.symbols : ['★'];
    // 符号多的时候折成两行放（竖票上单行会挤成一条细线）
    const perRow = symbols.length > 3 ? 3 : symbols.length;
    const rows = Math.ceil(symbols.length / perRow);
    const r = Math.min(height * 0.3, avail / (perRow * 2.1));
    return (
      <g>
        {symbols.map((symbol, index) => {
          const row = Math.floor(index / perRow);
          const col = index % perRow;
          const inRow = Math.min(perRow, symbols.length - row * perRow);
          const startX = (W - inRow * r * 2.1) / 2 + r;
          return (
            <text
              key={`sym-${symbol}-${index}`}
              x={startX + col * r * 2.1}
              y={midY + (row - (rows - 1) / 2) * r * 2.2 + r * 0.5}
              fontSize={r * 1.5}
              fontWeight="900"
              fill={index === 0 ? edge : accent}
              textAnchor="middle"
            >
              {symbol}
            </text>
          );
        })}
      </g>
    );
  }

  if (ticket.rules === 'high-low') {
    const plateW = avail * 0.34;
    const plateH = Math.min(height * 0.9, plateW * 0.9);
    const plateY = midY - plateH / 2;
    return (
      <g>
        <rect x={pad} y={plateY} width={plateW} height={plateH} rx={plateH * 0.12} fill={accent} opacity="0.55" stroke={edge} strokeWidth={Math.max(1, plateH * 0.05)} />
        <text x={pad + plateW / 2} y={plateY + plateH * 0.72} fontSize={plateH * 0.62} fontWeight="900" fill={ink} textAnchor="middle">?</text>
        <text x={W / 2} y={midY + plateH * 0.2} fontSize={Math.min(height * 0.5, plateH * 0.7)} fontWeight="900" fill={edge} textAnchor="middle">VS</text>
        <rect x={W - pad - plateW} y={plateY} width={plateW} height={plateH} rx={plateH * 0.12} fill={ink} opacity="0.18" stroke={edge} strokeWidth={Math.max(1, plateH * 0.05)} />
        <text x={W - pad - plateW / 2} y={plateY + plateH * 0.72} fontSize={plateH * 0.62} fontWeight="900" fill={ink} textAnchor="middle">?</text>
      </g>
    );
  }

  // find-word：3×3 圆点阵，中间一个点亮表示「藏着一张中奖」
  const dot = Math.min(height * 0.13, avail / 12);
  const step = dot * 2.6;
  return (
    <g>
      {[0, 1, 2].map((row) => [0, 1, 2].map((col) => {
        const lit = row === 1 && col === 1;
        return (
          <circle
            key={`cell-${row}-${col}`}
            cx={W / 2 + (col - 1) * step}
            cy={midY + (row - 1) * step}
            r={lit ? dot * 1.15 : dot}
            fill={lit ? edge : accent}
            opacity={lit ? 1 : 0.45}
          />
        );
      }))}
    </g>
  );
}