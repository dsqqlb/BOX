import { manaSymbolStyle, parseManaCost } from '@/lib/edh/mana';

export default function ManaCost({ cost, size = 'sm' }: { cost: string; size?: 'sm' | 'md' }) {
  const symbols = parseManaCost(cost);
  if (symbols.length === 0) return null;
  const dimension = size === 'md' ? 'h-5 w-5 text-[10px]' : 'h-4 w-4 text-[9px]';

  return (
    <span className="inline-flex items-center gap-0.5">
      {symbols.map((symbol, index) => {
        const style = manaSymbolStyle(symbol);
        return (
          <span
            key={`${symbol}-${index}`}
            className={`grid ${dimension} shrink-0 place-items-center rounded-full font-bold ring-1 ring-black/20`}
            style={{ background: style.bg, color: style.fg }}
            title={`{${symbol}}`}
          >
            {style.label}
          </span>
        );
      })}
    </span>
  );
}
