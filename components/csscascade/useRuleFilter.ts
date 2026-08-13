'use client';

import { useMemo, useState } from 'react';
import { CssRule, CssAtRule, compareSpec } from '@/lib/cssCascade';

export interface RuleFilterStats {
  /** 属性种类数 */
  props: number;
  /** !important 声明数 */
  important: number;
  /** @layer 层数 */
  layers: number;
}

export interface RuleFilterState {
  query: string;
  setQuery: (v: string) => void;
  sort: 'source' | 'spec-desc';
  setSort: (v: 'source' | 'spec-desc') => void;
  filterImportant: boolean;
  setFilterImportant: (v: boolean) => void;
  filterMedia: boolean;
  setFilterMedia: (v: boolean) => void;
  filterLayer: boolean;
  setFilterLayer: (v: boolean) => void;
  filteredRules: CssRule[];
  filteredAtRules: CssAtRule[];
  stats: RuleFilterStats;
}

/**
 * 规则筛选/搜索/排序/统计 共享状态。
 * 页面持有单一实例，全息滑轨与卡片画廊共用同一份筛选结果，切标签不丢条件。
 */
export function useRuleFilter(rules: CssRule[], atRules: CssAtRule[]): RuleFilterState {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'source' | 'spec-desc'>('source');
  const [filterImportant, setFilterImportant] = useState(false);
  const [filterMedia, setFilterMedia] = useState(false);
  const [filterLayer, setFilterLayer] = useState(false);

  const filteredRules = useMemo(() => {
    let list = rules;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (r) =>
          r.selectorText.toLowerCase().includes(q) ||
          r.declarations.some((d) => d.property.toLowerCase().includes(q)) ||
          (r.mediaQuery ?? '').toLowerCase().includes(q)
      );
    }
    if (filterImportant) list = list.filter((r) => r.declarations.some((d) => d.important));
    if (filterMedia) list = list.filter((r) => r.mediaQuery);
    if (filterLayer) list = list.filter((r) => r.layer);
    const sorted = [...list];
    if (sort === 'spec-desc') sorted.sort((a, b) => compareSpec(b.specificity, a.specificity));
    return sorted;
  }, [rules, query, sort, filterImportant, filterMedia, filterLayer]);

  const filteredAtRules = useMemo(() => {
    if (!query) return atRules;
    const q = query.toLowerCase();
    return atRules.filter(
      (a) =>
        a.prelude.toLowerCase().includes(q) ||
        (a.declarations ?? []).some((d) => d.property.toLowerCase().includes(q))
    );
  }, [atRules, query]);

  const stats = useMemo(() => {
    const props = new Set<string>();
    let important = 0;
    const layers = new Set<string>();
    const scan = (decls: { property: string; important: boolean }[], layer: string | null) => {
      for (const d of decls) {
        props.add(d.property);
        if (d.important) important++;
      }
      if (layer) layers.add(layer);
    };
    for (const r of rules) scan(r.declarations, r.layer);
    for (const a of atRules) {
      if (a.declarations) scan(a.declarations, a.layer);
      if (a.frames) for (const f of a.frames) scan(f.declarations, a.layer);
    }
    return { props: props.size, important, layers: layers.size };
  }, [rules, atRules]);

  return {
    query,
    setQuery,
    sort,
    setSort,
    filterImportant,
    setFilterImportant,
    filterMedia,
    setFilterMedia,
    filterLayer,
    setFilterLayer,
    filteredRules,
    filteredAtRules,
    stats,
  };
}
