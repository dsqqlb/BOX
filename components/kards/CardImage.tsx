'use client';

import { cardImageUrl } from '@/lib/kards/catalog';

interface CardImageProps {
  path?: string | null;
  name?: string;
  faceDown?: boolean;
  className?: string;
}

export default function CardImage({ path, name, faceDown = false, className = '' }: CardImageProps) {
  if (faceDown || !path) {
    return (
      <div
        role="img"
        aria-label={faceDown ? '牌背' : name || 'Kards 卡牌'}
        className={`relative flex aspect-[5/7] select-none items-center justify-center overflow-hidden rounded-md border border-zinc-500/60 bg-gradient-to-br from-zinc-700 via-zinc-900 to-black shadow-lg shadow-black/40 ${className}`}
      >
        <div className="absolute inset-[6%] rounded border-2 border-double border-amber-500/40" />
        <div className="relative text-center">
          <div className="text-xl leading-none text-amber-400/90">★</div>
          <div className="mt-1 text-[10px] font-bold tracking-[0.35em] text-zinc-400">KARDS</div>
        </div>
        <div className="absolute bottom-1 left-0 right-0 text-center text-[8px] tracking-widest text-zinc-600">
          WORLD WAR II
        </div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cardImageUrl(path)}
      alt={name || 'Kards 卡牌'}
      loading="lazy"
      draggable={false}
      className={`aspect-[5/7] w-full rounded-md border border-zinc-600/70 bg-zinc-800 object-cover shadow-lg shadow-black/40 ${className}`}
    />
  );
}
