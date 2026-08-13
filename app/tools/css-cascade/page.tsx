'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import SourceEditor, { SourceEditorHandle } from '@/components/csscascade/SourceEditor';
import RuleGallery from '@/components/csscascade/RuleGallery';
import RuleRail from '@/components/csscascade/RuleRail';
import RuleFilterBar from '@/components/csscascade/RuleFilterBar';
import RuleDetailCard from '@/components/csscascade/RuleDetailCard';
import AtRuleDetailCard from '@/components/csscascade/AtRuleDetailCard';
import { useRuleFilter } from '@/components/csscascade/useRuleFilter';
import { parseStylesheet, CssRule, CssAtRule } from '@/lib/cssCascade';

type ViewMode = 'rail' | 'gallery';

const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'rail', label: '🧊 全息滑轨' },
  { value: 'gallery', label: '🧱 卡片画廊' },
];

// 背景流星（不同位置 / 相位，错峰划过深空）
const SHOOTING_STARS = [
  { top: '6%', left: '66%', delay: 0.8, duration: 5.4 },
  { top: '14%', left: '86%', delay: 2.9, duration: 6.6 },
  { top: '3%', left: '34%', delay: 4.6, duration: 5.9 },
];

// 内置示例：一进来就自动解释好，画廊立即有东西看
const SAMPLE_CSS = `/* 🎨 CSS 层叠解释器 · 内置示例 */
@layer base {
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
}
.card {
  margin: 12px;
  padding: 16px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0d1330, #17224a);
}
.card .title { color: #7dd3fc; }
.btn {
  padding: 8px 18px;
  border-radius: 8px;
  font-weight: 600;
}
.btn.primary { background: #0891b2; color: #fff; }
@media (max-width: 480px) {
  .card { padding: 8px; }
  .btn { width: 100%; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@font-face {
  font-family: 'Sample';
  src: url(sample.woff2) format('woff2');
}`;

/** rules/atRules 按 locStart.line 升序 → 二分找包含 line 的那条（比线性 find 快，长文件 hover 不卡） */
function findContainingLine<T extends { locStart: { line: number }; locEnd: { line: number } }>(
  list: T[],
  line: number
): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].locStart.line <= line) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans === -1) return undefined;
  const r = list[ans];
  return r.locStart.line > 0 && r.locEnd.line >= line ? r : undefined;
}

type AnalysisState = 'idle' | 'working' | 'done';

export default function CssCascadePage() {
  // ---- 源码（编辑实时，不自动解释） ----
  const [cssText, setCssText] = useState(SAMPLE_CSS);

  // ---- 解释门控：编辑不重算，点「解释」才全量解析并更新画廊 ----
  const [analyzedCss, setAnalyzedCss] = useState(SAMPLE_CSS);
  const [analysisState, setAnalysisState] = useState<AnalysisState>('done');
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const parseResult = useMemo(() => parseStylesheet(analyzedCss), [analyzedCss]);
  const rulesByIdx = useMemo(() => {
    const m = new Map<number, CssRule>();
    parseResult.rules.forEach((r) => m.set(r.ruleIndex, r));
    return m;
  }, [parseResult]);
  const atRulesByIdx = useMemo(() => {
    const m = new Map<number, CssAtRule>();
    parseResult.atRules.forEach((a) => m.set(a.atRuleIndex, a));
    return m;
  }, [parseResult]);

  // ---- 视图：默认全息滑轨，可切回卡片画廊 ----
  const [view, setView] = useState<ViewMode>('rail');
  // ---- 共享筛选：滑轨与画廊用同一份搜索/排序/筛选 ----
  const filter = useRuleFilter(parseResult.rules, parseResult.atRules);

  const dirty = analysisState === 'done' && analyzedCss !== cssText;
  const lineCount = cssText.split('\n').length;

  // ---- hover / 详情 ----
  const sourceRef = useRef<SourceEditorHandle>(null);
  const [hoveredRuleIndex, setHoveredRuleIndex] = useState<number | null>(null);
  const [hoveredAtRuleIndex, setHoveredAtRuleIndex] = useState<number | null>(null);
  const [hoverLineRange, setHoverLineRange] = useState<{ start: number; end: number } | null>(null);
  const [detailRule, setDetailRule] = useState<CssRule | null>(null);
  const [detailAtRule, setDetailAtRule] = useState<CssAtRule | null>(null);

  /** 双 rAF：让加载层先绘制，再同步全量解析（长文件先看到 loading，而不是直接卡死） */
  const runAnalysis = useCallback((css: string) => {
    setAnalysisState('working');
    setAnalysisError(null);
    setHoverLineRange(null);
    setHoveredRuleIndex(null);
    setHoveredAtRuleIndex(null);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const r = parseStylesheet(css);
        setAnalyzedCss(css);
        setAnalysisError(r.error);
        setAnalysisState('done');
      })
    );
  }, []);

  const handleExplain = useCallback(() => {
    runAnalysis(cssText);
  }, [cssText, runAnalysis]);

  const handleReset = useCallback(() => {
    setCssText(SAMPLE_CSS);
    runAnalysis(SAMPLE_CSS);
  }, [runAnalysis]);

  // ---- 交互回调 ----
  const handleHoverRule = useCallback(
    (ruleIndex: number | null) => {
      setHoveredRuleIndex(ruleIndex);
      if (ruleIndex === null) {
        setHoverLineRange(null);
        return;
      }
      const rule = rulesByIdx.get(ruleIndex);
      if (rule) {
        setHoverLineRange({
          start: Math.max(1, rule.locStart.line),
          end: Math.max(rule.locStart.line, rule.locEnd.line),
        });
      }
    },
    [rulesByIdx]
  );

  const handleHoverAtRule = useCallback(
    (atRuleIndex: number | null) => {
      setHoveredAtRuleIndex(atRuleIndex);
      if (atRuleIndex === null) {
        setHoverLineRange(null);
        return;
      }
      const at = atRulesByIdx.get(atRuleIndex);
      if (at) {
        setHoverLineRange({
          start: Math.max(1, at.locStart.line),
          end: Math.max(at.locStart.line, at.locEnd.line),
        });
      }
    },
    [atRulesByIdx]
  );

  const handleHoverLine = useCallback(
    (line: number | null) => {
      if (line === null) {
        setHoveredRuleIndex(null);
        setHoveredAtRuleIndex(null);
        return;
      }
      const hit = findContainingLine(parseResult.rules, line);
      if (hit) {
        setHoveredRuleIndex(hit.ruleIndex);
        setHoveredAtRuleIndex(null);
        return;
      }
      const atHit = findContainingLine(parseResult.atRules, line);
      if (atHit) {
        setHoveredAtRuleIndex(atHit.atRuleIndex);
        setHoveredRuleIndex(null);
        return;
      }
      setHoveredRuleIndex(null);
      setHoveredAtRuleIndex(null);
    },
    [parseResult]
  );

  const handleRuleClick = useCallback((rule: CssRule) => {
    setDetailRule(rule);
  }, []);

  const handleAtRuleClick = useCallback((atRule: CssAtRule) => {
    setDetailAtRule(atRule);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setDetailRule(null);
    setDetailAtRule(null);
  }, []);

  const handleLocateRule = useCallback((rule: CssRule) => {
    setDetailRule(null);
    setHoveredRuleIndex(rule.ruleIndex);
    setHoverLineRange({
      start: Math.max(1, rule.locStart.line),
      end: Math.max(rule.locStart.line, rule.locEnd.line),
    });
    sourceRef.current?.scrollToLine(rule.locStart.line);
  }, []);

  const handleLocateAtRule = useCallback((atRule: CssAtRule) => {
    setDetailAtRule(null);
    setHoveredAtRuleIndex(atRule.atRuleIndex);
    setHoverLineRange({
      start: Math.max(1, atRule.locStart.line),
      end: Math.max(atRule.locStart.line, atRule.locEnd.line),
    });
    sourceRef.current?.scrollToLine(atRule.locStart.line);
  }, []);

  const editorEl = (
    <SourceEditor
      ref={sourceRef}
      cssText={cssText}
      onCssChange={setCssText}
      hoverLineRange={hoverLineRange}
      onHoverLine={handleHoverLine}
    />
  );

  return (
    <div className="min-h-screen cc-bg text-zinc-100">
      {/* 背景流星 */}
      <div className="cc-stars" aria-hidden>
        {SHOOTING_STARS.map((s, i) => (
          <span
            key={i}
            className="cc-shoot"
            style={{ top: s.top, left: s.left, animationDelay: `${s.delay}s`, animationDuration: `${s.duration}s` }}
          />
        ))}
      </div>
      <ToolHeader
        className="bg-[#05060f]/85 border-b border-zinc-800/70"
        textClassName="text-zinc-300 hover:text-cyan-300"
      />

      <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {/* 标题区 + 解释按钮 */}
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight cc-title-glow">
              🌊 CSS 层叠解释器
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              粘贴任何 CSS → 点「解释」→ 拆成一条条漂亮的规则卡片，解析特异性 / !important / @media / @layer
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-zinc-600 hidden sm:inline">
              {lineCount} 行 CSS
            </span>
            <button
              onClick={handleReset}
              disabled={analysisState === 'working'}
              className="px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40"
            >
              ↺ 重置示例
            </button>
            <button
              onClick={handleExplain}
              disabled={analysisState === 'working'}
              className="cc-explain-btn"
            >
              🔮 解释 CSS
            </button>
          </div>
        </div>

        {/* 已修改提醒 */}
        {dirty && (
          <div className="mb-4 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-amber-200 bg-amber-400/10 border border-amber-400/25 cc-parse-warn">
            <span>✏️ 内容已修改，当前画廊仍显示上一次解释结果</span>
            <button onClick={handleExplain} className="ml-auto px-2.5 py-1 rounded-md text-xs font-medium text-amber-200 bg-amber-400/15 border border-amber-400/30 hover:bg-amber-400/25 transition-colors">
              重新解释
            </button>
          </div>
        )}

        {/* 解析警告 */}
        {analysisError && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm text-amber-200 bg-amber-400/10 border border-amber-400/25 cc-parse-warn">
            ⚠ {analysisError}
          </div>
        )}

        {/* 编辑器 */}
        <div className="cc-panel h-[360px]">{editorEl}</div>

        {/* 滑轨 / 画廊 / 加载层 */}
        <div className="cc-panel cc-panel-hud mt-4 h-[560px] overflow-hidden relative flex flex-col">
          {/* 视图切换 */}
          <div className="shrink-0 flex items-center gap-2 px-4 pt-2.5 pb-2">
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/5 border border-white/10">
              {VIEW_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setView(o.value)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    view === o.value
                      ? 'bg-cyan-400/15 text-cyan-200 border border-cyan-400/30'
                      : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[10px] tracking-widest text-zinc-600 uppercase">
              {parseResult.rules.length} 规则 · {parseResult.atRules.length} 特殊声明
            </span>
          </div>

          {analysisState === 'working' ? (
            <div className="relative flex-1 min-h-0">
              <div className="cc-loading" role="status">
                <div className="cc-loading-spinner" />
                <div className="cc-loading-text">正在解释 {lineCount} 行 CSS…</div>
                <div className="cc-loading-sub">
                  解析特异性 · !important · @media · @layer · @keyframes · @font-face
                </div>
              </div>
            </div>
          ) : (
            <>
              <RuleFilterBar filter={filter} />
              <div className="relative flex-1 min-h-0 flex flex-col">
                {view === 'rail' ? (
                  <RuleRail
                    filter={filter}
                    hoveredRuleIndex={hoveredRuleIndex}
                    hoveredAtRuleIndex={hoveredAtRuleIndex}
                    onHoverRule={handleHoverRule}
                    onHoverAtRule={handleHoverAtRule}
                    onRuleClick={handleRuleClick}
                    onAtRuleClick={handleAtRuleClick}
                  />
                ) : (
                  <RuleGallery
                    filter={filter}
                    hoveredRuleIndex={hoveredRuleIndex}
                    hoveredAtRuleIndex={hoveredAtRuleIndex}
                    onHoverRule={handleHoverRule}
                    onHoverAtRule={handleHoverAtRule}
                    onRuleClick={handleRuleClick}
                    onAtRuleClick={handleAtRuleClick}
                  />
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-600">
          💡 悬停规则 ↔ 源码行双向联动 · 全息滑轨 ←→ 键导航、空格播放/暂停 · 修改源码后点「解释 CSS」才会刷新
        </p>
      </div>

      {/* 详情卡 */}
      {detailRule && (
        <RuleDetailCard
          rule={detailRule}
          onLocateInSource={handleLocateRule}
          onClose={handleCloseDetail}
        />
      )}
      {detailAtRule && (
        <AtRuleDetailCard
          atRule={detailAtRule}
          onLocateInSource={handleLocateAtRule}
          onClose={handleCloseDetail}
        />
      )}
    </div>
  );
}
