import ManaCost from './ManaCost';
import { EdhCard, displayName, displayOracleText, displayTypeLine } from '@/lib/edh/types';

/** 固定在搜索栏下方的大图预览：鼠标悬浮卡池里的卡片时显示，模拟真的拿起卡对着光看文字的手感。 */
export default function CardPreview({ card }: { card: EdhCard | null }) {
  if (!card) {
    return (
      <div className="grid h-full place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-slate-500">
        将鼠标悬浮在卡片上查看详情
      </div>
    );
  }

  const image = card.image?.normal || card.faces?.[0]?.image?.normal;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d1024]">
      <div className="relative aspect-[5/7] w-full shrink-0 bg-black/40">
        {image
          ? <img src={image} alt={displayName(card)} className="h-full w-full object-cover" />
          : <div className="grid h-full place-items-center text-4xl">🃏</div>}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">{displayName(card)}</h3>
          <ManaCost cost={card.manaCost} size="md" />
        </div>
        <p className="mt-1 text-xs text-slate-400">{displayTypeLine(card)}</p>
        {displayOracleText(card) && (
          <p className="mt-3 whitespace-pre-line text-xs leading-relaxed text-slate-300">{displayOracleText(card)}</p>
        )}
        {(card.power || card.toughness) && (
          <p className="mt-3 text-xs font-semibold text-slate-300">{card.power}/{card.toughness}</p>
        )}
        {card.nameZh && <p className="mt-3 text-[11px] text-slate-500">英文名：{card.name}</p>}
      </div>
    </div>
  );
}
