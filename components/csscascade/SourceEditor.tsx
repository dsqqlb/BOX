'use client';

import { useMemo, useRef, useState, useCallback } from 'react';
import Prism from 'prismjs';

export type SourceTab = 'css' | 'html';

interface SourceEditorProps {
  cssText: string;
  htmlText: string;
  activeTab: SourceTab;
  onTabChange: (tab: SourceTab) => void;
  onCssChange: (v: string) => void;
  onHtmlChange: (v: string) => void;
  /** 瀑布 hover 规则 → 高亮源码对应行范围（1-based，闭区间） */
  hoverLineRange: { start: number; end: number } | null;
  /** 源码 hover → 通知所在行，页面据此反查规则 */
  onHoverLine: (line: number | null) => void;
}

const LINE_H = 24; // px, 与 leading-6 对齐
const PAD = 16; // px, 编辑器上下内边距

export default function SourceEditor({
  cssText,
  htmlText,
  activeTab,
  onTabChange,
  onCssChange,
  onHtmlChange,
  hoverLineRange,
  onHoverLine,
}: SourceEditorProps) {
  const code = activeTab === 'css' ? cssText : htmlText;
  const setCode = activeTab === 'css' ? onCssChange : onHtmlChange;
  const lang = activeTab === 'css' ? 'css' : 'markup';

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);

  // prism 高亮（每次输入重算）
  const highlighted = useMemo(() => {
    try {
      return Prism.highlight(code, Prism.languages[lang], lang);
    } catch {
      return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [code, lang]);

  const lineCount = useMemo(() => code.split('\n').length, [code]);

  const handleScrollMove = useCallback(
    (e: React.MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const relY = e.clientY - rect.top + el.scrollTop - PAD;
      const line = Math.floor(relY / LINE_H) + 1;
      const bounded = line >= 1 && line <= lineCount ? line : null;
      if (bounded !== hoverLine) {
        setHoverLine(bounded);
        onHoverLine(bounded);
      }
    },
    [hoverLine, onHoverLine, lineCount]
  );

  const handleLeave = useCallback(() => {
    setHoverLine(null);
    onHoverLine(null);
  }, [onHoverLine]);

  // 从瀑布 hover 的行范围 → 生成高亮条
  const hoverBars = useMemo(() => {
    if (!hoverLineRange) return null;
    const { start, end } = hoverLineRange;
    if (start <= 0 || end < start) return null;
    const bars: React.ReactNode[] = [];
    for (let l = start; l <= end; l++) {
      bars.push(
        <div
          key={l}
          className="absolute left-0 right-0 bg-cyan-400/15 border-l-2 border-cyan-400/70 pointer-events-none cc-editor-hover-bar"
          style={{ top: (l - 1) * LINE_H, height: LINE_H }}
        />
      );
    }
    return bars;
  }, [hoverLineRange]);

  return (
    <div className="flex flex-col h-full min-h-0 cc-editor">
      {/* 标签栏 */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-white/5 shrink-0">
        {(['css', 'html'] as SourceTab[]).map((t) => (
          <button
            key={t}
            onClick={() => onTabChange(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-t-md tracking-wide transition-all ${
              activeTab === t
                ? 'text-cyan-300 bg-cyan-400/10 border-b-2 border-cyan-400 cc-tab-active'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t === 'css' ? '{ } CSS' : '〈 / 〉 HTML'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 pr-1 pb-1">
          <span className="text-[10px] text-zinc-600 tracking-widest uppercase">
            {activeTab === 'css' ? '样式表' : 'Demo 结构'}
          </span>
        </div>
      </div>

      {/* 编辑区：整体可滚动，行号/高亮层/code 都在同一文档坐标系里 */}
      <div
        ref={containerRef}
        onMouseMove={handleScrollMove}
        onMouseLeave={handleLeave}
        className="relative flex-1 overflow-auto cc-editor-scroll font-mono text-[13px] leading-6"
      >
        <div className="flex min-h-full min-w-full" style={{ padding: `${PAD}px 0` }}>
          {/* 行号 */}
          <div className="text-right select-none shrink-0 text-zinc-600 border-r border-white/5 mr-3" style={{ width: 44 }}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div
                key={i + 1}
                className={`pr-2 cc-gutter-num ${hoverLine === i + 1 ? 'text-cyan-300' : ''}`}
                style={{ height: LINE_H }}
              >
                {i + 1}
              </div>
            ))}
          </div>

          {/* 代码区（相对定位，按内容撑高） */}
          <div className="relative">
            {/* hover 高亮条 */}
            {hoverBars}
            {/* 语法高亮层 */}
            <pre className="m-0 pointer-events-none whitespace-pre text-zinc-200 cc-prism">
              <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: highlighted }} />
            </pre>
            {/* 透明编辑层 */}
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              wrap="off"
              aria-label={activeTab}
              className="absolute inset-0 m-0 border-0 p-0 resize-none bg-transparent text-transparent caret-cyan-300 whitespace-pre overflow-hidden outline-none font-mono text-[13px] leading-6"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
