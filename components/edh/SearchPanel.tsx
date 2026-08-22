'use client';

import { useState } from 'react';
import { MANA_COLOR_LABEL, MANA_COLORS, ManaColor } from '@/lib/edh/types';
import { TYPE_LABEL_ZH, TYPE_ORDER } from '@/lib/edh/mana';

const FIELDS = [['all', '全部字段'], ['name', '卡名'], ['type', '类别'], ['oracle', '文本描述'], ['flavor', '趣味文字'], ['artist', '作者']] as const;
const RARITIES = [['common', '普通'], ['uncommon', '非普通'], ['rare', '稀有'], ['mythic', '秘稀']] as const;
const FORMATS = [['', '任意赛制'], ['commander', '指挥官'], ['standard', '标准'], ['pioneer', '先锋'], ['modern', '摩登'], ['legacy', '薪传'], ['vintage', '古典'], ['pauper', '纯普'], ['brawl', '斗殴'], ['oathbreaker', '破誓者']];

export interface SearchPanelState {
  q: string; searchField: 'all' | 'name' | 'type' | 'oracle' | 'flavor' | 'artist';
  colors: ManaColor[]; colorMode: 'subset' | 'exact'; types: string[]; rarities: string[];
  cmcMin: number; cmcMax: number; powerMin: string; powerMax: string; toughnessMin: string; toughnessMax: string;
  format: string; nonReprint: boolean; commanderOnly: boolean;
}
export const EMPTY_SEARCH_STATE: SearchPanelState = { q: '', searchField: 'all', colors: [], colorMode: 'subset', types: [], rarities: [], cmcMin: 0, cmcMax: 16, powerMin: '', powerMax: '', toughnessMin: '', toughnessMax: '', format: '', nonReprint: false, commanderOnly: false };

function Toggle({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
 return <button type="button" onClick={onClick} className={`rounded-lg border px-2.5 py-1.5 text-xs transition ${active ? 'border-cyan-300/50 bg-cyan-300/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-white'}`}>{children}</button>;
}
export default function SearchPanel({ state, onChange, onSearch }: { state: SearchPanelState; onChange: (v: SearchPanelState) => void; onSearch: () => void }) {
 const [filtersOpen, setFiltersOpen] = useState(false);
 const toggle = (key: 'colors' | 'types' | 'rarities', value: string) => {
   const values = state[key] as string[];
   onChange({ ...state, [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value] } as SearchPanelState);
 };
 const range = (key: 'cmcMin'|'cmcMax', value: number) => onChange({ ...state, [key]: value, ...(key === 'cmcMin' && value > state.cmcMax ? { cmcMax: value } : {}), ...(key === 'cmcMax' && value < state.cmcMin ? { cmcMin: value } : {}) });
 return <form onSubmit={(e) => { e.preventDefault(); onSearch(); }} className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
   <div className="flex gap-2"><select value={state.searchField} onChange={(e) => onChange({ ...state, searchField: e.target.value as SearchPanelState['searchField'] })} className="rounded-xl border border-white/10 bg-slate-950/60 px-2 text-xs text-slate-300">{FIELDS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><input value={state.q} onChange={(e) => onChange({ ...state, q: e.target.value })} placeholder="输入关键词后点击搜索…" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/70"/><button className="rounded-xl bg-gradient-to-r from-cyan-400 to-violet-500 px-4 text-sm font-semibold text-slate-950">搜索</button></div>
   {/* 移动端：筛选条件折叠成一行开关，避免把搜索结果挤到屏幕外 */}
   <button type="button" onClick={() => setFiltersOpen((v) => !v)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-400 sm:hidden">
     <span>筛选条件</span><span>{filtersOpen ? '收起 ▲' : '展开 ▼'}</span>
   </button>
   <div className={`space-y-4 ${filtersOpen ? 'block' : 'hidden sm:block'}`}>
   <section><p className="mb-2 text-[11px] font-semibold text-slate-500">颜色 identity</p><div className="flex flex-wrap gap-2">{MANA_COLORS.map((c) => <Toggle key={c} active={state.colors.includes(c)} onClick={() => toggle('colors', c)}>{MANA_COLOR_LABEL[c]} {c}</Toggle>)}<select value={state.colorMode} onChange={(e) => onChange({ ...state, colorMode: e.target.value as 'subset'|'exact' })} className="rounded-lg border border-white/10 bg-slate-950/50 px-2 text-xs text-slate-300"><option value="subset">不超出所选</option><option value="exact">正好是所选</option></select></div></section>
   <section><p className="mb-2 text-[11px] font-semibold text-slate-500">类别与稀有度</p><div className="flex flex-wrap gap-2">{TYPE_ORDER.filter((t) => t !== 'other').map((t) => <Toggle key={t} active={state.types.includes(t)} onClick={() => toggle('types', t)}>{TYPE_LABEL_ZH[t]}</Toggle>)}{RARITIES.map(([v,l]) => <Toggle key={v} active={state.rarities.includes(v)} onClick={() => toggle('rarities', v)}>{l}</Toggle>)}</div></section>
   <section><div className="mb-2 flex justify-between text-[11px] font-semibold text-slate-500"><span>总法术力费用</span><span>{state.cmcMin} — {state.cmcMax >= 16 ? '16+' : state.cmcMax}</span></div><div className="relative h-6"><input aria-label="最小法术力" type="range" min="0" max="16" value={state.cmcMin} onChange={(e) => range('cmcMin', Number(e.target.value))} className="absolute w-full accent-cyan-300"/><input aria-label="最大法术力" type="range" min="0" max="16" value={state.cmcMax} onChange={(e) => range('cmcMax', Number(e.target.value))} className="absolute w-full accent-violet-400"/></div></section>
   <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[['powerMin','力量≥'],['powerMax','力量≤'],['toughnessMin','防御≥'],['toughnessMax','防御≤']].map(([key,label]) => <label key={key} className="text-[11px] text-slate-500">{label}<input type="number" value={state[key as keyof SearchPanelState] as string} onChange={(e) => onChange({ ...state, [key]: e.target.value })} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-xs text-white"/></label>)}</section>
   <div className="flex flex-wrap items-center gap-3"><select value={state.format} onChange={(e) => onChange({ ...state, format: e.target.value })} className="rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-xs text-slate-300">{FORMATS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select><label className="text-xs text-slate-400"><input type="checkbox" checked={state.nonReprint} onChange={(e) => onChange({ ...state, nonReprint: e.target.checked })} className="mr-1.5 accent-cyan-300"/>非重印版</label><label className="text-xs text-slate-400"><input type="checkbox" checked={state.commanderOnly} onChange={(e) => onChange({ ...state, commanderOnly: e.target.checked })} className="mr-1.5 accent-amber-300"/>可作指挥官</label><button type="button" onClick={() => onChange(EMPTY_SEARCH_STATE)} className="ml-auto text-xs text-slate-500 hover:text-white">重置筛选</button></div>
   </div>
 </form>;
}
