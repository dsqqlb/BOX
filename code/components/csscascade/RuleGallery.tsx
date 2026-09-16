'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { CssRule, CssAtRule } from '@/lib/cssCascade';
import { RuleFilterState } from './useRuleFilter';
import { SpecBadge, SelectorCode, RuleTags, DeclList } from './RuleCardParts';

interface RuleGalleryProps {
  filter: RuleFilterState;
  hoveredRuleIndex: number | null;
  hoveredAtRuleIndex: number | null;
  onHoverRule: (index: number | null) => void;
  onHoverAtRule: (index: number | null) => void;
  onRuleClick: (rule: CssRule) => void;
  onAtRuleClick: (atRule: CssAtRule) => void;
}

// ====== 规则卡片 ======
const RuleCard = memo(function RuleCard({
  rule,
  index,
  hovered,
  onHover,
  onClick,
}: {
  rule: CssRule;
  index: number;
  hovered: boolean;
  onHover: (i: number | null) => void;
  onClick: (r: CssRule) => void;
}) {
  return (
    <button
      onClick={() => onClick(rule)}
      onMouseEnter={() => onHover(rule.ruleIndex)}
      onMouseLeave={() => onHover(null)}
      className={`cc-rule-card w-full text-left ${hovered ? 'cc-gallery-hovered' : ''}`}
      style={{ animationDelay: `${(index % 14) * 28}ms` }}
    >
      <div className="flex items-start gap-2">
        <SpecBadge spec={rule.specificity} />
        <SelectorCode text={rule.selectorText} />
      </div>
      <RuleTags rule={rule} />
      <DeclList declarations={rule.declarations} />
    </button>
  );
});

// ====== 特殊 at-rule 卡片（keyframes / font-face / property / page） ======
const AtRuleCard = memo(function AtRuleCard({
  atRule,
  hovered,
  onHover,
  onClick,
}: {
  atRule: CssAtRule;
  hovered: boolean;
  onHover: (i: number | null) => void;
  onClick: (a: CssAtRule) => void;
}) {
  const isKeyframes = atRule.frames !== undefined;
  return (
    <button
      onClick={() => onClick(atRule)}
      onMouseEnter={() => onHover(atRule.atRuleIndex)}
      onMouseLeave={() => onHover(null)}
      className={`cc-rule-card cc-atrule-card w-full text-left ${hovered ? 'cc-gallery-hovered' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="cc-atrule-name">@{atRule.name}</span>
        {atRule.prelude && <code className="font-mono text-[13px] text-violet-200">{atRule.prelude}</code>}
        <span className="cc-atrule-badge">
          {isKeyframes ? `${atRule.frames?.length ?? 0} 帧` : `${atRule.declarations?.length ?? 0} 声明`}
        </span>
      </div>

      {isKeyframes && atRule.frames && (
        <div className="mt-2 flex flex-wrap gap-1">
          {atRule.frames.map((f, i) => (
            <span key={i} className="cc-frame-chip" title={f.declarations.map((d) => `${d.property}: ${d.value}`).join('\n')}>
              {f.key}
            </span>
          ))}
        </div>
      )}

      {!isKeyframes && atRule.declarations && atRule.declarations.length > 0 && (
        <DeclList declarations={atRule.declarations} />
      )}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {atRule.mediaQuery && <span className="cc-tag cc-tag-media">@media {atRule.mediaQuery}</span>}
        {atRule.layer && <span className="cc-tag cc-tag-layer">@layer {atRule.layer}</span>}
        <span className="cc-tag cc-tag-line">第 {atRule.locStart.line} 行</span>
      </div>
    </button>
  );
});

// 分块懒加载：先渲染一批，滚到接近底部再加载下一批（防长 CSS 一次性渲染卡死）
const CHUNK = 200;
const INITIAL_CHUNK = 200;

// ====== 左侧能量轨：流动箭头线 ======
function FlowRail() {
  return (
    <div className="cc-flow-rail" aria-hidden>
      <div className="cc-flow-stream" />
      {[0, 1, 2].map((a) => (
        <span key={a} className="cc-flow-arrow" style={{ animationDelay: `${a * 1.15}s` }}>▾</span>
      ))}
    </div>
  );
}

function RuleGallery({
  filter,
  hoveredRuleIndex,
  hoveredAtRuleIndex,
  onHoverRule,
  onHoverAtRule,
  onRuleClick,
  onAtRuleClick,
}: RuleGalleryProps) {
  const rules = filter.filteredRules;
  const atRules = filter.filteredAtRules;

  // ---- 分块渲染 ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(INITIAL_CHUNK);
  useEffect(() => {
    setVisible(INITIAL_CHUNK);
  }, [rules, atRules]);

  const hasMore = visible < rules.length;
  const shownRules = hasMore ? rules.slice(0, visible) : rules;

  useEffect(() => {
    const sent = sentinelRef.current;
    if (!sent || !hasMore) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) setVisible((v) => v + CHUNK);
      },
      { root: scrollRef.current, rootMargin: '500px 0px' }
    );
    io.observe(sent);
    return () => io.disconnect();
  }, [hasMore, visible]);

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* 左侧能量轨：流动箭头线 */}
      <FlowRail />

      {/* 主体 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto cc-gallery-scroll pl-5">
        {atRules.length > 0 && (
          <section className="px-4 pt-3">
            <div className="text-[10px] tracking-widest text-violet-400/80 uppercase mb-2">🎞 特殊声明 · 动画 / 字体 / 属性</div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3">
              {atRules.map((a) => (
                <AtRuleCard
                  key={a.name + '-' + a.atRuleIndex}
                  atRule={a}
                  hovered={hoveredAtRuleIndex === a.atRuleIndex}
                  onHover={onHoverAtRule}
                  onClick={onAtRuleClick}
                />
              ))}
            </div>
          </section>
        )}

        {rules.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3 px-4 py-3">
            {shownRules.map((r, i) => (
              <RuleCard
                key={r.ruleIndex}
                rule={r}
                index={i}
                hovered={hoveredRuleIndex === r.ruleIndex}
                onHover={onHoverRule}
                onClick={onRuleClick}
              />
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-zinc-500">
            <span className="animate-pulse inline-block w-1.5 h-1.5 rounded-full bg-cyan-400/60" />
            ▾ 已加载 {shownRules.length}/{rules.length} 条，滚动加载更多…
          </div>
        )}

        {rules.length === 0 && atRules.length === 0 && (
          <div className="cc-empty-ping flex items-center justify-center h-40 text-zinc-500 text-sm gap-2">
            {filter.query || filter.filterImportant || filter.filterMedia || filter.filterLayer ? (
              <>😶 没有匹配当前筛选的规则</>
            ) : (
              <span className="flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400/70" />
                📝 在左侧粘贴 CSS，点「🔮 解释 CSS」后这里会拆成一条条漂亮的规则卡片
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(RuleGallery);
