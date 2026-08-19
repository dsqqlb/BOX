'use client';

import { MANA_COLOR_LABEL, MANA_COLORS, ManaColor } from '@/lib/edh/types';
import { TYPE_LABEL_ZH, TYPE_ORDER } from '@/lib/edh/mana';

const COLOR_DOT: Record<ManaColor, string> = {
  W: 'bg-[#f8f4e3]',
  U: 'bg-[#0e68ab]',
  B: 'bg-[#1a1a1a] ring-1 ring-white/30',
  R: 'bg-[#d3202a]',
  G: 'bg-[#00733e]',
};

export interface SearchPanelState {
  q: string;
  colors: ManaColor[];
  colorMode: 'subset' | 'exact';
  types: string[];
  cmcMin: string;
  cmcMax: string;
  commanderOnly: boolean;
}

export const EMPTY_SEARCH_STATE: SearchPanelState = {
  q: '',
  colors: [],
  colorMode: 'subset',
  types: [],
  cmcMin: '',
  cmcMax: '',
  commanderOnly: false,
};

export default function SearchPanel({ state, onChange }: { state: SearchPanelState; onChange: (next: SearchPanelState) => void }) {
  const toggleColor = (color: ManaColor) => {
    const colors = state.colors.includes(color) ? state.colors.filter((c) => c !== color) : [...state.colors, color];
    onChange({ ...state, colors });
  };

  const toggleType = (type: string) => {
    const types = state.types.includes(type) ? state.types.filter((t) => t !== type) : [...state.types, type];
    onChange({ ...state, types });
  };

  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <label className="relative block">
        <span className="sr-only">搜索卡牌</span>
        <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>
        <input
          type="search"
          value={state.q}
          onChange={(event) => onChange({ ...state, q: event.target.value })}
          placeholder="搜索卡名、类型或效果文字（支持中文）…"
          className="w-full rounded-xl border border-white/10 bg-slate-950/50 py-2.5 pl-9 pr-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10"
        />
      </label>

      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">颜色 identity</p>
        <div className="flex flex-wrap items-center gap-2">
          {MANA_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => toggleColor(color)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                state.colors.includes(color) ? 'border-cyan-300/50 bg-cyan-300/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
            >
              <span className={`h-3 w-3 rounded-full ${COLOR_DOT[color]}`} />
              {MANA_COLOR_LABEL[color]}
            </button>
          ))}
          <select
            value={state.colorMode}
            onChange={(event) => onChange({ ...state, colorMode: event.target.value as 'subset' | 'exact' })}
            className="rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-cyan-300/50"
          >
            <option value="subset">不超出所选颜色</option>
            <option value="exact">正好是所选颜色</option>
          </select>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold tracking-wide text-slate-500">类别</p>
        <div className="flex flex-wrap gap-2">
          {TYPE_ORDER.filter((t) => t !== 'other').map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                state.types.includes(type) ? 'border-violet-300/50 bg-violet-300/10 text-white' : 'border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
            >
              {TYPE_LABEL_ZH[type]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">法力值</span>
          <input
            type="number"
            min={0}
            value={state.cmcMin}
            onChange={(event) => onChange({ ...state, cmcMin: event.target.value })}
            placeholder="最小"
            className="w-16 rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <span className="text-slate-600">–</span>
          <input
            type="number"
            min={0}
            value={state.cmcMax}
            onChange={(event) => onChange({ ...state, cmcMax: event.target.value })}
            placeholder="最大"
            className="w-16 rounded-lg border border-white/10 bg-slate-950/50 px-2 py-1.5 text-xs text-white outline-none focus:border-cyan-300/50"
          />
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={state.commanderOnly}
            onChange={(event) => onChange({ ...state, commanderOnly: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-white/20 bg-slate-950 accent-amber-400"
          />
          仅显示可作指挥官
        </label>
        {(state.q || state.colors.length > 0 || state.types.length > 0 || state.cmcMin || state.cmcMax || state.commanderOnly) && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_SEARCH_STATE)}
            className="ml-auto text-[11px] text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
          >
            清空筛选
          </button>
        )}
      </div>
    </div>
  );
}
