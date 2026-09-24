'use client';

/**
 * 房规开关渲染：条目、名称与说明全部来自 /api/uno/catalog，
 * 所以以后加拓展包（新的房规开关）时，这个组件不用改代码。
 */

import type { UnoHouseRule } from '@/lib/uno/types';

export default function HouseRulePicker({
  rules,
  values,
  onChange,
  disabled = false,
}: {
  rules: UnoHouseRule[];
  values: Record<string, boolean | number | string>;
  onChange: (id: string, value: boolean | number | string) => void;
  disabled?: boolean;
}) {
  if (!rules.length) return null;

  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        if (rule.type !== 'boolean') {
          // 数字型 / 下拉型房规会随拓展系统（Step 7）一起做进界面。
          return (
            <div key={rule.id} className="rounded-xl border border-white/[.08] bg-white/[.02] px-3 py-2.5">
              <div className="text-sm font-bold text-slate-300">{rule.name}</div>
              <div className="mt-0.5 text-xs leading-5 text-slate-500">
                {rule.description || ''}（这一项是{rule.type === 'number' ? '数字' : '选项'}型，界面在拓展系统那一步补上）
              </div>
            </div>
          );
        }

        const on = Boolean(values[rule.id]);
        return (
          <button
            key={rule.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(rule.id, !on)}
            aria-pressed={on}
            className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? 'border-amber-300/50 bg-amber-300/10' : 'border-white/[.09] bg-white/[.02] hover:bg-white/[.06]'
            }`}
          >
            <span className={`mt-0.5 grid h-5 w-9 shrink-0 place-items-center rounded-full transition ${on ? 'bg-amber-300' : 'bg-white/15'}`}>
              <span className={`h-3.5 w-3.5 rounded-full bg-slate-950 shadow transition ${on ? 'translate-x-2' : '-translate-x-2'}`} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-white">{rule.name}</span>
              {rule.description && <span className="mt-0.5 block text-xs leading-5 text-slate-400">{rule.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}