import { EdhCard } from '@/lib/edh/types';

/** 法力曲线柱状图：纯 CSS 实现，不引入图表库，和项目里省钱工具的条形图风格一致。 */
export default function ManaCurve({ entries, cardOf }: { entries: { oracleId: string; quantity: number }[]; cardOf: (id: string) => EdhCard | undefined }) {
  const buckets = new Array(8).fill(0); // 0,1,2,3,4,5,6,7+
  for (const entry of entries) {
    const card = cardOf(entry.oracleId);
    if (!card || card.typeLine.toLowerCase().includes('land')) continue;
    const bucket = Math.min(Math.max(Math.round(card.cmc), 0), 7);
    buckets[bucket] += entry.quantity;
  }
  const max = Math.max(...buckets, 1);

  return (
    <div className="flex h-24 items-end gap-1.5">
      {buckets.map((count, cmc) => (
        <div key={cmc} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end">
            <div
              className="w-full rounded-t bg-gradient-to-t from-cyan-500/70 to-violet-400/70 transition-all"
              style={{ height: `${(count / max) * 100}%`, minHeight: count > 0 ? '4px' : 0 }}
              title={`${count} 张`}
            />
          </div>
          <span className="text-[10px] text-slate-500">{cmc === 7 ? '7+' : cmc}</span>
        </div>
      ))}
    </div>
  );
}
