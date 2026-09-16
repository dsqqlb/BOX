'use client';

import { RuleFilterState } from './useRuleFilter';

const SORT_OPTIONS = [
  { value: 'source', label: '源码顺序' },
  { value: 'spec-desc', label: '特异性 ↓' },
] as const;

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
        active
          ? 'bg-cyan-400/15 text-cyan-200 border-cyan-400/40'
          : 'bg-white/5 text-zinc-400 border-white/10 hover:text-zinc-200 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

/** 共享筛选工具栏：搜索 / 排序 / 筛选 chips / 统计。全息滑轨与卡片画廊共用。 */
export default function RuleFilterBar({ filter }: { filter: RuleFilterState }) {
  return (
    <div className="cc-summary cc-gallery-toolbar shrink-0 pl-5 pr-3 py-2 flex flex-wrap items-center gap-2">
      <input
        value={filter.query}
        onChange={(e) => filter.setQuery(e.target.value)}
        placeholder="🔍 搜索选择器 / 属性…"
        aria-label="搜索规则"
        className="cc-search w-52"
      />
      <select
        value={filter.sort}
        onChange={(e) => filter.setSort(e.target.value as 'source' | 'spec-desc')}
        aria-label="排序"
        className="cc-select"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <FilterChip
        active={filter.filterImportant}
        label="🔥 !important"
        onClick={() => filter.setFilterImportant(!filter.filterImportant)}
      />
      <FilterChip
        active={filter.filterMedia}
        label="📱 @media"
        onClick={() => filter.setFilterMedia(!filter.filterMedia)}
      />
      <FilterChip
        active={filter.filterLayer}
        label="🧅 @layer"
        onClick={() => filter.setFilterLayer(!filter.filterLayer)}
      />
      <span className="ml-auto text-[11px] text-zinc-500 shrink-0 cc-summary-stats">
        命中{' '}
        <b className="text-cyan-300">{filter.filteredRules.length}</b> 条规则
        {filter.filteredAtRules.length > 0 && (
          <> · <b className="text-violet-300">{filter.filteredAtRules.length}</b> 特殊声明</>
        )}
        <> · <b className="text-emerald-300">{filter.stats.props}</b> 属性 · <b className="text-amber-300">{filter.stats.important}</b> !imp · <b className="text-fuchsia-300">{filter.stats.layers}</b> layer</>
      </span>
    </div>
  );
}
