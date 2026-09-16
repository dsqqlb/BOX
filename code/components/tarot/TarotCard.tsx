'use client';

import { useState } from 'react';
import { TarotCard as TarotCardData, getCardImageUrl, getCardTheme, CARD_BACK_URL } from '@/lib/tarot';

// 元素/花色 -> 光效class 映射
const GLOW_CLASS: Record<string, string> = {
  fire: 'animate-tarot-glow-fire',
  water: 'animate-tarot-glow-water',
  air: 'animate-tarot-glow-air',
  earth: 'animate-tarot-glow-earth',
};

interface TarotCardProps {
  card: TarotCardData;
  isReversed?: boolean;
  isFlipped: boolean; // true = 已翻开显示正面，false = 显示牌背
  size?: 'sm' | 'md' | 'lg';
  showGlow?: boolean; // 是否显示花色/元素光效（用于抽出后展示）
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  label?: string; // 牌阵位置标签（如"过去" "现在"）
}

const SIZE_MAP = {
  sm: 'w-20 h-[136px]',
  md: 'w-32 h-[220px]',
  lg: 'w-44 h-[308px]',
};

export default function TarotCard({
  card,
  isReversed = false,
  isFlipped,
  size = 'md',
  showGlow = false,
  onClick,
  className = '',
  style,
  label,
}: TarotCardProps) {
  const [imgError, setImgError] = useState(false);
  const theme = getCardTheme(card);
  const glowClass = card.arcana === 'major'
    ? 'animate-tarot-glow-major'
    : (card.element ? GLOW_CLASS[card.element] : '');

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`} style={style}>
      {label && (
        <div className="text-xs font-semibold tracking-wide text-amber-300/80 uppercase">
          {label}
        </div>
      )}
      <div
        className={`tarot-flip-scene ${SIZE_MAP[size]} ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
      >
        <div
          className={`tarot-flip-card w-full h-full rounded-lg ${isFlipped ? 'is-flipped' : ''}`}
        >
          {/* 牌背面（未翻开时朝向用户） */}
          <div className="tarot-flip-face w-full h-full rounded-lg overflow-hidden shadow-xl shadow-black/50 ring-1 ring-amber-400/20">
            <img
              src={CARD_BACK_URL}
              alt="塔罗牌背"
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>

          {/* 牌正面（翻开后朝向用户） */}
          <div
            className={`tarot-flip-face tarot-flip-face-back w-full h-full rounded-lg overflow-hidden bg-slate-950 transition-shadow duration-500 ${
              showGlow && isFlipped ? glowClass : ''
            }`}
            style={{
              border: `1px solid ${theme.color}55`,
              boxShadow: showGlow && isFlipped ? undefined : `0 8px 24px -4px rgba(0,0,0,0.6)`,
            }}
          >
            {!imgError ? (
              <img
                src={getCardImageUrl(card)}
                alt={card.name}
                className={`w-full h-full object-cover ${isReversed ? 'tarot-reversed-image' : ''}`}
                draggable={false}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950 text-center p-2">
                <span className="text-xs text-slate-400">{card.name}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {isFlipped && (
        <div className="flex flex-col items-center gap-0.5">
          <div className="text-sm font-bold text-amber-100">
            {card.name}
            {isReversed && <span className="text-red-400 ml-1">（逆位）</span>}
          </div>
          <div className="text-[10px] text-slate-400 italic">{card.nameEn}</div>
        </div>
      )}
    </div>
  );
}
