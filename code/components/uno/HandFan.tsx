'use client';

/**
 * 立起来的手牌：底部一排，带透视与扇形旋转、重叠时自动压缩、悬停抬起。
 * 手牌特别多或屏幕特别窄时自动退化成可横向滚动的一排（不旋转，保证看得清）。
 */

import { useEffect, useRef, useState } from 'react';
import type { UnoCardView, UnoCatalog } from '@/lib/uno/types';
import UnoCard from './UnoCard';

const MIN_CARD = 46;
const MAX_CARD = 104;
const GAP = 10;

export default function HandFan({
  cards,
  catalog,
  playable,
  myTurn,
  onCardClick,
}: {
  cards: UnoCardView[];
  catalog: UnoCatalog | null;
  playable: Set<string>;
  myTurn: boolean;
  onCardClick: (card: UnoCardView) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(720);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width || 720);
    return () => observer.disconnect();
  }, []);

  const count = cards.length;
  const ideal = count > 0 ? (width - GAP * Math.max(0, count - 1)) / count : MAX_CARD;
  const cardWidth = Math.max(1, Math.min(MAX_CARD, Math.floor(ideal)));
  const needsOverlap = ideal < MIN_CARD;
  const scrollMode = count > 14 && width < 640;

  if (scrollMode) {
    return (
      <div ref={containerRef} className="mt-3 flex gap-2 overflow-x-auto pb-2">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => onCardClick(card)}
            data-card-id={card.id}
            data-playable={playable.has(card.id) && myTurn ? '1' : '0'}
            className="shrink-0 transition hover:-translate-y-2"
          >
            <UnoCard card={card} catalog={catalog} width={MIN_CARD + 8} playable={playable.has(card.id) && myTurn} dimmed={!playable.has(card.id)} />
          </button>
        ))}
      </div>
    );
  }

  // 手牌多到放不下就让它重叠：最后一张的右边贴住容器右边。
  const step = needsOverlap && count > 1 ? (width - cardWidth) / (count - 1) : cardWidth + GAP;
  const totalWidth = count > 1 ? step * (count - 1) + cardWidth : cardWidth;
  const startX = Math.max(0, (width - totalWidth) / 2);
  const spread = Math.min(26, count * 1.9);
  const angleStep = count > 1 ? spread / (count - 1) : 0;

  return (
    <div ref={containerRef} className="relative mt-3 h-[170px]" style={{ perspective: '1400px' }}>
      {cards.map((card, index) => {
        const angle = -spread / 2 + angleStep * index;
        const dip = (1 - Math.cos((angle * Math.PI) / 180)) * 42;
        const canPlay = playable.has(card.id) && myTurn;
        const isHovered = hovered === card.id;

        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onCardClick(card)}
            onMouseEnter={() => setHovered(card.id)}
            onMouseLeave={() => setHovered(null)}
            data-card-id={card.id}
            data-playable={canPlay ? '1' : '0'}
            className="absolute bottom-0 origin-bottom transition-transform duration-200 ease-out"
            style={{
              left: `${startX + step * index}px`,
              zIndex: isHovered ? 60 : index + 1,
              transform: `rotate(${angle}deg) rotateX(14deg) translateY(${isHovered ? -22 : dip}px) scale(${isHovered ? 1.06 : 1})`,
            }}
          >
            <UnoCard
              card={card}
              catalog={catalog}
              width={cardWidth}
              playable={canPlay}
              dimmed={!canPlay}
              className="drop-shadow-xl"
            />
          </button>
        );
      })}
      {!count && <p className="text-xs text-slate-500">等待发牌…</p>}
    </div>
  );
}