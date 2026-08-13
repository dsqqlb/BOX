'use client';

import { CascadeResult, CascadeHit, CssRule } from '@/lib/cssCascade';

interface CascadeWaterfallProps {
  result: CascadeResult | null;
  /** hover 的规则 index（源码 hover → 瀑布高亮），用 ruleIndex 匹配 */
  hoveredRuleIndex: number | null;
  onHoverRule: (ruleIndex: number | null) => void;
  onRuleClick: (rule: CssRule) => void;
}

const SEG_COLORS = {
  author: '#22d3ee',
  important: '#fbbf24',
  inline: '#f472b6',
  inherited: '#a78bfa',
};

function segColor(hit: CascadeHit): string {
  if (hit.declaration.important) return SEG_COLORS.important;
  if (hit.isInline) return SEG_COLORS.inline;
  return SEG_COLORS.author;
}

function WaterfallColumn({
  property,
  hits,
  computed,
  inherited,
  inheritedSource,
  hoveredRuleIndex,
  onHoverRule,
  onRuleClick,
}: {
  property: string;
  hits: CascadeHit[];
  computed: string | null;
  inherited: boolean;
  inheritedSource: string | null;
  hoveredRuleIndex: number | null;
  onHoverRule: (ruleIndex: number | null) => void;
  onRuleClick: (rule: CssRule) => void;
}) {
  const count = hits.length;
  const hasImportant = hits.some((h) => h.declaration.important);

  return (
    <div className="flex flex-col shrink-0 w-[228px] cc-pipe">
      {/* 管道头 */}
      <div className="px-3 pt-2.5 pb-2 cc-pipe-head">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-bold tracking-tight text-cyan-300 cc-prop-glow">
            {property}
          </span>
          {hasImportant && (
            <span className="text-[10px] text-amber-300/90 font-semibold">🚧 有!important</span>
          )}
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-zinc-400 cc-computed truncate" title={computed || ''}>
          {computed !== null ? <>{computed}</> : <span className="text-zinc-600">—</span>}
        </div>
      </div>

      {/* 管道体 */}
      <div className="flex-1 mx-1 rounded-b-lg px-2 pb-3 pt-1 cc-pipe-body">
        {/* 继承段 */}
        {inherited && (
          <div className="relative rounded-md mb-1.5 px-2.5 py-1.5 border border-dashed border-violet-400/40 bg-violet-400/5 cc-inherit-seg">
            <div className="flex items-center gap-1.5 text-[11px] text-violet-300">
              <span>🌱</span>
              <span className="font-medium">继承</span>
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-violet-200/80 truncate" title={inheritedSource || ''}>
              ← {inheritedSource}
            </div>
          </div>
        )}

        {/* 规则水流：从输到赢 */}
        {hits.map((hit, i) => {
          const color = segColor(hit);
          const isWinner = hit.wins;
          const isHovered = hit.rule.ruleIndex === hoveredRuleIndex;
          const dimOthers = hoveredRuleIndex !== null;
          // 亮度按层叠排名递增：输家暗沉，胜出者最亮
          const opacity = count <= 1 ? 1 : 0.34 + 0.66 * (i / (count - 1));

          return (
            <button
              key={hit.rule.ruleIndex + '-' + hit.declaration.property}
              onClick={() => onRuleClick(hit.rule)}
              onMouseEnter={() => onHoverRule(hit.rule.ruleIndex)}
              onMouseLeave={() => onHoverRule(null)}
              className={`relative w-full text-left rounded-md px-2.5 py-1.5 mb-1.5 transition-all duration-150 cc-seg ${
                isWinner ? 'cc-seg-winner' : 'cc-seg-loser'
              } ${isHovered ? 'cc-seg-hovered' : ''}`}
              style={{
                borderColor: isWinner ? color : color + '55',
                boxShadow: isWinner
                  ? `0 0 14px ${color}44, inset 0 0 10px ${color}22`
                  : 'none',
                opacity: isHovered ? 1 : isWinner ? 1 : dimOthers ? 0.22 : opacity,
                borderLeftWidth: 3,
              }}
            >
              {/* !important 闸门 */}
              {hit.declaration.important && (
                <div className="cc-gate" style={{ background: color + '66' }}>
                  <span className="text-[9px] font-bold tracking-widest text-amber-200">
                    ⚡ !IMPORTANT 闸门
                  </span>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                <span
                  className="shrink-0 font-mono text-[9px] px-1 py-px rounded cc-spec-badge"
                  style={{ background: color + '1f', color, border: `1px solid ${color}44` }}
                >
                  {hit.specText}
                </span>
                {hit.isInline && (
                  <span className="shrink-0 text-[9px] px-1 py-px rounded bg-pink-400/10 text-pink-300 border border-pink-400/30">
                    inline
                  </span>
                )}
                <span
                  className={`truncate font-mono text-[11px] ${isWinner ? 'text-white font-medium' : 'text-zinc-300'}`}
                  title={hit.rule.selectorText}
                >
                  {hit.rule.selectorText}
                </span>
              </div>

              <div className="mt-0.5 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-[11px]" style={{ color: isWinner ? color : color + 'cc' }}>
                  {hit.declaration.property}: {hit.declaration.value}
                </code>
                {isWinner && <span className="shrink-0 text-[10px] font-bold text-cyan-200 cc-win-flag">⚡ 胜出</span>}
              </div>

              {/* 序号水珠 */}
              <span
                className={`absolute -left-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold cc-drop ${
                  isWinner ? 'cc-drop-win' : ''
                }`}
                style={{ background: isWinner ? color : color + '33', color: isWinner ? '#041018' : color }}
              >
                {i + 1}
              </span>
            </button>
          );
        })}

        {/* 空竞争：一条规则独占 */}
        {count === 0 && !inherited && (
          <div className="text-[11px] text-zinc-600 text-center py-2">无命中</div>
        )}
      </div>
    </div>
  );
}

export default function CascadeWaterfall({
  result,
  hoveredRuleIndex,
  onHoverRule,
  onRuleClick,
}: CascadeWaterfallProps) {
  if (!result) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px] text-zinc-500">
        <div className="text-center">
          <div className="text-3xl mb-2 animate-bounce-slow">👆</div>
          <p className="text-sm">
            点击右侧 <span className="text-cyan-300 font-medium">Demo 页面</span> 里的任意元素
          </p>
          <p className="text-xs text-zinc-600 mt-1">层叠瀑布会在这里解释它「为什么长这样」</p>
        </div>
      </div>
    );
  }

  if (result.properties.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-[180px] text-zinc-500">
        <div className="text-center">
          <p className="text-sm">😶 <span className="text-cyan-300 font-mono">{result.selectedSelector}</span> 没有命中任何规则</p>
          <p className="text-xs text-zinc-600 mt-1">试试点击其他元素，或在左侧给 CSS 添加规则</p>
        </div>
      </div>
    );
  }

  const totalHits = result.properties.reduce((acc, p) => acc + p.hits.length, 0);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 概览条 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0 cc-summary">
        <span className="font-mono text-sm text-cyan-300 cc-prop-glow">{result.selectedSelector}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-zinc-400">&lt;{result.tagName}&gt;</span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="text-zinc-500">竞争属性 <b className="text-zinc-200">{result.properties.length}</b></span>
          <span className="text-zinc-500">命中声明 <b className="text-zinc-200">{totalHits}</b></span>
        </div>
        {/* 图例 */}
        <div className="hidden lg:flex items-center gap-3 text-[10px] text-zinc-500">
          <span><i className="inline-block w-2 h-2 rounded-full bg-cyan-400 mr-1" />规则</span>
          <span><i className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />!important</span>
          <span><i className="inline-block w-2 h-2 rounded-full bg-pink-400 mr-1" />内联</span>
          <span><i className="inline-block w-2 h-2 rounded-full bg-violet-400 mr-1" />继承</span>
        </div>
      </div>

      {/* 瀑布 */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden cc-waterfall-scroll">
        <div className="flex items-start gap-3 px-4 py-3 w-max">
          {result.properties.map((p) => (
            <WaterfallColumn
              key={p.property}
              property={p.property}
              hits={p.hits}
              computed={p.computed}
              inherited={p.inherited}
              inheritedSource={p.inheritedSource}
              hoveredRuleIndex={hoveredRuleIndex}
              onHoverRule={onHoverRule}
              onRuleClick={onRuleClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
