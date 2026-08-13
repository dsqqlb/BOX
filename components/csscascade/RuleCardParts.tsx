'use client';

import { useMemo } from 'react';
import { CssRule } from '@/lib/cssCascade';
import { tokenizeSelector, tokenClass } from '@/lib/selectorHighlight';

// ====== 特异性徽章：三位分色 ======
export function SpecBadge({ spec }: { spec: [number, number, number] }) {
  const [a, b, c] = spec;
  return (
    <span className="cc-spec-badge shrink-0" title="特异性 (a=id, b=class/属性/伪类, c=元素/伪元素)">
      <b className="cc-spec-a">{a}</b>
      <span className="text-zinc-600">,</span>
      <b className="cc-spec-b">{b}</b>
      <span className="text-zinc-600">,</span>
      <b className="cc-spec-c">{c}</b>
    </span>
  );
}

// ====== 选择器分色高亮 ======
export function SelectorCode({ text, className = '' }: { text: string; className?: string }) {
  const tokens = useMemo(() => tokenizeSelector(text), [text]);
  return (
    <code className={`font-mono text-[13px] leading-snug break-all cc-sel ${className}`}>
      {tokens.map((t, i) =>
        t.type === 'space' ? ' ' : (
          <span key={i} className={tokenClass(t.type)}>{t.text}</span>
        )
      )}
    </code>
  );
}

// ====== 标签行 ======
export function RuleTags({ rule }: { rule: CssRule }) {
  const important = rule.declarations.some((d) => d.important);
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {important && <span className="cc-tag cc-tag-imp">🔥 !important</span>}
      {rule.mediaQuery && (
        <span className="cc-tag cc-tag-media" title={rule.mediaQuery}>@media {rule.mediaQuery}</span>
      )}
      {rule.layer && <span className="cc-tag cc-tag-layer">@layer {rule.layer}</span>}
      <span className="cc-tag cc-tag-line">第 {rule.locStart.line} 行</span>
    </div>
  );
}

// ====== 声明列表（max 截断 + “+k 更多”） ======
export function DeclList({
  declarations,
  max,
}: {
  declarations: CssRule['declarations'];
  max?: number;
}) {
  if (declarations.length === 0) {
    return <div className="mt-2 text-[11px] text-zinc-600 italic">（无声明）</div>;
  }
  const shown = max ? declarations.slice(0, max) : declarations;
  const more = max && declarations.length > max ? declarations.length - max : 0;
  return (
    <div className="mt-2 border-t border-white/5 pt-1.5 space-y-0.5">
      {shown.map((d, i) => (
        <div key={i} className="font-mono text-[11.5px] leading-5">
          <span className="text-cyan-300">{d.property}</span>
          <span className="text-zinc-600">: </span>
          <span className="text-zinc-300">{d.value}</span>
          {d.important && <span className="text-amber-300 font-semibold"> !important</span>}
          <span className="text-zinc-700">;</span>
        </div>
      ))}
      {more > 0 && <div className="text-[10.5px] text-zinc-500 pt-0.5">… 还有 {more} 条声明</div>}
    </div>
  );
}
