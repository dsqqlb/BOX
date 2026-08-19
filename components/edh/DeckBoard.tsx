'use client';

import CardTile from './CardTile';
import ManaCurve from './ManaCurve';
import { EdhCard, EdhDeckCardEntry, MANA_COLOR_LABEL, ManaColor } from '@/lib/edh/types';
import { primaryCardType, TYPE_LABEL_ZH, TYPE_ORDER } from '@/lib/edh/mana';

interface DeckBoardProps {
  entries: EdhDeckCardEntry[];
  commanderOracleId: string | null;
  cardOf: (oracleId: string) => EdhCard | undefined;
  onDropCard: (oracleId: string) => void;
  onRemoveOne: (card: EdhCard) => void;
  onSetCommander: (card: EdhCard) => void;
  onPreview: (card: EdhCard | null) => void;
}

/** 颜色identity校验：非指挥官颜色内的卡会被高亮为违规，帮助用户在组牌时立刻发现问题。 */
function isOutsideCommanderIdentity(card: EdhCard, commanderColors: Set<ManaColor>): boolean {
  return card.colorIdentity.some((color) => !commanderColors.has(color as ManaColor));
}

export default function DeckBoard({ entries, commanderOracleId, cardOf, onDropCard, onRemoveOne, onSetCommander, onPreview }: DeckBoardProps) {
  const commander = commanderOracleId ? cardOf(commanderOracleId) : undefined;
  const commanderColors = new Set<ManaColor>((commander?.colorIdentity || []) as ManaColor[]);
  const totalCount = entries.reduce((sum, entry) => sum + entry.quantity, 0) + (commander ? 1 : 0);

  const grouped = new Map<string, { entry: EdhDeckCardEntry; card: EdhCard }[]>();
  for (const type of TYPE_ORDER) grouped.set(type, []);
  const violations: EdhCard[] = [];

  for (const entry of entries) {
    const card = cardOf(entry.oracleId);
    if (!card) continue;
    if (commander && isOutsideCommanderIdentity(card, commanderColors)) violations.push(card);
    const type = primaryCardType(card.typeLine);
    grouped.get(type)!.push({ entry, card });
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const oracleId = event.dataTransfer.getData('application/x-edh-oracle-id');
    if (oracleId) onDropCard(oracleId);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">牌组</span>
          <span className={`text-xs ${totalCount === 100 ? 'text-emerald-300' : 'text-amber-300'}`}>{totalCount} / 100 张</span>
        </div>
        {violations.length > 0 && (
          <span className="rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-[11px] text-rose-200">
            ⚠ {violations.length} 张卡超出指挥官颜色identity
          </span>
        )}
      </div>

      <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">法力曲线</p>
        <ManaCurve entries={entries} cardOf={cardOf} />
      </div>

      <div
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="mt-3 flex-1 overflow-y-auto rounded-2xl border-2 border-dashed border-white/10 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,.06),transparent_60%)] p-4 transition-colors [&.drag-active]:border-cyan-300/50"
      >
        {commander && (
          <div className="mb-4">
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-amber-300">指挥官</p>
            <div className="w-24">
              <CardTile card={commander} isCommander onPreview={onPreview} draggable={false} />
            </div>
          </div>
        )}

        {entries.length === 0 && !commander ? (
          <div className="grid h-full min-h-[200px] place-items-center text-center text-sm text-slate-500">
            把左侧卡池的卡片拖到这里，或点击卡片快速加入牌组
          </div>
        ) : (
          TYPE_ORDER.map((type) => {
            const group = grouped.get(type) || [];
            if (group.length === 0) return null;
            const count = group.reduce((sum, item) => sum + item.entry.quantity, 0);
            return (
              <div key={type} className="mb-5">
                <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">{TYPE_LABEL_ZH[type]}（{count}）</p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3">
                  {group.map(({ entry, card }) => (
                    <CardTile
                      key={entry.oracleId}
                      card={card}
                      quantity={entry.quantity}
                      onRemove={onRemoveOne}
                      onSetCommander={onSetCommander}
                      onPreview={onPreview}
                      draggable={false}
                    />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {commander && (
        <p className="mt-2 text-[11px] text-slate-500">
          指挥官颜色identity：{commanderColors.size > 0 ? [...commanderColors].map((c) => MANA_COLOR_LABEL[c]).join('') : '无色'}
        </p>
      )}
    </div>
  );
}
