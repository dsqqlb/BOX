'use client';

import { useMemo } from 'react';
import { CssRule, specText } from '@/lib/cssCascade';
import { tokenizeSelector, tokenClass } from '@/lib/selectorHighlight';

interface RuleDetailCardProps {
  rule: CssRule;
  onClose: () => void;
  onLocateInSource: (rule: CssRule) => void;
}

// ====== 独立效果预览：把这一条规则单独应用到一个迷你元素 ======

interface ParsedCompound {
  tag: string;
  id: string;
  classes: string[];
  nthChild: number | null;
}

function parseCompound(compound: string): ParsedCompound {
  const tagMatch = compound.match(/^[a-zA-Z][\w-]*/);
  const idMatch = compound.match(/#([\w-]+)/);
  const classes = [...compound.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const nth = compound.match(/:nth-child\((\d+)\)/);
  return {
    tag: tagMatch ? tagMatch[0].toLowerCase() : 'div',
    id: idMatch ? idMatch[1] : '',
    classes,
    nthChild: nth ? parseInt(nth[1], 10) : null,
  };
}

function compoundHtml(c: ParsedCompound, content: string, extraClass = ''): string {
  let attrs = '';
  if (c.id) attrs += ` id="${c.id}"`;
  const cls = [...c.classes];
  if (extraClass) cls.push(extraClass);
  if (cls.length) attrs += ` class="${cls.join(' ')}"`;
  return `<${c.tag}${attrs}>${content}</${c.tag}>`;
}

/** 根据选择器生成一个能命中它的迷你 DOM 结构 */
function buildProbeBody(selectorText: string): string {
  const segments = selectorText.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const targetDesc = segments[segments.length - 1];
  const ancestors = segments.slice(0, -1).filter((s) => s !== '>' && s !== '+' && s !== '~');

  const t = parseCompound(targetDesc);
  const tag = t.tag.toLowerCase();

  // html/body 选择器 → 直接作用于页面根
  if (tag === 'body') return '<body>目标元素</body>';
  if (tag === 'html') return '<html><body>目标元素</body></html>';

  let inner: string;
  if (t.nthChild) {
    // nth-child：在最近祖先里放 N 个同 tag 兄弟，目标为第 N 个
    const siblings = Array.from({ length: t.nthChild }, (_, i) =>
      compoundHtml(t, i === t.nthChild! - 1 ? '目标元素' : '·')
    ).join('\n');
    inner = siblings;
  } else {
    inner = compoundHtml(t, '目标元素');
  }

  // 从最内层祖先往上包
  let html = inner;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = parseCompound(ancestors[i]);
    const aTag = a.tag.toLowerCase();
    if (aTag === 'body' || aTag === 'html') {
      html = `<body>${html}</body>`;
    } else {
      html = compoundHtml(a, html);
    }
  }

  return `<body class="cc-root"><div class="cc-wrap">${html}</div></body>`;
}

// 探针基础样式：让空元素可见（低特异性，规则本身会覆盖它）
const PROBE_BASE = `body{margin:0;padding:18px;background:#070a1a;color:#cbd5e1;font-family:'Segoe UI',system-ui,sans-serif}
.cc-wrap{display:flex;flex-wrap:wrap;gap:6px;align-items:flex-start}
div,span,p,li,ul,button,strong,h1,h2,h3,h4{min-width:72px;min-height:30px;display:inline-block;padding:4px 8px;margin:2px;border-radius:6px;background:rgba(255,255,255,.05);font-size:13px}
ul{padding:0;list-style:none}
li{display:block}
button{cursor:pointer}`;

function buildRuleSrcdoc(rule: CssRule): string {
  const body = buildProbeBody(rule.selectorText);
  const decls = rule.declarations
    .map((d) => `  ${d.property}: ${d.value}${d.important ? ' !important' : ''};`)
    .join('\n');
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
<style>
${PROBE_BASE}
/* ⭐ 仅这一条规则 */
${rule.selectorText} {
${decls}
}
</style>
</head>
${body}
</html>`;
}

/** 该选择器能否用「构造迷你 DOM」的方式独立预览？ */
function isProbeFriendly(sel: string): boolean {
  if (sel.includes('::')) return false; // 伪元素
  if (sel.includes('[')) return false; // 属性选择器
  if (/[+~]/.test(sel)) return false; // 兄弟组合器
  if (sel.includes('&')) return false; // 嵌套
  const pseudos = sel.match(/:[\w-]+/g) || [];
  for (const p of pseudos) {
    if (p.slice(1).toLowerCase() !== 'nth-child') return false; // 只允许 :nth-child
  }
  return true;
}

// ====== 卡片 ======

const ORIGIN_LABEL: Record<string, string> = {
  author: '作者样式表',
  inline: '内联 style',
};

export default function RuleDetailCard({
  rule,
  onClose,
  onLocateInSource,
}: RuleDetailCardProps) {
  const srcdoc = useMemo(() => (isProbeFriendly(rule.selectorText) ? buildRuleSrcdoc(rule) : null), [rule]);
  const selectorTokens = useMemo(() => tokenizeSelector(rule.selectorText), [rule.selectorText]);

  const isInline = rule.selectorText === 'inline style';
  const probeFriendly = !isInline && srcdoc !== null;
  const [a, b, c] = rule.specificity;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* 背板 */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg max-h-[88vh] flex flex-col cc-detail-card">
        {/* 头部 */}
        <div className="shrink-0 px-5 py-3.5 border-b border-white/10 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="font-mono text-[13px] text-white cc-rule-selector break-all">
                {selectorTokens.map((t, i) =>
                  t.type === 'space' ? ' ' : (
                    <span key={i} className={tokenClass(t.type)}>{t.text}</span>
                  )
                )}
              </code>
              {rule.declarations.some((d) => d.important) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-300 border border-amber-400/30">!important</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
              <span>{ORIGIN_LABEL[isInline ? 'inline' : 'author'] || '样式表'}</span>
              {rule.locStart.line > 0 && <span>· 第 {rule.locStart.line} 行</span>}
              {rule.layer && <span className="text-cyan-300/90">· @layer {rule.layer}</span>}
              {rule.mediaQuery && (
                <span className="text-violet-300/90">· @media {rule.mediaQuery}</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white transition-colors text-lg leading-none px-1">✕</button>
        </div>

        {/* 特异性分解 */}
        <div className="shrink-0 px-5 py-3 border-b border-white/10">
          <div className="text-[10px] tracking-widest text-zinc-500 uppercase mb-1.5">特异性</div>
          <div className="flex items-center gap-5 font-mono text-[13px]">
            <span title="id 选择器">
              <b className="cc-spec-a">{a}</b>
              <span className="text-zinc-600 ml-1 text-[10px]">ID</span>
            </span>
            <span title="类 / 属性 / 伪类">
              <b className="cc-spec-b">{b}</b>
              <span className="text-zinc-600 ml-1 text-[10px]">类·属性·伪类</span>
            </span>
            <span title="元素 / 伪元素">
              <b className="cc-spec-c">{c}</b>
              <span className="text-zinc-600 ml-1 text-[10px]">元素·伪元素</span>
            </span>
            <span className="ml-auto text-[11px] text-zinc-500">
              总分 <b className="text-cyan-300">({specText(rule.specificity)})</b>
            </span>
          </div>
        </div>

        {/* 声明列表 */}
        <div className="shrink-0 px-5 py-3 border-b border-white/10 max-h-40 overflow-y-auto">
          <div className="text-[10px] tracking-widest text-zinc-500 uppercase mb-1.5">声明</div>
          {rule.declarations.map((d, i) => (
            <div key={i} className="flex items-center gap-2 font-mono text-[12px] leading-6">
              <span className="text-cyan-300">{d.property}</span>
              <span className="text-zinc-600">:</span>
              <code className="text-zinc-200">{d.value}</code>
              {d.important && <span className="text-[10px] text-amber-300 font-semibold">!important</span>}
            </div>
          ))}
        </div>

        {/* 独立效果预览 */}
        <div className="flex-1 min-h-0 flex flex-col px-5 py-3">
          {isInline ? (
            <div className="flex-1 min-h-[120px] flex items-center justify-center rounded-lg border border-dashed border-pink-400/30 bg-pink-400/5 text-center px-6">
              <p className="text-sm text-pink-200/90">
                💗 这是元素自身的 <code className="font-mono text-pink-300">内联 style</code>
                <br />
                <span className="text-xs text-pink-200/50">内联样式直接写在标签上，不需要也无法作为「一条规则」单独应用</span>
              </p>
            </div>
          ) : probeFriendly ? (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] tracking-widest text-zinc-500 uppercase">
                  ✨ 独立效果 <span className="text-zinc-600 normal-case">（仅这条规则，单独应用）</span>
                </span>
                {rule.mediaQuery && (
                  <span className="text-[10px] text-amber-300/80">⚠ 实际受 @media 条件控制</span>
                )}
              </div>
              <div className="flex-1 min-h-[120px] rounded-lg overflow-hidden border border-white/10 bg-[#070a1a]">
                <iframe title="single-rule-preview" srcDoc={srcdoc!} className="w-full h-full border-0" />
              </div>
            </>
          ) : (
            <div className="flex-1 min-h-[120px] flex items-center justify-center rounded-lg border border-dashed border-violet-400/30 bg-violet-400/5 text-center px-6">
              <p className="text-sm text-violet-200/90">
                🧪 这个选择器太复杂，无法独立预览匹配效果
                <br />
                <span className="text-xs text-violet-200/50">
                  含伪元素 / 属性 / 兄弟 / 嵌套选择器时，无法静态构造出命中它的迷你 DOM。
                  <br />
                  它的结构已在上方分色展示，请结合左侧源码查看它要匹配的目标。
                </span>
              </p>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="shrink-0 px-5 pb-4 flex gap-2">
          <button
            onClick={() => onLocateInSource(rule)}
            className="flex-1 py-2 rounded-lg text-sm font-medium text-violet-200 bg-violet-400/10 border border-violet-400/30 hover:bg-violet-400/20 transition-colors"
          >
            📌 在源码中定位
          </button>
        </div>
      </div>
    </div>
  );
}
