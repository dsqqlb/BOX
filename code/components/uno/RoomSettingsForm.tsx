'use client';

/** 房间设置表单：座位数、思考时间、房规开关（建军与等待室共用同一套控件）。 */

import type { UnoCatalog, UnoRoomSettings } from '@/lib/uno/types';
import { thinkLabel } from '@/lib/uno/catalog';
import HouseRulePicker from './HouseRulePicker';

export interface SettingsDraft {
  seats: number;
  thinkSeconds: number;
  rules: Record<string, boolean | number | string>;
}

/** 按牌库目录给出默认设置（房规默认值以服务端 content 为准）。 */
export function draftFromCatalog(catalog: UnoCatalog | null): SettingsDraft {
  const rules: Record<string, boolean | number | string> = {};
  for (const rule of catalog?.houseRules || []) rules[rule.id] = rule.default;
  return {
    seats: catalog?.turnDefaults?.seats ?? catalog?.limits?.maxSeats ?? 4,
    thinkSeconds: catalog?.turnDefaults?.thinkSeconds ?? 20,
    rules,
  };
}

/** 用房间当前设置填充表单（房主在等待室改设置时用）。 */
export function draftFromRoom(settings: UnoRoomSettings): SettingsDraft {
  return { seats: settings.seats, thinkSeconds: settings.thinkSeconds, rules: { ...settings.rules } };
}

function OptionRow({
  label,
  options,
  value,
  onPick,
  disabled,
  hint,
}: {
  label: string;
  options: { value: number; label: string }[];
  value: number;
  onPick: (value: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onPick(option.value)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              value === option.value
                ? 'border-amber-300/60 bg-amber-300/15 text-amber-100'
                : 'border-white/[.1] bg-white/[.03] text-slate-300 hover:bg-white/[.07]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function RoomSettingsForm({
  catalog,
  draft,
  onChange,
  disabled = false,
  showSeats = true,
}: {
  catalog: UnoCatalog | null;
  draft: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
  disabled?: boolean;
  showSeats?: boolean;
}) {
  const minSeats = catalog?.limits?.minSeats ?? 2;
  const maxSeats = catalog?.limits?.maxSeats ?? 4;
  const seatOptions = Array.from({ length: maxSeats - minSeats + 1 }, (_, index) => minSeats + index);
  const thinkOptions = catalog?.thinkOptions?.length ? catalog.thinkOptions : [10, 20, 30, 0];

  return (
    <div className="space-y-5">
      {showSeats && (
        <OptionRow
          label="座位数"
          hint={`${minSeats}–${maxSeats} 人（含机器人）`}
          value={draft.seats}
          disabled={disabled}
          onPick={(seats) => onChange({ ...draft, seats })}
          options={seatOptions.map((seats) => ({ value: seats, label: `${seats} 人` }))}
        />
      )}

      <OptionRow
        label="思考时间"
        hint="超时后由机器人接管这一手"
        value={draft.thinkSeconds}
        disabled={disabled}
        onPick={(thinkSeconds) => onChange({ ...draft, thinkSeconds })}
        options={thinkOptions.map((seconds) => ({ value: seconds, label: thinkLabel(seconds) }))}
      />

      <div>
        <div className="mb-2 text-xs font-semibold text-slate-300">房规</div>
        <HouseRulePicker
          rules={catalog?.houseRules || []}
          values={draft.rules}
          disabled={disabled}
          onChange={(id, value) => onChange({ ...draft, rules: { ...draft.rules, [id]: value } })}
        />
      </div>

      <div className="rounded-xl border border-dashed border-white/[.12] bg-white/[.02] px-3 py-2.5 text-xs leading-5 text-slate-400">
        拓展包（自定义牌与新玩法）会在后面的步骤里上线，届时这里会出现可勾选的拓展列表，并且牌库一览里也能看到拓展牌。
      </div>
    </div>
  );
}