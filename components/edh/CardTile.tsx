'use client';

import { useState } from 'react';
import ManaCost from './ManaCost';
import { EdhCard, displayName } from '@/lib/edh/types';

interface CardTileProps {
  card: EdhCard;
  quantity?: number;
  onAdd?: (card: EdhCard) => void;
  onRemove?: (card: EdhCard) => void;
  onSetCommander?: (card: EdhCard) => void;
  isCommander?: boolean;
  draggable?: boolean;
  onPreview?: (card: EdhCard | null) => void;
}

/** 卡池/牌组通用的卡片格子：悬浮放大预览、拖拽添加、点击快速加减、右键设为指挥官。 */
export default function CardTile({ card, quantity, onAdd, onRemove, onSetCommander, isCommander, draggable = true, onPreview }: CardTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = card.image?.normal || card.faces?.[0]?.image?.normal;
  const name = displayName(card);

  const handleDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/x-edh-oracle-id', card.oracleId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      className="group relative"
      onMouseEnter={() => onPreview?.(card)}
      onMouseLeave={() => onPreview?.(null)}
    >
      <div
        draggable={draggable}
        onDragStart={handleDragStart}
        onClick={() => onAdd?.(card)}
        onContextMenu={(event) => {
          if (!onSetCommander) return;
          event.preventDefault();
          onSetCommander(card);
        }}
        className={`relative aspect-[5/7] cursor-grab select-none overflow-hidden rounded-lg border transition-all duration-150 active:cursor-grabbing ${
          isCommander
            ? 'border-amber-300/70 shadow-[0_0_0_2px_rgba(252,211,77,.5),0_10px_24px_rgba(0,0,0,.4)]'
            : 'border-white/10 hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-[0_10px_24px_rgba(0,0,0,.4)]'
        }`}
        title={onSetCommander ? `${name}（右键：设为指挥官）` : name}
      >
        {image && !imageFailed ? (
          <img src={image} alt={name} draggable={false} loading="lazy" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#12142a] p-2 text-center">
            <span className="text-2xl">🃏</span>
            <span className="line-clamp-3 text-[11px] font-medium text-slate-300">{name}</span>
            <ManaCost cost={card.manaCost} />
          </div>
        )}

        {isCommander && <span className="absolute left-1 top-1 rounded-full bg-amber-300 px-1.5 py-0.5 text-[9px] font-bold text-amber-950 shadow">指挥官</span>}
        {typeof quantity === 'number' && quantity > 1 && (
          <span className="absolute bottom-1 right-1 grid h-5 min-w-5 place-items-center rounded-full bg-black/75 px-1 text-[11px] font-bold text-white ring-1 ring-white/20">×{quantity}</span>
        )}

        {onRemove && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onRemove(card); }}
            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-xs text-white opacity-0 ring-1 ring-white/20 transition group-hover:opacity-100 hover:bg-rose-500/80"
            title="移出牌组"
            aria-label={`将 ${name} 移出牌组`}
          >
            ×
          </button>
        )}
      </div>
      <p className="mt-1 line-clamp-1 text-center text-[11px] text-slate-400">{name}</p>
    </div>
  );
}
