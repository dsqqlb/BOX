'use client';

import { CssAtRule } from '@/lib/cssCascade';

interface AtRuleDetailCardProps {
  atRule: CssAtRule;
  onClose: () => void;
  onLocateInSource: (atRule: CssAtRule) => void;
}

const NAME_LABEL: Record<string, string> = {
  keyframes: '关键帧动画',
  'font-face': '自定义字体',
  property: '自定义属性',
  page: '打印分页',
};

export default function AtRuleDetailCard({ atRule, onClose, onLocateInSource }: AtRuleDetailCardProps) {
  const isKeyframes = atRule.frames !== undefined;
  const decls = atRule.declarations ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg max-h-[88vh] flex flex-col cc-detail-card">
        {/* 头部 */}
        <div className="shrink-0 px-5 py-3.5 border-b border-white/10 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="cc-atrule-name text-[14px]">@{atRule.name}</span>
              {atRule.prelude && (
                <code className="font-mono text-[14px] text-violet-200 cc-rule-selector">{atRule.prelude}</code>
              )}
              <span className="cc-atrule-badge">
                {isKeyframes ? `${atRule.frames?.length ?? 0} 帧` : `${decls.length} 声明`}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
              <span>{NAME_LABEL[atRule.name] || '特殊声明'}</span>
              {atRule.locStart.line > 0 && <span>· 第 {atRule.locStart.line} 行</span>}
              {atRule.layer && <span className="text-cyan-300/90">· @layer {atRule.layer}</span>}
              {atRule.mediaQuery && <span className="text-violet-300/90">· @media {atRule.mediaQuery}</span>}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 text-zinc-400 hover:text-white transition-colors text-lg leading-none px-1">✕</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3">
          {isKeyframes && atRule.frames ? (
            <div className="space-y-2">
              {atRule.frames.map((f, i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                  <div className="font-mono text-[12px] text-amber-300 mb-1">▸ {f.key}</div>
                  <div className="space-y-0.5 font-mono text-[11.5px]">
                    {f.declarations.map((d, j) => (
                      <div key={j}>
                        <span className="text-cyan-300">{d.property}</span>
                        <span className="text-zinc-600">: </span>
                        <span className="text-zinc-300">{d.value}</span>
                        {d.important && <span className="text-amber-300 font-semibold"> !important</span>}
                        <span className="text-zinc-700">;</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1 font-mono text-[12px]">
              {decls.map((d, i) => (
                <div key={i}>
                  <span className="text-cyan-300">{d.property}</span>
                  <span className="text-zinc-600">: </span>
                  <span className="text-zinc-200 break-all">{d.value}</span>
                  {d.important && <span className="text-amber-300 font-semibold"> !important</span>}
                  <span className="text-zinc-700">;</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0 px-5 pb-4">
          <button
            onClick={() => onLocateInSource(atRule)}
            className="w-full py-2 rounded-lg text-sm font-medium text-violet-200 bg-violet-400/10 border border-violet-400/30 hover:bg-violet-400/20 transition-colors"
          >
            📌 在源码中定位
          </button>
        </div>
      </div>
    </div>
  );
}
