'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CssRule, CssAtRule } from '@/lib/cssCascade';
import { RuleFilterState } from './useRuleFilter';
import { SpecBadge, SelectorCode, RuleTags, DeclList } from './RuleCardParts';

interface RuleRailProps {
  filter: RuleFilterState;
  hoveredRuleIndex: number | null;
  hoveredAtRuleIndex: number | null;
  onHoverRule: (index: number | null) => void;
  onHoverAtRule: (index: number | null) => void;
  onRuleClick: (rule: CssRule) => void;
  onAtRuleClick: (atRule: CssAtRule) => void;
}

/** 横向步进 = 卡片宽 × 该比例：<1 让侧卡重叠成密排拱廊，封面流才好看 */
const STEP_RATIO = 0.6;
/** 左右各渲染几张（窗口虚拟化，总 DOM 恒 ~9 卡，几千条规则也不卡） */
const WINDOW = 4;
/** 超过该条数自动轮播无意义，停播 */
const AUTOPLAY_MAX = 50;
const PLAY_INTERVAL = 2800;
const MAX_CARD_W = 440;

function specWeight(s: [number, number, number]) {
  return s[0] * 100 + s[1] * 10 + s[2];
}

/** 发光强度 = 特异度；!important 换暖橙辉光 */
function cardGlow(rule: CssRule, front: boolean) {
  const imp = rule.declarations.some((d) => d.important);
  if (imp) {
    return front
      ? '0 0 36px rgba(251,146,60,.45), 0 0 6px rgba(251,146,60,.8)'
      : '0 0 18px rgba(251,146,60,.30), 0 0 3px rgba(251,146,60,.55)';
  }
  const w = specWeight(rule.specificity);
  const a = Math.min(0.16 + w * 0.0011, 0.5);
  const spread = Math.min((front ? 16 : 6) + w * 0.05, front ? 44 : 24);
  return `0 0 ${spread}px rgba(34,211,238,${a}), 0 0 3px rgba(34,211,238,${front ? 0.75 : 0.4})`;
}

// ====== 特异性全息三柱：a=id(粉) / b=class(绿) / c=元素(蓝) ======
function SpecHolo({ spec }: { spec: [number, number, number] }) {
  const [a, b, c] = spec;
  const max = Math.max(1, a, b, c);
  const cols = [
    { n: a, label: 'id', num: 'cc-spec-a', fill: 'cc-holo-bar--a' },
    { n: b, label: 'class·属性·伪类', num: 'cc-spec-b', fill: 'cc-holo-bar--b' },
    { n: c, label: '元素·伪元素', num: 'cc-spec-c', fill: 'cc-holo-bar--c' },
  ];
  return (
    <div className="cc-rail-specbar" title={`特异性 (a,b,c) = ${a},${b},${c}`}>
      {cols.map((col) => (
        <div key={col.label} className="cc-rail-spec-col">
          <div className="cc-rail-spec-track">
            <div className={`cc-rail-spec-fill ${col.fill}`} style={{ height: `${(col.n / max) * 100}%` }} />
          </div>
          <b className={`${col.num} cc-rail-spec-num`}>{col.n}</b>
          <span className="cc-rail-spec-label">{col.label}</span>
        </div>
      ))}
    </div>
  );
}

function FrontCard({ rule }: { rule: CssRule }) {
  const imp = rule.declarations.some((d) => d.important);
  return (
    <>
      <div className="cc-rail-card-head">
        <SpecBadge spec={rule.specificity} />
        {imp && <span className="cc-tag cc-tag-imp">🔥 !important</span>}
      </div>
      <div className="mt-2.5">
        <SelectorCode text={rule.selectorText} />
      </div>
      <SpecHolo spec={rule.specificity} />
      <RuleTags rule={rule} />
      <div className="cc-rail-card-decls">
        <DeclList declarations={rule.declarations} max={4} />
      </div>
      <div className="cc-rail-card-open">📖 查看全息详情</div>
    </>
  );
}

function SideCard({ rule }: { rule: CssRule }) {
  return (
    <div className="cc-rail-card-side">
      <SelectorCode text={rule.selectorText} />
    </div>
  );
}

export default function RuleRail({
  filter,
  hoveredRuleIndex,
  hoveredAtRuleIndex,
  onHoverRule,
  onHoverAtRule,
  onRuleClick,
  onAtRuleClick,
}: RuleRailProps) {
  const rules = filter.filteredRules;
  const atRules = filter.filteredAtRules;
  const total = rules.length;

  const stageRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(400);
  const [focused, setFocused] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovering, setHovering] = useState(false);

  // 测量舞台宽 → 卡片宽（响应式），保证 translateX 间距跟随
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setCardW(Math.max(220, Math.min(MAX_CARD_W, w * 0.62)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 规则集 / 筛选变化 → 回到第一张
  useEffect(() => {
    setFocused(0);
  }, [filter.filteredRules]);

  const safeFocused = total === 0 ? 0 : Math.min(focused, total - 1);
  const stepX = cardW * STEP_RATIO;

  // 自动轮播：total 2~50 且未暂停/未悬停；每次聚焦变化重置倒计时
  useEffect(() => {
    if (paused || hovering || total <= 1 || total > AUTOPLAY_MAX) return;
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => setFocused((f) => (f + 1) % total), PLAY_INTERVAL);
    return () => clearTimeout(t);
  }, [safeFocused, paused, hovering, total]);

  const go = useCallback(
    (i: number) => {
      setFocused(Math.max(0, Math.min(total - 1, i)));
    },
    [total]
  );

  // 键盘：←/→ 导航（clamp）、Enter 开详情、空格 播放/暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (total === 0) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPaused(true);
        go(safeFocused - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPaused(true);
        go(safeFocused + 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = rules[safeFocused];
        if (r) onRuleClick(r);
      } else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onRuleClick, rules, safeFocused, total]);

  // 窗口虚拟化：只渲染聚焦卡附近 |k| ≤ WINDOW 的卡
  const windowCards = useMemo(() => {
    const out: { index: number; k: number; rule: CssRule }[] = [];
    for (let k = -WINDOW; k <= WINDOW; k++) {
      const index = safeFocused + k;
      if (index < 0 || index >= total) continue;
      out.push({ index, k, rule: rules[index] });
    }
    return out;
  }, [safeFocused, rules, total]);

  return (
    <div
      className="cc-rail relative flex-1 min-h-0 overflow-hidden"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* 氛围：透视网格地板 + 霓虹地平线 */}
      <div className="cc-rail-grid" aria-hidden />
      <div className="cc-rail-horizon" aria-hidden />

      {/* 3D 舞台 */}
      <div ref={stageRef} className="cc-rail-stage">
        {windowCards.map(({ index, k, rule }) => {
          const absK = Math.abs(k);
          const front = k === 0;
          const hovered = rule.ruleIndex === hoveredRuleIndex;
          const style = {
            transform: `translate(-50%, -50%) translateX(${k * stepX}px) rotateY(${k * -11}deg) translateZ(${k * -130}px) scale(${1 - Math.min(absK, 4) * 0.06})`,
            opacity: 1 - Math.min(absK, 4) * 0.19,
            zIndex: 30 - absK,
            filter: absK >= 3 ? 'blur(0.7px)' : 'none',
            boxShadow: cardGlow(rule, front),
          };
          return (
            <button
              key={rule.ruleIndex}
              type="button"
              className={`cc-rail-card ${front ? 'cc-rail-card--front' : 'cc-rail-card--side'} ${hovered ? 'cc-rail-card--hovered' : ''}`}
              style={style}
              onClick={() => (front ? onRuleClick(rule) : setFocused(index))}
              onMouseEnter={() => onHoverRule(rule.ruleIndex)}
              onMouseLeave={() => onHoverRule(null)}
              aria-label={front ? `查看规则 ${rule.selectorText}` : `聚焦规则 ${rule.selectorText}`}
            >
              {front ? <FrontCard rule={rule} /> : <SideCard rule={rule} />}
            </button>
          );
        })}
      </div>

      {/* 扫描线 */}
      <div className="cc-rail-scanline" aria-hidden />

      {/* 导航 */}
      {total > 1 && (
        <>
          <button
            type="button"
            className="cc-rail-nav cc-rail-nav--left"
            onClick={() => {
              setPaused(true);
              go(safeFocused - 1);
            }}
            aria-label="上一条规则"
          >
            ◀
          </button>
          <button
            type="button"
            className="cc-rail-nav cc-rail-nav--right"
            onClick={() => {
              setPaused(true);
              go(safeFocused + 1);
            }}
            aria-label="下一条规则"
          >
            ▶
          </button>
        </>
      )}

      {/* 进度 + 播放 */}
      {total > 0 && (
        <div className="cc-rail-progress">
          <div className="cc-rail-progress-track">
            <div className="cc-rail-progress-fill" style={{ width: `${((safeFocused + 1) / total) * 100}%` }} />
          </div>
          <span className="cc-rail-progress-text">
            <b className="text-cyan-300">{safeFocused + 1}</b> / {total}
            {total <= AUTOPLAY_MAX && (
              <button
                type="button"
                className="cc-rail-play"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? '播放' : '暂停'}
              >
                {paused ? '▶' : '⏸'}
              </button>
            )}
          </span>
        </div>
      )}

      {/* at-rule 全息条 */}
      {atRules.length > 0 && (
        <div className="cc-rail-atstrip">
          {atRules.map((a) => {
            const isKf = a.frames !== undefined;
            const hoveredA = a.atRuleIndex === hoveredAtRuleIndex;
            return (
              <button
                key={a.name + '-' + a.atRuleIndex}
                type="button"
                className={`cc-rail-atchip ${hoveredA ? 'cc-rail-atchip--hovered' : ''}`}
                onClick={() => onAtRuleClick(a)}
                onMouseEnter={() => onHoverAtRule(a.atRuleIndex)}
                onMouseLeave={() => onHoverAtRule(null)}
              >
                <span className="cc-atrule-name">@{a.name}</span>
                {a.prelude && <code className="cc-rail-atchip-prelude">{a.prelude}</code>}
                <span className="cc-rail-atchip-count">
                  {isKf ? `${a.frames?.length ?? 0}帧` : `${a.declarations?.length ?? 0}声明`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 空态 */}
      {total === 0 && atRules.length === 0 && (
        <div className="cc-empty-ping flex items-center justify-center h-full text-zinc-500 text-sm gap-2">
          {filter.query || filter.filterImportant || filter.filterMedia || filter.filterLayer ? (
            <>😶 没有匹配当前筛选的规则</>
          ) : (
            <span className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400/70" />
              📝 在左侧粘贴 CSS，点「🔮 解释 CSS」后这里会变成全息滑轨
            </span>
          )}
        </div>
      )}
    </div>
  );
}
