'use client';

import { ChangeEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ToolHeader from '@/components/common/ToolHeader';

type Motion = 'still' | 'left' | 'right' | 'up' | 'down' | 'pulse';
type Font = 'sans' | 'serif' | 'mono' | 'display';
type Align = 'left' | 'center' | 'right';
type PresetId = 'emergency' | 'goal' | 'welcome' | 'countdown' | 'focus';

type DisplaySettings = {
  text: string;
  motion: Motion;
  font: Font;
  align: Align;
  size: number;
  speed: number;
  blink: boolean;
  glow: boolean;
  background: string;
  color: string;
  duration: number;
  showClock: boolean;
};

const DEFAULTS: DisplaySettings = {
  text: '今天的目标：全力以赴', motion: 'still', font: 'sans', align: 'center', size: 12,
  speed: 24, blink: false, glow: true, background: '#050915', color: '#f8fafc', duration: 0, showClock: false,
};

const MOTIONS: Array<{ value: Motion; label: string; icon: string; note: string }> = [
  { value: 'still', label: '静止聚焦', icon: '▣', note: '让所有注意力落在这一句话上' },
  { value: 'left', label: '向左滚动', icon: '←', note: '经典横向字幕' },
  { value: 'right', label: '向右滚动', icon: '→', note: '反向横向字幕' },
  { value: 'up', label: '向上滚动', icon: '↑', note: '适合短促提示' },
  { value: 'down', label: '向下滚动', icon: '↓', note: '从上方落下' },
  { value: 'pulse', label: '呼吸脉冲', icon: '✦', note: '温和地吸引目光' },
];

const FONTS: Array<{ value: Font; label: string; family: string }> = [
  { value: 'sans', label: '现代无衬线', family: 'system-ui, "Segoe UI", sans-serif' },
  { value: 'serif', label: '庄重衬线', family: 'Georgia, "Times New Roman", serif' },
  { value: 'mono', label: '终端等宽', family: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
  { value: 'display', label: '海报粗体', family: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
];

const PRESETS: Array<{ id: PresetId; label: string; note: string; settings: Partial<DisplaySettings> }> = [
  { id: 'goal', label: '目标宣言', note: '清晰、沉稳、持续可见', settings: { text: '今天的目标：全力以赴', motion: 'still', color: '#f8fafc', background: '#050915', glow: true, blink: false, font: 'sans' } },
  { id: 'emergency', label: '紧急提醒', note: '高对比、闪烁、快速扫过', settings: { text: '请立即注意屏幕信息', motion: 'left', color: '#ffffff', background: '#b91c1c', glow: false, blink: true, speed: 10, font: 'display' } },
  { id: 'welcome', label: '欢迎横幅', note: '适合门店、活动或会议', settings: { text: '欢迎来到 BOX · 请享受今天的体验', motion: 'left', color: '#fde68a', background: '#172554', glow: true, blink: false, speed: 22, font: 'sans' } },
  { id: 'countdown', label: '倒计时', note: '显示文字并叠加倒计时', settings: { text: '活动即将开始', motion: 'pulse', color: '#a7f3d0', background: '#052e2b', glow: true, blink: false, duration: 300, showClock: true, font: 'display' } },
  { id: 'focus', label: '深度专注', note: '极简、静止、低干扰', settings: { text: '现在，只做这一件事。', motion: 'still', color: '#e0e7ff', background: '#111827', glow: false, blink: false, font: 'serif' } },
];

function stringParam(params: Pick<URLSearchParams, 'get'>, key: keyof DisplaySettings, fallback: string) {
  const value = params.get(key); return value === null ? fallback : value.slice(0, key === 'text' ? 240 : 32);
}
function numberParam(params: Pick<URLSearchParams, 'get'>, key: keyof DisplaySettings, fallback: number, min: number, max: number) {
  const value = Number(params.get(key)); return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function fromSearchParams(params: Pick<URLSearchParams, 'get'>): DisplaySettings {
  const motion = stringParam(params, 'motion', DEFAULTS.motion) as Motion;
  const font = stringParam(params, 'font', DEFAULTS.font) as Font;
  const align = stringParam(params, 'align', DEFAULTS.align) as Align;
  return {
    text: stringParam(params, 'text', DEFAULTS.text), motion: MOTIONS.some((entry) => entry.value === motion) ? motion : DEFAULTS.motion,
    font: FONTS.some((entry) => entry.value === font) ? font : DEFAULTS.font,
    align: ['left', 'center', 'right'].includes(align) ? align : DEFAULTS.align,
    size: numberParam(params, 'size', DEFAULTS.size, 4, 28), speed: numberParam(params, 'speed', DEFAULTS.speed, 5, 90),
    blink: params.get('blink') === '1', glow: params.get('glow') !== '0',
    background: /^#[0-9a-fA-F]{6}$/.test(params.get('background') || '') ? String(params.get('background')) : DEFAULTS.background,
    color: /^#[0-9a-fA-F]{6}$/.test(params.get('color') || '') ? String(params.get('color')) : DEFAULTS.color,
    duration: numberParam(params, 'duration', DEFAULTS.duration, 0, 86400), showClock: params.get('clock') === '1',
  };
}
function settingsToQuery(settings: DisplaySettings) {
  const params = new URLSearchParams();
  params.set('present', '1'); params.set('text', settings.text); params.set('motion', settings.motion); params.set('font', settings.font); params.set('align', settings.align);
  params.set('size', String(settings.size)); params.set('speed', String(settings.speed)); params.set('blink', settings.blink ? '1' : '0'); params.set('glow', settings.glow ? '1' : '0');
  params.set('background', settings.background); params.set('color', settings.color); params.set('duration', String(settings.duration)); params.set('clock', settings.showClock ? '1' : '0');
  return params.toString();
}
function formatTime(seconds: number) { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':'); }
function fullscreen(element: HTMLElement) { return element.requestFullscreen?.().catch(() => undefined); }

function DisplaySurface({ settings, presenter = false }: { settings: DisplaySettings; presenter?: boolean }) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [remaining, setRemaining] = useState(settings.duration);
  const [now, setNow] = useState<Date | null>(null);
  const font = FONTS.find((entry) => entry.value === settings.font) || FONTS[0];
  const isVertical = settings.motion === 'up' || settings.motion === 'down';
  const motionDuration = Math.max(4, settings.speed);

  useEffect(() => {
    setRemaining(settings.duration);
  }, [settings.duration]);
  useEffect(() => {
    if (!settings.duration) return undefined;
    const timer = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [settings.duration]);
  useEffect(() => {
    if (!settings.showClock) return undefined;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [settings.showClock]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!presenter) return;
      if (event.key === 'Escape' && document.fullscreenElement) document.exitFullscreen?.();
      if (event.key.toLowerCase() === 'f') void fullscreen(surfaceRef.current!);
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [presenter]);

  const textClass = settings.blink ? 'target-blink' : settings.motion === 'pulse' ? 'target-pulse' : '';
  const movementClass = settings.motion === 'left' ? 'target-left' : settings.motion === 'right' ? 'target-right' : settings.motion === 'up' ? 'target-up' : settings.motion === 'down' ? 'target-down' : '';
  const style = {
    '--target-color': settings.color, '--target-bg': settings.background, '--target-speed': `${motionDuration}s`, '--target-size': `${settings.size}vw`,
    '--target-shadow': settings.glow ? `0 0 0.08em ${settings.color}, 0 0 .35em ${settings.color}99, 0 0 1em ${settings.color}55` : 'none',
    backgroundColor: settings.background, color: settings.color, fontFamily: font.family,
  } as React.CSSProperties;

  return <div ref={surfaceRef} className={`target-surface relative isolate flex min-h-[360px] w-full overflow-hidden ${presenter ? 'min-h-screen' : 'rounded-3xl border border-white/[.12] shadow-2xl'}`} style={style}>
    {!presenter && <><div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: `radial-gradient(circle at 20% 10%, ${settings.color}24, transparent 28%), radial-gradient(circle at 84% 85%, ${settings.color}18, transparent 32%), linear-gradient(125deg, transparent 0%, rgba(255,255,255,.04) 50%, transparent 100%)` }} />
    <div className="pointer-events-none absolute inset-0 opacity-[.14]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.7) 1px, transparent 1px)', backgroundSize: '42px 42px', maskImage: 'radial-gradient(ellipse at center, black, transparent 78%)' }} /></>}
    <div className={`relative z-10 flex w-full flex-col ${presenter ? 'p-0' : 'p-5 sm:p-8'}`}>
      {!presenter && <div className="flex items-center justify-between gap-4 text-[10px] font-bold tracking-[.22em] opacity-55"><span>TARGET DISPLAY</span><span>{settings.motion.toUpperCase()} · {font.label.toUpperCase()}</span></div>}
      <div className={`relative flex flex-1 overflow-hidden ${isVertical ? 'items-center justify-center' : 'items-center'} ${settings.align === 'left' ? 'justify-start text-left' : settings.align === 'right' ? 'justify-end text-right' : 'justify-center text-center'}`}>
        <p className={`target-text m-0 max-w-none whitespace-nowrap font-black leading-[.95] tracking-[-.045em] ${textClass} ${movementClass}`} style={{ fontSize: `clamp(2.8rem, var(--target-size), 22rem)`, textShadow: 'var(--target-shadow)' }}>{settings.text || '输入你的目标文字'}</p>
      </div>
      {!presenter && <div className="flex items-end justify-between gap-4 text-xs font-semibold tabular-nums opacity-65"><span>{settings.showClock ? (now ? now.toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--') : 'BOX / LARGE FORMAT'}</span>{settings.duration > 0 && <span className={remaining === 0 ? 'target-blink text-lg' : ''}>{remaining === 0 ? 'TIME UP' : formatTime(remaining)}</span>}</div>}
    </div>
  </div>;
}

function Editor({ initial }: { initial: DisplaySettings }) {
  const [settings, setSettings] = useState(initial);
  const [copied, setCopied] = useState(false);
  const update = <K extends keyof DisplaySettings>(key: K, value: DisplaySettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const displayUrl = useMemo(() => `/tools/target-text?${settingsToQuery(settings)}`, [settings]);
  const openDisplay = () => window.open(displayUrl, '_blank', 'noopener,noreferrer');
  const copyDisplay = async () => {
    try { await navigator.clipboard.writeText(`${window.location.origin}${displayUrl}`); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); }
  };
  const colorInput = (label: string, key: 'background' | 'color') => <label className="flex items-center justify-between gap-3 rounded-xl border border-white/[.09] bg-slate-950/25 px-3 py-2.5 text-sm text-slate-300"><span>{label}</span><span className="flex items-center gap-2"><input aria-label={label} type="color" value={settings[key]} onChange={(event) => update(key, event.target.value)} className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" /><code className="text-xs text-slate-500">{settings[key]}</code></span></label>;

  return <main className="min-h-screen bg-[#060813] text-slate-100"><ToolHeader className="border-white/[.08] bg-[#080b18]/85" textClassName="text-slate-400 hover:text-white" />
    <div className="pointer-events-none fixed inset-0 -z-0 overflow-hidden"><div className="absolute -left-40 top-8 h-96 w-96 rounded-full bg-indigo-600/16 blur-[120px]" /><div className="absolute -right-40 bottom-10 h-[32rem] w-[32rem] rounded-full bg-cyan-500/10 blur-[130px]" /></div>
    <div className="relative mx-auto max-w-[1500px] px-4 pb-10 pt-7 sm:px-6 lg:px-8"><section className="flex flex-col gap-5 border-b border-white/[.09] pb-6 lg:flex-row lg:items-end lg:justify-between"><div><p className="flex items-center gap-2 text-xs font-semibold tracking-[.2em] text-cyan-200/80"><span className="h-px w-8 bg-cyan-300" /> LARGE FORMAT MESSAGING</p><h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">目标大屏 <span className="bg-gradient-to-r from-cyan-300 to-violet-300 bg-clip-text text-transparent">/ TARGET DISPLAY</span></h1><p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">把一句最重要的话，变成整个屏幕唯一的焦点。配置后可用独立纯净页面投屏、全屏或复制链接。</p></div><div className="flex flex-wrap gap-2"><button onClick={copyDisplay} className="rounded-xl border border-white/[.12] bg-white/[.05] px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/[.1]">{copied ? '✓ 已复制投屏链接' : '复制投屏链接'}</button><button onClick={openDisplay} className="rounded-xl bg-gradient-to-r from-cyan-300 to-violet-300 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-cyan-500/10 transition hover:brightness-110">打开投屏页 ↗</button></div></section>
      <section className="mt-6 grid gap-5 xl:grid-cols-[370px_minmax(0,1fr)]"><aside className="space-y-4 xl:max-h-[calc(100vh-150px)] xl:overflow-y-auto xl:pr-1"><div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-bold tracking-[.18em] text-cyan-200">MESSAGE</p><label className="mt-3 block text-sm text-slate-300">展示文字<textarea maxLength={240} rows={3} value={settings.text} onChange={(event) => update('text', event.target.value.replace(/\n/g, ' '))} placeholder="输入一句需要被看见的话…" className="mt-2 w-full resize-none rounded-xl border border-white/[.1] bg-slate-950/45 px-3 py-2.5 text-base text-white outline-none placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10" /></label><p className="mt-2 text-right text-[11px] text-slate-600">{settings.text.length} / 240 · 单行展示</p></div>
        <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-bold tracking-[.18em] text-violet-200">MOTION & IMPACT</p><div className="mt-3 grid grid-cols-2 gap-2">{MOTIONS.map((motion) => <button key={motion.value} onClick={() => update('motion', motion.value)} className={`rounded-xl border px-3 py-2.5 text-left transition ${settings.motion === motion.value ? 'border-cyan-300/45 bg-cyan-300/[.11] text-white' : 'border-white/[.08] bg-slate-950/25 text-slate-400 hover:bg-white/[.05]'}`}><span className="flex items-center gap-2 text-sm font-semibold"><span className="text-cyan-200">{motion.icon}</span>{motion.label}</span><span className="mt-1 block text-[10px] leading-4 opacity-60">{motion.note}</span></button>)}</div><div className="mt-4"><div className="flex justify-between text-sm text-slate-300"><span>动画周期</span><span className="font-mono text-cyan-200">{settings.speed}s</span></div><input aria-label="动画周期" type="range" min="5" max="90" value={settings.speed} onChange={(event) => update('speed', Number(event.target.value))} className="mt-2 w-full accent-cyan-300" /></div><div className="mt-3 grid grid-cols-2 gap-2"><label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[.08] bg-slate-950/25 px-3 py-2.5 text-sm"><span>闪烁警示</span><input type="checkbox" checked={settings.blink} onChange={(event) => update('blink', event.target.checked)} className="accent-cyan-300" /></label><label className="flex cursor-pointer items-center justify-between rounded-xl border border-white/[.08] bg-slate-950/25 px-3 py-2.5 text-sm"><span>文字光晕</span><input type="checkbox" checked={settings.glow} onChange={(event) => update('glow', event.target.checked)} className="accent-violet-300" /></label></div></div>
        <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-bold tracking-[.18em] text-emerald-200">TYPE & STAGE</p><label className="mt-3 block text-sm text-slate-300">字体<select value={settings.font} onChange={(event) => update('font', event.target.value as Font)} className="mt-2 w-full rounded-xl border border-white/[.1] bg-slate-950/45 px-3 py-2.5 text-white outline-none focus:border-cyan-300">{FONTS.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label><div className="mt-4"><div className="flex justify-between text-sm text-slate-300"><span>文字尺寸</span><span className="font-mono text-emerald-200">{settings.size}vw</span></div><input aria-label="文字尺寸" type="range" min="4" max="28" value={settings.size} onChange={(event) => update('size', Number(event.target.value))} className="mt-2 w-full accent-emerald-300" /></div><div className="mt-3 grid grid-cols-3 gap-2">{(['left', 'center', 'right'] as Align[]).map((align) => <button key={align} onClick={() => update('align', align)} className={`rounded-lg border py-2 text-xs ${settings.align === align ? 'border-emerald-300/45 bg-emerald-300/[.12] text-white' : 'border-white/[.08] text-slate-500 hover:text-slate-300'}`}>{align === 'left' ? '左对齐' : align === 'center' ? '居中' : '右对齐'}</button>)}</div><div className="mt-3 space-y-2">{colorInput('背景颜色', 'background')}{colorInput('文字颜色', 'color')}</div></div>
        <div className="rounded-2xl border border-white/[.1] bg-white/[.045] p-4 backdrop-blur-xl"><p className="text-[11px] font-bold tracking-[.18em] text-orange-200">TIMER</p><div className="mt-3 flex items-center justify-between text-sm"><span className="text-slate-300">倒计时秒数</span><input aria-label="倒计时秒数" type="number" min="0" max="86400" value={settings.duration} onChange={(event) => update('duration', Math.max(0, Math.min(86400, Number(event.target.value) || 0)))} className="w-24 rounded-lg border border-white/[.1] bg-slate-950/45 px-2 py-1.5 text-right font-mono text-white outline-none focus:border-orange-300" /></div><label className="mt-3 flex cursor-pointer items-center justify-between rounded-xl border border-white/[.08] bg-slate-950/25 px-3 py-2.5 text-sm"><span><span className="block">显示当前时间</span><span className="block text-[10px] text-slate-500">右下角时钟</span></span><input type="checkbox" checked={settings.showClock} onChange={(event) => update('showClock', event.target.checked)} className="accent-orange-300" /></label></div>
      </aside><div className="min-w-0"><div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold tracking-[.16em] text-slate-500">LIVE PREVIEW</p><p className="mt-1 text-sm text-slate-400">投屏页按 <kbd className="rounded border border-white/[.12] bg-white/[.05] px-1.5 py-0.5 text-xs text-slate-300">F</kbd> 可调用全屏；<kbd className="rounded border border-white/[.12] bg-white/[.05] px-1.5 py-0.5 text-xs text-slate-300">Esc</kbd> 退出。</p></div><button onClick={() => setSettings(DEFAULTS)} className="rounded-lg px-3 py-2 text-xs text-slate-500 transition hover:bg-white/[.06] hover:text-slate-200">恢复默认</button></div><DisplaySurface settings={settings} /><div className="mt-5 rounded-2xl border border-white/[.1] bg-white/[.04] p-4"><p className="text-[11px] font-bold tracking-[.18em] text-violet-200">QUICK PRESETS</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{PRESETS.map((preset) => <button key={preset.id} onClick={() => setSettings((current) => ({ ...current, ...preset.settings }))} className="rounded-xl border border-white/[.08] bg-slate-950/25 p-3 text-left transition hover:border-violet-300/35 hover:bg-violet-400/[.08]"><span className="text-sm font-semibold text-white">{preset.label}</span><span className="mt-1 block text-[11px] leading-4 text-slate-500">{preset.note}</span></button>)}</div></div></div></section>
    </div></main>;
}

function TargetTextPageInner() {
  const params = useSearchParams();
  const present = params.get('present') === '1';
  const initial = useMemo(() => fromSearchParams(params), [params]);
  if (present) return <DisplaySurface settings={initial} presenter />;
  return <Editor initial={initial} />;
}

export default function TargetTextPage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#060813] text-sm text-slate-400">正在加载目标大屏…</main>}><TargetTextPageInner /></Suspense>;
}
