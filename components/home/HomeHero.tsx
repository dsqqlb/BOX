'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * 首页表头：按时段变化的问候 + 打字机问句 + 实时时钟。
 *
 * 时间相关的内容必须在客户端挂载后才渲染（首屏静态导出的 HTML 里没有“现在几点”），
 * 所以 now 初始为 null，先渲染占位骨架，避免 hydration 前后文字不一致。
 */

type Period = {
  key: string;
  label: string;
  icon: string;
  eyebrow: string;
  greeting: (name: string) => string;
  /** 时段光晕颜色，直接决定表头的整体色温。 */
  blob: string;
  questions: string[];
};

const PERIODS: Period[] = [
  {
    key: 'dawn', label: '清晨', icon: '🌅', eyebrow: 'EARLY HOURS',
    greeting: (name) => `天亮了，${name}。`,
    blob: 'bg-amber-300/20',
    questions: ['今天先从哪儿开始？', '要不要先给今天定个目标？', '顺手记一笔省下的钱？'],
  },
  {
    key: 'morning', label: '上午', icon: '☀️', eyebrow: 'MORNING FOCUS',
    greeting: (name) => `早上好，${name}。`,
    blob: 'bg-cyan-300/20',
    questions: ['今天想打开哪个工具？', '有什么要可视化一下的？', '要不要继续昨天那副牌组？'],
  },
  {
    key: 'afternoon', label: '午后', icon: '🌤️', eyebrow: 'AFTERNOON SHIFT',
    greeting: (name) => `下午好，${name}。`,
    blob: 'bg-teal-300/20',
    questions: ['下午想做点什么？', '来一局德州扑克？', '要不要整理下家庭药箱？'],
  },
  {
    key: 'evening', label: '傍晚', icon: '🌆', eyebrow: 'EVENING TABLE',
    greeting: (name) => `晚上好，${name}。`,
    blob: 'bg-sky-400/20',
    questions: ['今晚要开团吗？', '想抽一张塔罗牌吗？', '继续组你的指挥官牌组？'],
  },
  {
    key: 'night', label: '深夜', icon: '🌙', eyebrow: 'AFTER HOURS',
    greeting: (name) => `夜深了，${name}。`,
    blob: 'bg-indigo-300/[0.14]',
    questions: ['这么晚还在忙？', '来局生命游戏放松一下？', '看一眼今天的进度就睡吧。'],
  },
];

function periodFor(hour: number) {
  if (hour < 5) return PERIODS[4];
  if (hour < 8) return PERIODS[0];
  if (hour < 12) return PERIODS[1];
  if (hour < 18) return PERIODS[2];
  if (hour < 23) return PERIODS[3];
  return PERIODS[4];
}

const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

interface HomeHeroProps {
  username: string;
  toolCount: number;
  categoryCount: number;
  paper: boolean;
  panelClass: string;
  textClass: string;
  mutedClass: string;
  accentClass: string;
}

export default function HomeHero({ username, toolCount, categoryCount, paper, panelClass, textClass, mutedClass, accentClass }: HomeHeroProps) {
  const [now, setNow] = useState<Date | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  const period = useMemo(() => (now ? periodFor(now.getHours()) : PERIODS[1]), [now]);
  const questions = period.questions;

  // 打字机：逐字写入 → 停顿 → 逐字删除 → 换下一句。
  const [phrase, setPhrase] = useState(0);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => { setPhrase(0); setTyped(''); setDeleting(false); }, [period.key]);
  useEffect(() => {
    if (!now) return;
    const full = questions[phrase % questions.length];
    if (reducedMotion) { setTyped(full); return; }
    if (!deleting && typed === full) {
      const hold = window.setTimeout(() => setDeleting(true), 2600);
      return () => window.clearTimeout(hold);
    }
    if (deleting && typed === '') {
      setDeleting(false);
      setPhrase((current) => (current + 1) % questions.length);
      return;
    }
    const timer = window.setTimeout(() => {
      setTyped(deleting ? full.slice(0, typed.length - 1) : full.slice(0, typed.length + 1));
    }, deleting ? 34 : 72);
    return () => window.clearTimeout(timer);
  }, [now, typed, deleting, phrase, questions, reducedMotion]);

  const hours = now ? String(now.getHours()).padStart(2, '0') : '--';
  const minutes = now ? String(now.getMinutes()).padStart(2, '0') : '--';
  const dateLine = now ? `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${WEEKDAYS[now.getDay()]}` : '正在读取本机时间…';

  return (
    <section className={`home-surface home-hero relative overflow-hidden rounded-3xl border px-5 py-7 shadow-[0_24px_70px_rgba(0,0,0,.2)] backdrop-blur-sm sm:px-8 sm:py-9 ${panelClass}`}>
      {/* 时段光晕：颜色随早中晚变化，缓慢漂移。 */}
      <div aria-hidden="true" className={`home-hero-blob pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full blur-[90px] transition-colors duration-1000 ${period.blob}`} />
      <div className="home-hero-rise relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
        <div className="min-w-0">
          <p className={`mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.16em] ${accentClass}`}>
            <span>{period.eyebrow}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] tracking-normal ${paper ? 'border-slate-900/10 bg-white/70 text-slate-600' : 'border-white/10 bg-white/[0.05] text-slate-300'}`}>{period.icon} {period.label}</span>
          </p>
          <h1 className={`max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl ${textClass}`}>
            <span className={`home-hero-sheen bg-clip-text text-transparent ${paper ? 'bg-gradient-to-r from-slate-900 via-sky-700 to-teal-700' : 'bg-gradient-to-r from-white via-cyan-100 to-teal-200'}`}>{now ? period.greeting(username) : `你好，${username}。`}</span>
            <br className="hidden sm:block" />
            <span className="inline-flex min-h-[1.3em] items-baseline">
              <span>{typed}</span>
              <span aria-hidden="true" className={`home-hero-caret ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.12em] ${paper ? 'bg-sky-700' : 'bg-cyan-200'}`} />
            </span>
          </h1>
          <p className={`mt-4 max-w-xl text-sm leading-6 sm:text-base ${mutedClass}`}>收藏常用入口、折叠整类工具，或按 <kbd className="rounded border border-current/25 px-1.5 py-0.5 text-xs">Ctrl/⌘ K</kbd> 立即切换。</p>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:gap-3">
          {/* 纯数字时钟：保留读时与日期，移除秒进度环。 */}
          <div className={`rounded-2xl border px-4 py-4 ${paper ? 'border-slate-900/10 bg-white/70' : 'border-white/[0.09] bg-black/20'}`}>
            <div className="min-w-0">
              <p className={`text-4xl font-semibold leading-none tracking-tight tabular-nums ${textClass}`}>
                {hours}<span className="home-hero-colon mx-0.5">:</span>{minutes}
              </p>
              <p className={`mt-2 whitespace-nowrap text-[11px] ${mutedClass}`}>{dateLine}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <div className={`min-w-[118px] rounded-2xl border px-4 py-3 ${paper ? 'border-slate-900/10 bg-white/70' : 'border-white/[0.09] bg-black/20'}`}>
              <p className={`text-[11px] ${mutedClass}`}>已授权工具</p>
              <p className={`mt-1 text-2xl font-semibold ${textClass}`}>{toolCount}<span className={`ml-1 text-xs ${mutedClass}`}>个</span></p>
            </div>
            <div className={`min-w-[118px] rounded-2xl border px-4 py-3 ${paper ? 'border-slate-900/10 bg-white/70' : 'border-white/[0.09] bg-black/20'}`}>
              <p className={`text-[11px] ${mutedClass}`}>工具分类</p>
              <p className={`mt-1 text-2xl font-semibold ${textClass}`}>{categoryCount}<span className={`ml-1 text-xs ${mutedClass}`}>类</span></p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
