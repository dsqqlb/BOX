'use client';

import { useMemo, useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import Prism from 'prismjs';

export interface SourceEditorHandle {
  /** 滚动源码到指定行（1-based），居中显示 */
  scrollToLine: (line: number) => void;
}

interface SourceEditorProps {
  cssText: string;
  onCssChange: (v: string) => void;
  /** 画廊 hover 规则 → 高亮源码对应行范围（1-based，闭区间） */
  hoverLineRange: { start: number; end: number } | null;
  /** 源码 hover → 通知所在行，页面据此反查规则 */
  onHoverLine: (line: number | null) => void;
}

const LINE_H = 24; // px, 与 leading-6 对齐
const PAD = 16; // px, 编辑器上下内边距
const GUTTER_W = 44 + 12; // 行号列宽 + 右边距

/**
 * 三段式渲染，防止长 CSS 一粘贴就卡死：
 *  ≤ SYNC_HIGHLIGHT_MAX      同步 Prism（小文件，打字即时上色）
 *  ≤ ASYNC_HIGHLIGHT_MAX     先纯文本再防抖 Prism（中等文件）
 *  >  ASYNC_HIGHLIGHT_MAX    大文件：放弃高亮，用 textarea 本身当显示层，
 *                            浏览器原生渲染几千行，绝不整段 innerHTML / 跑 Prism
 */
const SYNC_HIGHLIGHT_MAX = 8_000;
const ASYNC_HIGHLIGHT_MAX = 40_000;
/** 行号窗口：虚拟化，一次只渲染这么多行号 */
const GUTTER_WINDOW = 400;
const GUTTER_OVERSCAN = 60;
/** hover 高亮条最大行数，超出改用整段一条渐变条 */
const HOVER_MAX_BARS = 600;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function buildHighlight(code: string, lang: string): string {
  try {
    return Prism.highlight(code, Prism.languages[lang], lang);
  } catch {
    return escapeHtml(code);
  }
}

const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor(
  { cssText, onCssChange, hoverLineRange, onHoverLine },
  ref
) {
  const code = cssText;
  const lang = 'css';

  const containerRef = useRef<HTMLDivElement>(null);
  const measRef = useRef<HTMLSpanElement>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // 大文件纯文本模式的代码区宽度（跟随容器 resize 变化）
  const [containerW, setContainerW] = useState(0);

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const el = containerRef.current;
      if (!el) return;
      const top = PAD + (line - 1) * LINE_H - el.clientHeight / 2 + LINE_H / 2;
      el.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    },
  }), []);

  const lineCount = useMemo(() => code.split('\n').length, [code]);
  const isSmall = code.length <= SYNC_HIGHLIGHT_MAX;
  const isLarge = code.length > ASYNC_HIGHLIGHT_MAX;
  const isAsync = !isSmall && !isLarge;

  // 容器宽度变化 → 大文件代码区宽度跟随（支持横向滚动）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(el.clientWidth));
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ===== 语法高亮（仅小/中文件；大文件纯文本，不跑 Prism） =====
  const syncHtml = useMemo(() => (isSmall ? buildHighlight(code, lang) : null), [code, lang, isSmall]);
  const [asyncHtml, setAsyncHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!isAsync) {
      setAsyncHtml(null);
      return;
    }
    // 先立即用纯文本，保证输入可见、不卡；停 300ms 后再上色
    setAsyncHtml(escapeHtml(code));
    const t = setTimeout(() => setAsyncHtml(buildHighlight(code, lang)), 300);
    return () => clearTimeout(t);
  }, [code, lang, isAsync]);
  const displayHtml = isSmall ? (syncHtml ?? escapeHtml(code)) : isAsync ? (asyncHtml ?? escapeHtml(code)) : null;

  // ===== 大文件：代码区宽度 = max(容器剩余宽, 最长一行宽)，保横向滚动 =====
  const codeAreaWidth = useMemo(() => {
    if (!isLarge) return null;
    let longest = 0;
    let longestText = '';
    let start = 0;
    while (start < code.length) {
      const nl = code.indexOf('\n', start);
      const line = nl === -1 ? code.slice(start) : code.slice(start, nl);
      if (line.length > longest) { longest = line.length; longestText = line; }
      if (nl === -1) break;
      start = nl + 1;
    }
    let textW = 0;
    if (measRef.current) {
      measRef.current.textContent = longestText;
      textW = measRef.current.getBoundingClientRect().width;
    }
    const remaining = containerW - GUTTER_W - 2;
    return Math.max(remaining, textW + 4, 200);
  }, [isLarge, code, containerW]);

  // ===== 行号虚拟化：只渲染视口附近的行，上下用 spacer 撑满高度 =====
  const gutter = useMemo(() => {
    const maxFirst = Math.max(1, lineCount - GUTTER_WINDOW + 1);
    const first = Math.min(maxFirst, Math.max(1, Math.floor(scrollTop / LINE_H) - GUTTER_OVERSCAN));
    const last = Math.min(lineCount, first + GUTTER_WINDOW - 1);
    const nums: React.ReactNode[] = [];
    for (let l = first; l <= last; l++) {
      nums.push(
        <div
          key={l}
          className={`pr-2 cc-gutter-num ${hoverLine === l ? 'text-cyan-300' : ''}`}
          style={{ height: LINE_H }}
        >
          {l}
        </div>
      );
    }
    return { topPad: (first - 1) * LINE_H, nums, bottomPad: (lineCount - last) * LINE_H };
  }, [scrollTop, lineCount, hoverLine]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

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

  // 从画廊 hover 的行范围 → 生成高亮条（超大范围改用整段一条）
  const hoverBars = useMemo(() => {
    if (!hoverLineRange) return null;
    const { start, end } = hoverLineRange;
    if (start <= 0 || end < start) return null;
    const span = end - start + 1;
    if (span > HOVER_MAX_BARS) {
      return (
        <div
          className="absolute left-0 right-0 border-l-2 border-cyan-400/70 pointer-events-none cc-editor-hover-bar"
          style={{
            top: (start - 1) * LINE_H,
            height: span * LINE_H,
            background: 'linear-gradient(180deg, rgba(34,211,238,.20), rgba(34,211,238,.04))',
          }}
        />
      );
    }
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
      {/* 标题栏 */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-0 border-b border-white/5 shrink-0">
        <span className="px-3 py-1.5 text-xs font-medium rounded-t-md tracking-wide text-cyan-300 bg-cyan-400/10 border-b-2 border-cyan-400 cc-tab-active">
          {'{ }'} CSS
        </span>
        <div className="ml-auto flex items-center gap-3 pr-1 pb-1">
          <span className="text-[10px] text-zinc-600 tracking-widest uppercase">样式表</span>
          {isLarge && (
            <span className="text-[10px] text-amber-400/80" title="文件过大，已停用语法高亮，改用轻量纯文本渲染以避免卡顿">⚡ 纯文本模式</span>
          )}
        </div>
      </div>

      {/* 编辑区：整体可滚动，行号/高亮层/code 都在同一文档坐标系里 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onMouseMove={handleScrollMove}
        onMouseLeave={handleLeave}
        className="relative flex-1 overflow-auto cc-editor-scroll font-mono text-[13px] leading-6"
      >
        <div className="flex min-h-full min-w-full" style={{ padding: `${PAD}px 0` }}>
          {/* 行号（虚拟化：spacer + 窗口行 + spacer） */}
          <div className="text-right select-none shrink-0 text-zinc-600 border-r border-white/5 mr-3" style={{ width: 44 }}>
            <div style={{ height: gutter.topPad }} />
            {gutter.nums}
            <div style={{ height: gutter.bottomPad }} />
          </div>

          {/* 代码区 */}
          {isLarge ? (
            /* 大文件：textarea 自身当显示层（原生渲染，零 innerHTML / 零 Prism） */
            <div className="relative" style={{ width: codeAreaWidth ?? '100%', height: lineCount * LINE_H, minWidth: '100%' }}>
              {hoverBars}
              <textarea
                value={code}
                onChange={(e) => onCssChange(e.target.value)}
                spellCheck={false}
                wrap="off"
                aria-label="css"
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                className="m-0 border-0 p-0 resize-none bg-transparent text-zinc-200 caret-cyan-300 whitespace-pre overflow-hidden outline-none font-mono text-[13px] leading-6"
              />
            </div>
          ) : (
            /* 小/中文件：语法高亮 pre 垫底 + 透明 textarea 编辑层 */
            <div className="relative">
              {hoverBars}
              <pre className="m-0 pointer-events-none whitespace-pre text-zinc-200 cc-prism">
                <code className={`language-${lang}`} dangerouslySetInnerHTML={{ __html: displayHtml ?? escapeHtml(code) }} />
              </pre>
              <textarea
                value={code}
                onChange={(e) => onCssChange(e.target.value)}
                spellCheck={false}
                wrap="off"
                aria-label="css"
                className="absolute inset-0 m-0 border-0 p-0 resize-none bg-transparent text-transparent caret-cyan-300 whitespace-pre overflow-hidden outline-none font-mono text-[13px] leading-6"
              />
            </div>
          )}
        </div>
      </div>

      {/* 宽度测量锚（大文件横向滚动用） */}
      <span
        ref={measRef}
        aria-hidden
        className="invisible absolute pointer-events-none whitespace-pre font-mono text-[13px] leading-6"
        style={{ top: -9999 }}
      />
    </div>
  );
});

export default SourceEditor;
