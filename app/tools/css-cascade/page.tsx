'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import SourceEditor, { SourceTab } from '@/components/csscascade/SourceEditor';
import DemoPreview from '@/components/csscascade/DemoPreview';
import { DEFAULT_DEMO_HTML, DEFAULT_DEMO_CSS } from '@/data/cssCascadeDemo';
import CascadeWaterfall from '@/components/csscascade/CascadeWaterfall';
import RuleDetailCard from '@/components/csscascade/RuleDetailCard';
import { parseStylesheet, computeCascade, CascadeResult, CssRule } from '@/lib/cssCascade';

export default function CssCascadePage() {
  // ---- 源码 ----
  const [cssText, setCssText] = useState(DEFAULT_DEMO_CSS);
  const [htmlText, setHtmlText] = useState(DEFAULT_DEMO_HTML);
  const [activeTab, setActiveTab] = useState<SourceTab>('css');

  // ---- 解析 ----
  const parseResult = useMemo(() => parseStylesheet(cssText), [cssText]);
  const rulesByIdx = useMemo(() => {
    const m = new Map<number, CssRule>();
    parseResult.rules.forEach((r) => m.set(r.ruleIndex, r));
    return m;
  }, [parseResult]);

  // ---- 选择 + 层叠结果 ----
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [selectedSelector, setSelectedSelector] = useState<string | null>(null);
  const [cascadeResult, setCascadeResult] = useState<CascadeResult | null>(null);

  // ---- hover / 详情 ----
  const [hoveredRuleIndex, setHoveredRuleIndex] = useState<number | null>(null);
  const [hoverLineRange, setHoverLineRange] = useState<{ start: number; end: number } | null>(null);
  const [detailRule, setDetailRule] = useState<CssRule | null>(null);

  // 选中元素 / 解析结果 / iframe 重载 → 重算层叠
  useEffect(() => {
    if (!selectedSelector) {
      setCascadeResult(null);
      return;
    }
    const frame = frameRef.current;
    if (!frame?.contentDocument || !frame?.contentWindow) return;
    const el = frame.contentDocument.querySelector(selectedSelector);
    if (!el) {
      setCascadeResult(null);
      return;
    }
    try {
      setCascadeResult(computeCascade(parseResult.rules, el, frame.contentWindow));
    } catch {
      setCascadeResult(null);
    }
  }, [selectedSelector, parseResult, frameVersion]);

  // ---- 交互回调 ----
  const handleSelect = useCallback((selector: string | null) => {
    setSelectedSelector(selector);
  }, []);

  const handleFrameLoad = useCallback(() => {
    setFrameVersion((v) => v + 1);
  }, []);

  const handleHoverRule = useCallback(
    (ruleIndex: number | null) => {
      setHoveredRuleIndex(ruleIndex);
      if (ruleIndex === null) {
        setHoverLineRange(null);
        // 移出后恢复当前选中元素的高亮
        if (selectedSelector) {
          frameRef.current?.contentWindow?.postMessage(
            { type: 'cascade-highlight', selector: selectedSelector },
            '*'
          );
        }
        return;
      }
      const rule = rulesByIdx.get(ruleIndex);
      if (rule) {
        setHoverLineRange({
          start: Math.max(1, rule.locStart.line),
          end: Math.max(rule.locStart.line, rule.locEnd.line),
        });
        // 悬停规则 → demo 中高亮所有匹配元素（内联样式除外）
        if (rule.selectorText !== 'inline style') {
          frameRef.current?.contentWindow?.postMessage(
            { type: 'cascade-highlight', selector: rule.selectorText },
            '*'
          );
        }
      }
    },
    [rulesByIdx, selectedSelector, frameRef]
  );

  const handleHoverLine = useCallback(
    (line: number | null) => {
      if (activeTab !== 'css') return;
      if (line === null) {
        setHoveredRuleIndex(null);
        return;
      }
      const hit = parseResult.rules.find(
        (r) => r.locStart.line > 0 && line >= r.locStart.line && line <= r.locEnd.line
      );
      setHoveredRuleIndex(hit ? hit.ruleIndex : null);
    },
    [activeTab, parseResult]
  );

  const handleHighlightInMain = useCallback((selector: string) => {
    frameRef.current?.contentWindow?.postMessage({ type: 'cascade-highlight', selector }, '*');
  }, []);

  const handleRuleClick = useCallback((rule: CssRule) => {
    setDetailRule(rule);
  }, []);

  const handleCloseDetail = useCallback(() => setDetailRule(null), []);

  const handleReset = useCallback(() => {
    setCssText(DEFAULT_DEMO_CSS);
    setHtmlText(DEFAULT_DEMO_HTML);
    setSelectedSelector(null);
    setCascadeResult(null);
    setDetailRule(null);
    setHoveredRuleIndex(null);
    setHoverLineRange(null);
  }, []);

  return (
    <div className="min-h-screen cc-bg text-zinc-100">
      <ToolHeader
        className="bg-[#05060f]/85 border-b border-zinc-800/70"
        textClassName="text-zinc-300 hover:text-cyan-300"
      />

      <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 py-6">
        {/* 标题区 */}
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight cc-title-glow">
              🌊 CSS 层叠解释器
            </h1>
            <p className="text-sm text-zinc-400 mt-1">
              编辑 CSS → 点击 Demo 里的元素 → 瀑布揭示每一个属性「为什么长这样」
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 bg-white/5 border border-white/10 hover:bg-white/10 hover:text-white transition-colors"
            >
              ↺ 重置示例
            </button>
            <span className="text-[11px] text-zinc-600 hidden sm:inline">
              {parseResult.rules.length} 条规则已解析
            </span>
          </div>
        </div>

        {/* 解析警告 */}
        {parseResult.error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm text-amber-200 bg-amber-400/10 border border-amber-400/25 cc-parse-warn">
            ⚠ {parseResult.error}
          </div>
        )}

        {/* 上：编辑器 + Demo 预览 */}
        <div className="grid lg:grid-cols-2 gap-4">
          <div className="cc-panel h-[440px] lg:h-[480px]">
            <SourceEditor
              cssText={cssText}
              htmlText={htmlText}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              onCssChange={setCssText}
              onHtmlChange={setHtmlText}
              hoverLineRange={activeTab === 'css' ? hoverLineRange : null}
              onHoverLine={handleHoverLine}
            />
          </div>
          <div className="cc-panel h-[440px] lg:h-[480px]">
            <DemoPreview
              frameRef={frameRef}
              htmlText={htmlText}
              cssText={cssText}
              selectedSelector={selectedSelector}
              onSelect={handleSelect}
              onFrameLoad={handleFrameLoad}
            />
          </div>
        </div>

        {/* 下：层叠瀑布 */}
        <div className="cc-panel mt-4 h-[400px] overflow-hidden">
          <CascadeWaterfall
            result={cascadeResult}
            hoveredRuleIndex={hoveredRuleIndex}
            onHoverRule={handleHoverRule}
            onRuleClick={handleRuleClick}
          />
        </div>

        <p className="mt-4 text-center text-[11px] text-zinc-600">
          💡 悬停规则 ↔ 源码行双向联动 · 点击规则卡可单独应用每一条 CSS
        </p>
      </div>

      {/* 规则详情卡 */}
      {detailRule && (
        <RuleDetailCard
          rule={detailRule}
          onClose={handleCloseDetail}
          onHighlightInMain={handleHighlightInMain}
        />
      )}
    </div>
  );
}
