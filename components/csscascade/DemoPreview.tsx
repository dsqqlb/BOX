'use client';

import { useMemo, useEffect, useRef, useCallback } from 'react';
import { DEFAULT_DEMO_HTML, DEFAULT_DEMO_CSS } from '@/data/cssCascadeDemo';

interface DemoPreviewProps {
  frameRef: React.RefObject<HTMLIFrameElement | null>;
  htmlText: string;
  cssText: string;
  selectedSelector: string | null;
  onSelect: (selector: string | null) => void;
  onFrameLoad: () => void;
}

// ====== 注入 iframe 的脚本：点击选元素 → 生成唯一选择器 → 高亮 → 通知父页面 ======
const INJECT_SCRIPT = `(function(){
  function uniqueSelector(el){
    if (!el || el.nodeType !== 1) return '';
    if (el === document.documentElement) return 'html';
    if (el.id) return '#' + el.id;
    var path = [];
    var node = el;
    while (node && node.nodeType === 1 && path.length < 5) {
      var tag = node.tagName.toLowerCase();
      if (node.id) { path.unshift('#' + node.id); break; }
      var cls = String(node.className || '').trim().split(/\\s+/).filter(Boolean);
      var sel = tag;
      if (cls.length) sel += '.' + cls.slice(0, 2).join('.');
      var p = node.parentElement;
      if (p && node !== document.body && node !== document.documentElement) {
        var sameTag = Array.prototype.filter.call(p.children, function(c){ return c.tagName === node.tagName; });
        if (sameTag.length > 1) {
          var idx = sameTag.indexOf(node) + 1;
          sel += ':nth-child(' + idx + ')';
        }
      }
      path.unshift(sel);
      node = p;
    }
    return path.join(' > ');
  }
  function clearOutline(){
    var arr = document.querySelectorAll('.cc-outline');
    for (var i = 0; i < arr.length; i++) arr[i].classList.remove('cc-outline');
  }
  function highlight(sel){
    clearOutline();
    if (!sel) return;
    var els = document.querySelectorAll(sel);
    for (var i = 0; i < els.length; i++) els[i].classList.add('cc-outline');
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a') : null;
    if (a) e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var sel = uniqueSelector(el);
    if (!sel) return;
    highlight(sel);
    try { window.parent.postMessage({ type: 'cascade-select', selector: sel }, '*'); } catch (err) {}
  }, true);
  window.addEventListener('message', function(e){
    if (e.data && e.data.type === 'cascade-highlight') highlight(e.data.selector);
  });
})();`;

const OUTLINE_CSS = `.cc-outline{outline:2px solid #22d3ee !important;outline-offset:2px;box-shadow:0 0 14px rgba(34,211,238,.65) !important;border-radius:2px;}`;

// ====== 内置 Demo（数据见 data/cssCascadeDemo.ts） ======

function buildSrcdoc(html: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}\n${OUTLINE_CSS}</style>
</head>
<body>
${html}
<script>${INJECT_SCRIPT}<\/script>
</body>
</html>`;
}

export default function DemoPreview({
  frameRef,
  htmlText,
  cssText,
  selectedSelector,
  onSelect,
  onFrameLoad,
}: DemoPreviewProps) {
  const srcdoc = useMemo(() => buildSrcdoc(htmlText, cssText), [htmlText, cssText]);

  // 监听 iframe 点击选择
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data && e.data.type === 'cascade-select') {
        onSelect(e.data.selector as string);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onSelect]);

  const handleClear = useCallback(() => {
    onSelect(null);
    frameRef.current?.contentWindow?.postMessage({ type: 'cascade-highlight', selector: null }, '*');
  }, [onSelect, frameRef]);

  const handleLoad = useCallback(() => {
    // 重新注入 outline（srcdoc 重载后 outline 会丢）
    if (selectedSelector) {
      frameRef.current?.contentWindow?.postMessage(
        { type: 'cascade-highlight', selector: selectedSelector },
        '*'
      );
    }
    onFrameLoad();
  }, [selectedSelector, frameRef, onFrameLoad]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶栏 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
        <span className="text-[10px] tracking-widest text-zinc-500 uppercase">🔭 Demo 预览</span>
        {selectedSelector && (
          <span className="ml-2 font-mono text-[11px] px-2 py-0.5 rounded bg-cyan-400/10 text-cyan-300 border border-cyan-400/20">
            {selectedSelector}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {selectedSelector && (
            <button
              onClick={handleClear}
              className="text-[11px] px-2 py-1 rounded-md text-zinc-400 hover:text-rose-300 hover:bg-rose-400/10 transition-colors"
            >
              ✕ 清除选择
            </button>
          )}
          <span className="text-[10px] text-zinc-600">点击元素 → 瀑布解释</span>
        </div>
      </div>

      {/* iframe */}
      <div className="relative flex-1 min-h-0 bg-[#0a0e27]">
        <iframe
          ref={frameRef}
          title="demo"
          srcDoc={srcdoc}
          onLoad={handleLoad}
          className="absolute inset-0 w-full h-full border-0 cc-demo-frame"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
