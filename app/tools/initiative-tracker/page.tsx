'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWebSocket, getWsUrl } from '@/lib/useWebSocket';
// 怪物图片清单：由 useEnemyList 从WebSocket服务器实时读取 public/image/enemies 目录
// 图片命名规则：中文名_英文标识.png（如 哥布林弓手_goblin_archer.png），加图/改名后刷新页面即可生效，无需重启服务
import { useEnemyList, getEnemyImageUrl, filterEnemies } from '@/lib/enemies';
// 统一图片库：合并怪物图和玩家立绘，供"自定义生物"创建时任意选择图片
import { usePlayerImageList, buildMediaLibrary, filterMediaLibrary, MediaItem } from '@/lib/mediaLibrary';
// 状态效果（buff/debuff/濒死）：类型、常量清单、状态变更的纯函数逻辑，遥控器和主屏幕共用。
// 注意：遥控器只展示文字标签，不渲染环绕动效（动效只在主屏幕上展示，遥控器屏幕小、动效会显得拥挤）
import {
  StatusId,
  CharacterStatusInstance,
  STATUS_LIBRARY,
  STATUS_ORDER,
  addStatus,
  removeStatusInstance,
  setExhaustionLevel,
  recordDeathSave,
  tickStatusesForTurnStart,
} from '@/lib/statusEffects';
// 3D掷骰结果类型：遥控器和主屏幕共用同一份结构（每组小计 + 总和），只有类型定义，不含3D渲染逻辑
import type { DiceRollResult } from '@/components/dnd/DiceRoller';
// 骰子形状图标：结果面板里每颗骰子用形状轮廓(能看出D几)+数字+文字标识展示，
// 遥控器这边可点击(未重投过的骰子)，点击后弹确认框，确认了才发送重投请求
import DiceShapeIcon from '@/components/dnd/DiceShapeIcon';
// 掷骰预设：localStorage持久化的掷骰表达式(支持完整语法：NdS+kh/kl+括号+加减常数)，
// 最多10个，支持新建/改名/编辑/删除
import {
  DicePreset,
  loadDicePresets,
  saveDicePresets,
  genPresetId,
  MAX_PRESETS,
} from '@/lib/dicePresets';
// 历史记录会在初次结果与每次重投后即时更新，按房间号保存到本机浏览器。
import type { DiceHistoryEntry, DiceRerollHistoryItem } from '@/lib/diceHistory';
import { loadDiceHistory, saveDiceHistory } from '@/lib/diceHistory';
// 自定义掷骰表达式：支持 NdS + kh/kl取高取低 + 括号 + 加减常数，词法分析+递归下降解析校验。
// "自定义掷骰"标签页整个换成表达式输入框(可打字，也可用下方按钮面板拼)，不再是"加一组几D几"的表单。
import {
  ExprNode,
  EvaluatedExpression,
  FlattenedRecipe,
  parseDiceExpression,
  toEngineNotation,
  describeExpression,
  flattenToRecipe,
  evaluateRecipe,
} from '@/lib/diceExpression';
// 骰子外观预设：每个预设固定给D4/D6/D8/D10/D12/D20各自绑定一张纹理图（同一预设内同一形状统一用一张图），
// 不涉及颜色方案。内置6套 + 用户自建的自定义预设并列展示，随投掷请求一起发给主屏幕决定3D骰子的样式。
import {
  DiceAppearancePreset,
  DiceShape,
  ShapeTextureMap,
  DICE_SHAPES,
  DICE_SHAPE_LABELS,
  DICE_TEXTURE_OPTIONS,
  getTextureOption,
  DEFAULT_APPEARANCE_PRESET_ID,
  loadCustomAppearancePresets,
  saveCustomAppearancePresets,
  getAllAppearancePresets,
  getAppearancePreset,
  genAppearancePresetId,
  MAX_CUSTOM_APPEARANCE_PRESETS,
} from '@/lib/diceAppearance';

// 种族和职业数据
const RACES = [
  { name: '矮人', en: 'Dwarf' },
  { name: '精灵', en: 'Elf' },
  { name: '半身人', en: 'Halfling' },
  { name: '人类', en: 'Human' },
  { name: '龙裔', en: 'Dragonborn' },
  { name: '侏儒', en: 'Gnome' },
  { name: '半精灵', en: 'Half-Elf' },
  { name: '半兽人', en: 'Half-Orc' },
  { name: '提夫林', en: 'Tiefling' },
];

const CLASSES = [
  '野蛮人', '吟游诗人', '牧师', '德鲁伊', '战士', '武僧', 
  '圣武士', '游侠', '游荡者', '术士', '邪术师', '法师'
];

// 角色类型
interface Character {
  id: string; // 备选池中的唯一ID
  name: string;
  initiative: number;
  token: string;
  imageUrl?: string; // 可选的图片URL（像素风GIF）
  type: 'player' | 'enemy' | 'npc';
  color: string;
  inCombat: boolean; // 是否在战斗区
  combatId?: string; // 战斗区中的唯一ID（从备选池拖入时生成）
  borderColor?: string; // 自定义边框色（十六进制），未设置时按type使用阵营默认配色
  statuses?: CharacterStatusInstance[]; // buff/debuff/濒死状态列表，只在战斗区角色身上有意义
}

interface RoomState {
  roomId: string;
  characters: Character[];
  currentTurn: number;
  roundNumber: number;
  dimIntensity?: number; // 非当前回合角色的压暗强度(0~1)：0=完全不灰，1=特别灰，主屏幕据此渲染
  resultPanelOpacity?: number; // 主屏幕"骰子计算总和"结果面板的不透明度(0~1)：0=全透明，1=完全不透明
  characterScale?: number; // 主屏幕角色卡片整体缩放
  diceDisplayScale?: number; // 主屏幕3D骰子网格缩放（不影响骰盘或结果面板）
  roomInfoScale?: number; // 主屏幕左上角房间号与二维码面板缩放
  diceHistoryScale?: number; // 主屏幕右下角历史掷骰面板缩放
  displayRoomInfoVisible?: boolean; // 主屏幕房间号与二维码是否展示
  displayDiceHistoryVisible?: boolean; // 主屏幕历史掷骰面板是否展示
  displayRoundVisible?: boolean; // 主屏幕回合数是否展示
  diceHistory?: DiceHistoryEntry[]; // 房间内本次会话共享的骰子历史
}

// 非当前回合压暗强度的localStorage key + 默认值
const DIM_INTENSITY_KEY = 'dnd-initiative-dim-intensity';
const DEFAULT_DIM_INTENSITY = 0.55;

// 主屏幕骰子结果面板不透明度的localStorage key + 默认值(默认完全不透明，跟改动前的视觉效果一致)
const RESULT_PANEL_OPACITY_KEY = 'dnd-dice-result-panel-opacity';
const DEFAULT_RESULT_PANEL_OPACITY = 1;

// 主屏幕布局缩放的本机默认记忆值；连接后会同步到房间，所有显示端保持一致。
const CHARACTER_SCALE_KEY = 'dnd-initiative-character-scale';
const DICE_DISPLAY_SCALE_KEY = 'dnd-dice-display-scale';
const ROOM_INFO_SCALE_KEY = 'dnd-room-info-scale';
const DICE_HISTORY_SCALE_KEY = 'dnd-dice-history-scale';
const DEFAULT_CHARACTER_SCALE = 1;
const DEFAULT_DICE_DISPLAY_SCALE = 1;
const DEFAULT_ROOM_INFO_SCALE = 1;
const DEFAULT_DICE_HISTORY_SCALE = 1;

// 当前选中的骰子外观预设ID，存本地
const DICE_APPEARANCE_KEY = 'dnd-dice-appearance-preset';

// 预设 token
const TOKEN_PRESETS = {
  player: ['🧙‍♂️', '⚔️', '🛡️', '🏹', '🗡️', '🔮', '⚡', '🌟'],
  enemy: ['👹', '💀', '🐉', '🦇', '🕷️', '👻', '🧟', '🐺'],
  npc: ['👤', '👨', '👩', '🧔', '👨‍🦳', '👩‍🦰', '🤴', '👸'],
};

const TYPE_COLORS = {
  player: '#3b82f6',
  enemy: '#ef4444',
  npc: '#10b981',
};

// 阵营默认边框色（与主屏幕display/page.tsx保持一致）：玩家=金色，NPC=蓝色，怪物=红色
const TYPE_BORDER_COLORS: Record<Character['type'], string> = {
  player: '#fbbf24',
  npc: '#3b82f6',
  enemy: '#ef4444',
};

// 自定义生物允许用长文字当"图片"，卡片上的大字需要根据文字长度自适应缩小，避免溢出。
// 手机端卡片更小，字号也随之缩小，桌面端保持原有大小。
function getTokenFontSizeClass(token: string, isCombat: boolean): string {
  const len = token.length;
  if (isCombat) {
    if (len <= 2) return 'text-3xl sm:text-4xl md:text-5xl';
    if (len <= 4) return 'text-xl sm:text-2xl md:text-3xl';
    if (len <= 6) return 'text-base sm:text-lg md:text-xl';
    if (len <= 10) return 'text-xs sm:text-sm';
    return 'text-[10px] sm:text-xs';
  }
  if (len <= 2) return 'text-2xl sm:text-3xl md:text-4xl';
  if (len <= 4) return 'text-lg sm:text-xl md:text-2xl';
  if (len <= 6) return 'text-sm sm:text-base md:text-lg';
  if (len <= 10) return 'text-[10px] sm:text-xs';
  return 'text-[8px] sm:text-[10px]';
}

// 边框可选预设色（自定义生物创建时可选，任意角色也可以从颜色选择器自由选色）
const BORDER_COLOR_PRESETS = [
  { label: '金（玩家默认）', value: '#fbbf24' },
  { label: '蓝（NPC默认）', value: '#3b82f6' },
  { label: '红（怪物默认）', value: '#ef4444' },
  { label: '绿', value: '#10b981' },
  { label: '紫', value: '#a855f7' },
  { label: '青', value: '#06b6d4' },
  { label: '粉', value: '#ec4899' },
  { label: '白', value: '#e5e7eb' },
];

// 状态文字标签堆叠：纵向排列，悬浮在卡片正上方且留出间距（不贴着卡片）。
// 当前回合箭头也并入这同一个纵向flex流里渲染（flex-col-reverse下DOM第一个子节点会落在最靠近卡片的位置），
// 这样箭头永远紧贴卡片、状态标签永远排在箭头上方，靠正常布局流avoid叠在一起，而不是用魔法像素偏移量。
const StatusLabelStack = ({ statuses, isCurrent = false }: { statuses?: CharacterStatusInstance[]; isCurrent?: boolean }) => {
  const list = statuses || [];
  if (list.length === 0 && !isCurrent) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 flex flex-col-reverse items-center gap-1.5 pointer-events-none">
      {isCurrent && (
        <div className="text-red-500 text-2xl leading-none animate-bounce drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]">
          ▼
        </div>
      )}
      {list.map((s) => {
        const def = STATUS_LIBRARY[s.statusId];
        let suffix = '';
        if (s.statusId === 'exhaustion') suffix = ` ${s.level ?? 1}/6`;
        else if (s.statusId === 'dying') suffix = ` ${s.successes ?? 0}成/${s.failures ?? 0}败`;
        else if (s.duration != null) suffix = ` ${s.duration}回合`;
        return (
          <div
            key={s.id}
            className="px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap border shadow"
            style={{ backgroundColor: `${def.color}cc`, borderColor: def.color, color: '#fff' }}
          >
            {def.name}{suffix}
          </div>
        );
      })}
    </div>
  );
};

// 角色卡片组件
const CharacterCard = ({
  char,
  isCombat = false,
  isCurrent = false,
  scale = 1,
  onClick,
  onTouchStart,
}: {
  char: Character;
  isCombat?: boolean;
  isCurrent?: boolean;
  scale?: number;
  onClick?: () => void;
  onTouchStart?: (e: React.TouchEvent) => void;
}) => {
  // 手机端竖屏自适应：卡片在手机上更小，随着屏幕变宽逐步变大
  const size = isCombat
    ? 'w-16 h-24 sm:w-20 sm:h-28 md:w-24 md:h-32'
    : 'w-14 h-20 sm:w-16 sm:h-24 md:w-20 md:h-28';
  const nameSize = isCombat
    ? 'text-[10px] sm:text-xs md:text-sm'
    : 'text-[10px] sm:text-xs';
  const borderColor = char.borderColor || TYPE_BORDER_COLORS[char.type];

  return (
    // 外层容器：遥控器只叠状态文字标签，不渲染环绕动效
    // touch-action:none 阻止手机端长按图片时浏览器的放大/预览行为
    <div
      className={`relative ${onClick ? 'cursor-pointer' : ''}`}
      onClick={onClick}
      onTouchStart={onTouchStart}
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' as any }}
    >
      <StatusLabelStack statuses={char.statuses} isCurrent={isCurrent} />
      <div
        className={`relative ${size} rounded-xl shadow-2xl flex flex-col items-center justify-center border-4 overflow-hidden`}
        style={{
          borderColor,
          background: char.imageUrl
            ? 'transparent'
            : `linear-gradient(135deg, ${char.color}, ${char.color}dd)`,
        }}
      >
        {char.imageUrl ? (
          <>
            {/* 像素风GIF背景：draggable=false 阻止浏览器原生图片拖拽 */}
            <img
              src={char.imageUrl}
              alt={char.name}
              draggable={false}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ imageRendering: 'pixelated' }}
            />
            {/* 半透明遮罩显示名字 */}
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 backdrop-blur-sm">
              <div className={`text-white font-bold ${nameSize} px-1 py-1 text-center line-clamp-1`}>
                {char.name}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Token（emoji 或自定义生物的长文字"当图片"，自动缩小字号避免溢出） */}
            <div className={`${getTokenFontSizeClass(char.token, isCombat)} mb-1 px-1 text-center leading-tight break-all`}>
              {char.token}
            </div>
            <div className={`text-white font-bold ${nameSize} px-1 text-center line-clamp-2`}>
              {char.name}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// 自定义掷骰表达式输入面板：一个文本框(支持系统键盘直接打字) + 一套按钮拼字面板(数字/D几/kh/kl/+-()/删除/清空)，
// 两种输入方式效果等价——按钮只是往输入框里插入对应文本，输入框本身仍然是唯一的数据源。
const ExpressionKeypad = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => {
  const insert = (text: string) => onChange(value + text);
  const backspace = () => onChange(value.slice(0, -1));

  return (
    <div className="space-y-1.5">
      {/* 数字键：1~9,0 */}
      <div className="grid grid-cols-5 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => insert(n)}
            className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors"
          >
            {n}
          </button>
        ))}
      </div>
      {/* 骰子面数快捷键：直接插入"d几" */}
      <div className="grid grid-cols-4 gap-1.5">
        {[4, 6, 8, 10, 12, 20, 100, 2].map((sides) => (
          <button
            key={sides}
            type="button"
            onClick={() => insert(`d${sides}`)}
            className="py-2 rounded-lg bg-purple-900/50 hover:bg-purple-800/60 text-purple-200 font-bold text-xs transition-colors"
          >
            D{sides}
          </button>
        ))}
      </div>
      {/* 功能键：kh/kl取高取低 + 加减括号 + 删除/清空 */}
      <div className="grid grid-cols-4 gap-1.5">
        <button type="button" onClick={() => insert('kh')} className="py-2 rounded-lg bg-emerald-900/50 hover:bg-emerald-800/60 text-emerald-200 font-bold text-xs transition-colors">kh 取高</button>
        <button type="button" onClick={() => insert('kl')} className="py-2 rounded-lg bg-amber-900/50 hover:bg-amber-800/60 text-amber-200 font-bold text-xs transition-colors">kl 取低</button>
        <button type="button" onClick={() => insert('(')} className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors">(</button>
        <button type="button" onClick={() => insert(')')} className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors">)</button>
        <button type="button" onClick={() => insert('+')} className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors">+</button>
        <button type="button" onClick={() => insert('-')} className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold text-sm transition-colors">−</button>
        <button type="button" onClick={backspace} className="py-2 rounded-lg bg-slate-700 hover:bg-red-700 text-white font-bold text-xs transition-colors">⌫ 删除</button>
        <button type="button" onClick={() => onChange('')} className="py-2 rounded-lg bg-slate-700 hover:bg-red-700 text-white font-bold text-xs transition-colors">清空</button>
      </div>
    </div>
  );
};

// 纹理选择下拉框：原生<select>没法在选项里塞图片，所以自己实现一个下拉——
// 触发按钮和每个选项都带缩略图（纹理贴图本身）+ 文字名称，点击选项后收起。
const TextureSelect = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (key: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const current = getTextureOption(value);

  return (
    <div className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg bg-slate-900 border border-purple-500/30 text-white text-xs"
      >
        {current.thumbnail ? (
          <span
            className="w-5 h-5 rounded flex-shrink-0 bg-cover bg-center border border-white/10"
            style={{ backgroundImage: `url(${current.thumbnail})` }}
          />
        ) : (
          <span className="w-5 h-5 rounded flex-shrink-0 bg-white border border-white/20" />
        )}
        <span className="flex-1 text-left truncate">{current.name}</span>
        <span className="text-slate-500">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-lg bg-slate-900 border border-purple-500/40 shadow-2xl">
            {DICE_TEXTURE_OPTIONS.map((tex) => (
              <button
                key={tex.key}
                type="button"
                onClick={() => { onChange(tex.key); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left transition-colors ${
                  tex.key === value ? 'bg-purple-600/30 text-white' : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {tex.thumbnail ? (
                  <span
                    className="w-5 h-5 rounded flex-shrink-0 bg-cover bg-center border border-white/10"
                    style={{ backgroundImage: `url(${tex.thumbnail})` }}
                  />
                ) : (
                  <span className="w-5 h-5 rounded flex-shrink-0 bg-white border border-white/20" />
                )}
                <span className="truncate">{tex.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// 骰子外观预设编辑器：新建/编辑一套"每种形状固定绑定一张纹理图"的外观预设（改名 + 6个形状纹理选择 + 保存/取消）
const AppearanceEditor = ({
  name,
  textures,
  onNameChange,
  onTexturesChange,
  onSave,
  onCancel,
}: {
  name: string;
  textures: ShapeTextureMap;
  onNameChange: (name: string) => void;
  onTexturesChange: (textures: ShapeTextureMap) => void;
  onSave: () => void;
  onCancel: () => void;
}) => (
  <div className="p-3 space-y-2">
    <input
      type="text"
      value={name}
      onChange={(e) => onNameChange(e.target.value)}
      placeholder="样式名称"
      className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-purple-500/30 text-white text-sm placeholder:text-slate-500"
    />
    <div className="space-y-2">
      {DICE_SHAPES.map((shape) => (
        <div key={shape} className="flex items-center gap-2">
          <span className="w-20 flex-shrink-0 text-xs font-bold text-slate-300">{DICE_SHAPE_LABELS[shape]}</span>
          <TextureSelect
            value={textures[shape] || ''}
            onChange={(key) => onTexturesChange({ ...textures, [shape]: key })}
          />
        </div>
      ))}
    </div>
    <div className="flex gap-2 pt-1">
      <button
        onClick={onCancel}
        className="flex-1 py-2 rounded-lg text-sm font-bold text-slate-400 bg-slate-900/60 hover:bg-slate-900 transition-colors"
      >
        取消
      </button>
      <button
        onClick={onSave}
        className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-purple-600 hover:bg-purple-500 transition-colors"
      >
        保存
      </button>
    </div>
  </div>
);

// 预设编辑器：新建/编辑一个预设时展开的内联表单（改名 + 表达式输入框+拼字面板 + 保存/取消）。
// 表达式支持完整语法(NdS/kh·kl取高取低/括号/加减常数)，跟"自定义掷骰"标签页是同一套解析校验逻辑，
// 输错了保存按钮直接禁用+标红提示，不会存进一条摇不出来的坏预设。
const PresetEditor = ({
  name,
  expr,
  onNameChange,
  onExprChange,
  onSave,
  onCancel,
}: {
  name: string;
  expr: string;
  onNameChange: (name: string) => void;
  onExprChange: (expr: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) => {
  const parseResult = useMemo(() => parseDiceExpression(expr), [expr]);
  return (
    <div className="p-3 space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="预设名称（留空则用骰子表达式当名字）"
        className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-purple-500/30 text-white text-sm placeholder:text-slate-500"
      />
      <input
        type="text"
        value={expr}
        onChange={(e) => onExprChange(e.target.value)}
        placeholder="例如：2d20kh1+1d4"
        spellCheck={false}
        className={`w-full px-3 py-2 rounded-lg bg-slate-950 border-2 text-white font-mono text-center text-sm tracking-wide focus:outline-none transition-colors ${
          parseResult.ok ? 'border-purple-500/30 focus:border-purple-500' : 'border-red-500/60 focus:border-red-500'
        }`}
      />
      <div className="text-center min-h-[1.25rem]">
        {parseResult.ok ? (
          <span className="text-purple-300 font-mono text-xs">{describeExpression(parseResult.node).toUpperCase()}</span>
        ) : (
          <span className="text-red-400 text-xs font-medium">⚠ {parseResult.error}</span>
        )}
      </div>
      <ExpressionKeypad value={expr} onChange={onExprChange} />
      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-slate-400 bg-slate-900/60 hover:bg-slate-900 transition-colors"
        >
          取消
        </button>
        <button
          onClick={onSave}
          disabled={!parseResult.ok}
          className="flex-1 py-2 rounded-lg text-sm font-bold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          保存
        </button>
      </div>
    </div>
  );
};

export default function InitiativeTrackerPage() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1); // 回合数
  const [isCombatMode, setIsCombatMode] = useState(false); // 战斗专注模式（已废弃，改用房间模式）
  
  // 房间模式
  const [isConnected, setIsConnected] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [inputRoomId, setInputRoomId] = useState('');
  
  const [isAddingCharacter, setIsAddingCharacter] = useState(false);
  const [addingType, setAddingType] = useState<'player' | 'enemy' | 'npc' | 'custom'>('player'); // 添加类型
  const [customCampType, setCustomCampType] = useState<'player' | 'enemy' | 'npc'>('npc'); // 自定义生物所属阵营（决定默认边框色/类型标签）
  const [newCharName, setNewCharName] = useState('');
  const [newCharType, setNewCharType] = useState<'player' | 'enemy' | 'npc'>('player');
  const [newCharToken, setNewCharToken] = useState('🧙‍♂️');
  const [newCharImageUrl, setNewCharImageUrl] = useState(''); // 图片URL
  
  // 玩家选择
  const [selectedRace, setSelectedRace] = useState(RACES[0]);
  const [selectedClass, setSelectedClass] = useState(CLASSES[0]);
  const [raceImageIndex, setRaceImageIndex] = useState(0); // 当前种族的图片索引
  
  // 怪物清单：实时从服务器读取 public/image/enemies 目录，加图/改名后刷新页面即可看到，无需重启服务
  const { enemies: enemyList } = useEnemyList();
  // 玩家立绘清单：实时从服务器读取 public/image/player 各种族目录
  const { images: playerImageList } = usePlayerImageList();
  // 统一图片库：给"自定义生物"用，把怪物图+玩家立绘合并成同一份可搜索列表
  const mediaLibrary = useMemo(() => buildMediaLibrary(enemyList, playerImageList), [enemyList, playerImageList]);

  // 敌人选择
  const [enemySearch, setEnemySearch] = useState('');
  const [selectedEnemy, setSelectedEnemy] = useState('');
  
  // NPC选择
  const [npcSearch, setNpcSearch] = useState('');
  const [selectedNpcImage, setSelectedNpcImage] = useState('');
  const [npcImageType, setNpcImageType] = useState<'player' | 'enemy'>('player'); // NPC图片来源
  const [npcSelectedRace, setNpcSelectedRace] = useState(RACES[0]);
  const [npcSelectedClass, setNpcSelectedClass] = useState(CLASSES[0]);

  // 自定义生物：可自由选阵营、从统一图片库选图或直接写文字当图片、自选边框色
  const [customSearch, setCustomSearch] = useState('');
  const [selectedCustomMedia, setSelectedCustomMedia] = useState<MediaItem | null>(null);
  const [customTextToken, setCustomTextToken] = useState(''); // 图片库没有想要的时，写文字当"图片"
  const [customBorderColor, setCustomBorderColor] = useState(BORDER_COLOR_PRESETS[0].value);
  
  const [draggedChar, setDraggedChar] = useState<Character | null>(null);
  const [dragPreviewInit, setDragPreviewInit] = useState<number | null>(null); // 拖拽预览先攻值
  const [displayConnected, setDisplayConnected] = useState(true); // 主屏幕是否在线
  const [showOverlapModal, setShowOverlapModal] = useState(false); // 显示重叠弹窗
  const [overlapCharacters, setOverlapCharacters] = useState<Character[]>([]); // 重叠的角色
  const [sortedOverlapChars, setSortedOverlapChars] = useState<Character[]>([]); // 排序后的重叠角色
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null); // 待确认移出战斗区的角色（自定义确认弹窗，替代浏览器alert/confirm）
  const [statusModalCharId, setStatusModalCharId] = useState<string | null>(null); // 当前打开状态管理弹窗的角色ID（战斗区角色，点击卡片触发）
  const [pendingStatusId, setPendingStatusId] = useState<StatusId>('bless'); // 弹窗里"待添加状态"的选择
  const [pendingDuration, setPendingDuration] = useState<number | ''>(3); // 待添加状态的持续回合数，''表示无限
  // 主屏幕上"非当前回合角色压暗强度"滑块：0=不灰，1=特别灰，默认0.55。
  // 初次渲染先用默认值占位（避免SSR/CSR不一致），挂载后立即从localStorage读取真实值。
  const [dimIntensity, setDimIntensity] = useState(DEFAULT_DIM_INTENSITY);
  // 主屏幕"骰子计算总和"结果面板的不透明度滑块：0=全透明，1=完全不透明，默认1(跟改动前视觉一致)
  const [resultPanelOpacity, setResultPanelOpacity] = useState(DEFAULT_RESULT_PANEL_OPACITY);
  // 主屏幕缩放：角色卡片与3D骰子分别控制；骰盘画布和计算结果面板始终随视口保持原尺寸。
  const [characterScale, setCharacterScale] = useState(DEFAULT_CHARACTER_SCALE);
  const [diceDisplayScale, setDiceDisplayScale] = useState(DEFAULT_DICE_DISPLAY_SCALE);
  const [roomInfoScale, setRoomInfoScale] = useState(DEFAULT_ROOM_INFO_SCALE);
  const [diceHistoryScale, setDiceHistoryScale] = useState(DEFAULT_DICE_HISTORY_SCALE);
  // 下面三个开关控制主屏幕信息面板；遥控器底部控制栏始终可操作。
  const [displayRoomInfoVisible, setDisplayRoomInfoVisible] = useState(true);
  const [displayDiceHistoryVisible, setDisplayDiceHistoryVisible] = useState(true);
  const [displayRoundVisible, setDisplayRoundVisible] = useState(true);

  // 先攻、骰子和主屏显示设置是三个独立sheet页，切换入口固定在屏幕最下面。
  const [activeSheet, setActiveSheet] = useState<'initiative' | 'dice' | 'settings'>('initiative');

  // ===== 3D掷骰：遥控器只负责"发起投掷请求+展示结果文字"，3D动画只在主屏幕上播放 =====
  // 骰子板块现在是摊开常驻的独立区块(不再是按钮唤起的弹窗)，所以不再需要"是否显示弹窗"这个状态
  const [diceModalTab, setDiceModalTab] = useState<'presets' | 'custom' | 'settings'>('presets'); // 板块里"常用掷骰"/"自定义掷骰"/"骰子设置"三个标签页
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<DiceRollResult | null>(null);
  const lastRollIdRef = useRef<string | null>(null);
  // 重投选择与等待状态都以骰子全局id为单位：可选择多颗，主屏幕返回结果前统一显示为等待中。
  const [rerolledDieIds, setRerolledDieIds] = useState<Set<number>>(new Set());
  const [selectedRerollDieIds, setSelectedRerollDieIds] = useState<Set<number>>(new Set());
  const [pendingRerollDieIds, setPendingRerollDieIds] = useState<Set<number>>(new Set());
  const [rerollConfirmTargets, setRerollConfirmTargets] = useState<{ dieId: number; sides: number; value: number }[] | null>(null);
  // "自定义掷骰"标签页：整个换成表达式输入框(支持kh/kl取高取低+括号+加减常数)，不再是"加一组几D几"表单。
  // 表达式文本存本地记住，下次打开面板还在；实时解析成表达式树，非法输入直接标红+具体报错，投掷按钮禁用。
  const CUSTOM_EXPR_KEY = 'dnd-dice-custom-expr';
  const [customExprText, setCustomExprText] = useState('');
  // 记录"当前正在等待结果的这次投掷，对应的是哪份kh/kl配方"：只有自定义表达式投掷出去后，
  // 结果面板才需要按配方重新计算展示(哪颗骰子被丢弃)；掷预设时这里必须是null，走原来的通用展示。
  // 配方(而不是完整表达式树)会随DICE_ROLL一起发给主屏幕，让主屏幕也能展示同样细致的kh/kl明细+高亮特效。
  const pendingRecipeRef = useRef<FlattenedRecipe | null>(null);
  const [customEvalResult, setCustomEvalResult] = useState<EvaluatedExpression | null>(null);
  // 当前这轮投掷的不可变描述 + 随重投同步的最新结果；结果到达后立即写入历史。
  const currentRollHistoryRef = useRef<{
    id: string;
    label: string;
    expression: string;
    result: DiceRollResult | null;
    finalTotal: number | null;
    recordedAt: string;
    rerolls: DiceRerollHistoryItem[];
  } | null>(null);
  const [diceHistory, setDiceHistory] = useState<DiceHistoryEntry[]>([]);
  // 手机端默认折叠，避免历史记录在骰子控制区占用过多垂直空间。
  const [isDiceHistoryExpanded, setIsDiceHistoryExpanded] = useState(false);

  // 掷骰预设：最多10个，存在localStorage（只在这台设备生效，不同步到房间/其他遥控器）
  const [dicePresets, setDicePresets] = useState<DicePreset[]>([]);
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null); // 正在编辑/新建的预设ID，null=非编辑态
  const [editingPresetName, setEditingPresetName] = useState('');
  const [editingPresetExpr, setEditingPresetExpr] = useState('1d20');

  // 当前选中要使用的骰子外观预设ID（内置或自定义），跟随这台遥控器，存本地，
  // 会随DICE_ROLL一起发给主屏幕，决定这一次投掷用哪套纹理外观
  const [appearancePresetId, setAppearancePresetId] = useState(DEFAULT_APPEARANCE_PRESET_ID);
  // 用户自建的骰子外观预设（内置的6套写死在代码里，不进这个state），最多10个，存本地
  const [customAppearancePresets, setCustomAppearancePresets] = useState<DiceAppearancePreset[]>([]);
  // "骰子设置"标签页里的模式：使用预设(从列表里选一个)，还是自定义骰子材质(新建/编辑预设)，二选一用radio切换
  const [diceStyleMode, setDiceStyleMode] = useState<'preset' | 'custom'>('preset');
  // 正在新建/编辑的自定义预设：null=非编辑态，'__new__'=新建，否则是正在编辑的预设ID
  const [editingAppearanceId, setEditingAppearanceId] = useState<string | null>(null);
  const [editingAppearanceName, setEditingAppearanceName] = useState('');
  const [editingAppearanceTextures, setEditingAppearanceTextures] = useState<ShapeTextureMap>({});

  const combatZoneRef = useRef<HTMLDivElement>(null);
  // 保存effect的首次执行必须跳过：挂载时"加载"和"保存"两个effect会在同一轮依次触发，
  // 加载effect里的 setCharacters 只是排队更新、不会立刻生效，如果保存effect紧接着用
  // 挂载时的旧值(空数组)写入localStorage，会把刚读出来的备选池覆盖掉。用这个ref跳过第一次写入，
  // 从第二次(characters真正变化后)开始才允许保存，从根上避免这个竞态覆盖问题。
  const isFirstSaveRef = useRef(true);

  // 从 localStorage 加载本地备选池（初始化时，只执行一次）
  useEffect(() => {
    const saved = localStorage.getItem('dnd-initiative-reserve-pool');
    if (saved) {
      try {
        const reservePool = JSON.parse(saved).map((c: Character) => ({ 
          ...c, 
          inCombat: false, 
        }));
        setCharacters(reservePool);
      } catch (e) {
        console.error('Failed to load reserve pool:', e);
      }
    }
  }, []);

  // 从 localStorage 加载"压暗强度"滑块的记忆值（初始化时，只执行一次）
  useEffect(() => {
    const saved = localStorage.getItem(DIM_INTENSITY_KEY);
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!Number.isNaN(parsed)) setDimIntensity(parsed);
    }
  }, []);

  // 从 localStorage 加载"结果面板不透明度"滑块的记忆值（初始化时，只执行一次）
  useEffect(() => {
    const saved = localStorage.getItem(RESULT_PANEL_OPACITY_KEY);
    if (saved !== null) {
      const parsed = parseFloat(saved);
      if (!Number.isNaN(parsed)) setResultPanelOpacity(parsed);
    }
  }, []);

  // 从 localStorage 加载两种主屏幕整体缩放；连接房间后会自动发布给主屏幕。
  useEffect(() => {
    const savedCharacterScale = parseFloat(localStorage.getItem(CHARACTER_SCALE_KEY) || '');
    const savedDiceScale = parseFloat(localStorage.getItem(DICE_DISPLAY_SCALE_KEY) || '');
    const savedRoomInfoScale = parseFloat(localStorage.getItem(ROOM_INFO_SCALE_KEY) || '');
    const savedHistoryScale = parseFloat(localStorage.getItem(DICE_HISTORY_SCALE_KEY) || '');
    if (!Number.isNaN(savedCharacterScale)) setCharacterScale(savedCharacterScale);
    if (!Number.isNaN(savedDiceScale)) setDiceDisplayScale(savedDiceScale);
    if (!Number.isNaN(savedRoomInfoScale)) setRoomInfoScale(savedRoomInfoScale);
    if (!Number.isNaN(savedHistoryScale)) setDiceHistoryScale(savedHistoryScale);
  }, []);

  // 扫描主屏幕二维码后，URL会带入房间号：自动连接，无须再手动输入。
  useEffect(() => {
    const roomFromQuery = new URLSearchParams(window.location.search).get('room');
    if (roomFromQuery && /^\d{6}$/.test(roomFromQuery)) {
      setInputRoomId(roomFromQuery);
      setRoomId(roomFromQuery);
      setIsConnected(true);
      setDisplayConnected(true);
    }
  }, []);

  // 切换/连接房间时，读取这台遥控器在该房间保存的历史；房间之间互不混用。
  useEffect(() => {
    setDiceHistory(loadDiceHistory(roomId));
  }, [roomId]);

  // WebSocket地址：优先用环境变量，否则自动跟随当前访问的主机名（局域网/公网设备都能连上同一台服务器）
  const wsUrl = (isConnected && roomId) ? getWsUrl() : null;
  
  const { isConnected: wsConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (message.type === 'ROOM_STATE') {
        const roomData = message.payload;
        
        // 接收房间战斗角色，与本地备选池合并
        setCharacters(prev => {
          // 保留本地备选池（从localStorage）
          const myReserve = prev.filter(c => !c.inCombat);
          
          // 房间里所有战斗角色
          const allCombat = (roomData.characters || []).map((c: Character) => ({
            ...c,
            inCombat: true,
          }));
          
          return [...myReserve, ...allCombat];
        });
        
        setCurrentTurn(roomData.currentTurn || 0);
        setRoundNumber(roomData.roundNumber || 1);
        if (Array.isArray(roomData.diceHistory)) {
          setDiceHistory(roomData.diceHistory);
          if (roomId) saveDiceHistory(roomId, roomData.diceHistory);
        }
        if (typeof roomData.characterScale === 'number') setCharacterScale(roomData.characterScale);
        if (typeof roomData.diceDisplayScale === 'number') setDiceDisplayScale(roomData.diceDisplayScale);
        if (typeof roomData.roomInfoScale === 'number') setRoomInfoScale(roomData.roomInfoScale);
        if (typeof roomData.diceHistoryScale === 'number') setDiceHistoryScale(roomData.diceHistoryScale);
        if (typeof roomData.displayRoomInfoVisible === 'boolean') setDisplayRoomInfoVisible(roomData.displayRoomInfoVisible);
        if (typeof roomData.displayDiceHistoryVisible === 'boolean') setDisplayDiceHistoryVisible(roomData.displayDiceHistoryVisible);
        if (typeof roomData.displayRoundVisible === 'boolean') setDisplayRoundVisible(roomData.displayRoundVisible);
        if (typeof roomData.displayConnected === 'boolean') {
          setDisplayConnected(roomData.displayConnected);
        }
      } else if (message.type === 'DISPLAY_STATUS') {
        // 主屏幕连接状态变化通知
        setDisplayConnected(message.payload.connected);
      } else if (message.type === 'DICE_ROLL') {
        // 房间内任何客户端（可能是自己，也可能是别的遥控器）发起了一次掷骰，
        // 进入"投掷中"状态等待主屏幕算完动画返回结果。新一轮投掷，"已用过重投机会"记录清空重来。
        // recipe直接从广播payload里取(不管这次投掷是不是自己发起的)，保证即使是别的遥控器发起的
        // 带kh/kl的投掷，自己这边后续重投时也能正确重新计算明细，不会因为"不是自己发起的"而缺失配方。
        setDiceRolling(true);
        lastRollIdRef.current = message.payload.id;
        setDiceResult(null);
        setRerolledDieIds(new Set());
        setSelectedRerollDieIds(new Set());
        setPendingRerollDieIds(new Set());
        pendingRecipeRef.current = message.payload.recipe || null;
        currentRollHistoryRef.current = {
          id: message.payload.id,
          label: message.payload.label || '自定义掷骰',
          expression: message.payload.expression || message.payload.notation,
          result: null,
          finalTotal: null,
          recordedAt: new Date().toISOString(),
          rerolls: [],
        };
      } else if (message.type === 'DICE_ROLL_RESULT') {
        // 主屏幕播放完3D动画后广播回来的结构化结果：每组小计 + 总和
        setDiceRolling(false);
        setDiceResult(message.payload.result);
        // 如果这次投掷是"自定义表达式"发起的(带kh/kl等)，用原始点数(sets[].rolls)按配方重新计算，
        // 算出哪些骰子被丢弃、真正的最终总和——引擎自己给的result.total是"全部加总"，不认识kh/kl。
        let finalTotal = message.payload.result.total;
        if (pendingRecipeRef.current) {
          const sets = (message.payload.result.sets || []) as { sides: number; rolls?: { value: number; id: number }[] }[];
          const engineSets = sets.map((s) => ({ sides: s.sides, rolls: s.rolls || [] }));
          const evaluated = evaluateRecipe(pendingRecipeRef.current, engineSets);
          setCustomEvalResult(evaluated);
          finalTotal = evaluated.total;
          // 注意：这里不清空pendingRecipeRef——这份配方要留到这一轮投掷结束(DICE_ROLL_DISMISS)
          // 或下一轮投掷开始(DICE_ROLL)才清空，因为后续单颗骰子重投(DICE_DIE_REROLL_RESULT)
          // 还需要用它重新计算kh/kl明细，不能在第一次用完就丢掉。
        } else {
          setCustomEvalResult(null);
        }
        const hist = currentRollHistoryRef.current;
        if (hist && hist.id === message.payload.id) {
          hist.result = message.payload.result;
          hist.finalTotal = finalTotal;
          upsertDiceHistory();
        }
      } else if (message.type === 'DICE_DIE_REROLL_RESULT') {
        // 某台遥控器请求的重投，主屏幕已经算完新结果广播回来：所有客户端(包括发起重投的那台自己)
        // 都据此同步刷新——不管这次重投是不是自己发起的，都完全信任这份广播数据，不做本地乐观更新。
        setDiceResult(message.payload.result);
        setRerolledDieIds(new Set(message.payload.rerolledDieIds || []));
        setSelectedRerollDieIds(new Set());
        setPendingRerollDieIds(new Set());
        // 带kh/kl配方的投掷，重投后主屏幕已经用最新点数重新算过明细，这里同样重算一遍保持展示一致
        let finalTotal = message.payload.result.total;
        if (pendingRecipeRef.current) {
          const sets = (message.payload.result.sets || []) as { sides: number; rolls?: { value: number; id: number }[] }[];
          const engineSets = sets.map((s) => ({ sides: s.sides, rolls: s.rolls || [] }));
          const evaluated = evaluateRecipe(pendingRecipeRef.current, engineSets);
          setCustomEvalResult(evaluated);
          finalTotal = evaluated.total;
        }
        const hist2 = currentRollHistoryRef.current;
        if (hist2 && hist2.id === message.payload.id) {
          hist2.result = message.payload.result;
          hist2.finalTotal = finalTotal;
          hist2.rerolls = message.payload.rerolls || [];
          upsertDiceHistory();
        }
      } else if (message.type === 'DICE_ROLL_DISMISS') {
        // 只响应当前这一轮的收起消息，避免旧的网络消息清掉后来新掷出的结果。
        if (message.payload.id !== lastRollIdRef.current) return;
        setDiceRolling(false);
        setDiceResult(null);
        setCustomEvalResult(null);
        setRerolledDieIds(new Set());
        setSelectedRerollDieIds(new Set());
        setPendingRerollDieIds(new Set());
        currentRollHistoryRef.current = null;
      } else if (message.type === 'ERROR') {
        alert(message.payload.message);
        setIsConnected(false);
        setRoomId('');
      }
    },
    onOpen: () => {
      // 连接成功后加入房间
      if (roomId) {
        sendMessage({
          type: 'JOIN_ROOM',
          payload: { roomId },
        });
      }
    },
    onClose: () => {
      // WebSocket断开时：移除战斗角色，保留备选池
      console.log('⚠️ WebSocket连接关闭，移除战斗角色');
      setCharacters(prev => prev.filter(c => !c.inCombat));
    },
  });

  // 连接到房间
  const handleConnectRoom = useCallback(() => {
    if (inputRoomId.length === 6 && /^\d+$/.test(inputRoomId)) {
      setRoomId(inputRoomId);
      setIsConnected(true);
      setDisplayConnected(true);
      // WebSocket会在连接后自动验证房间是否存在
    } else {
      alert('请输入6位数字房间号');
    }
  }, [inputRoomId]);

  // 断开房间（移除战斗角色，保留备选池）
  const handleDisconnect = useCallback(() => {
    // 只移除战斗角色，备选池保持不变
    setCharacters(prev => prev.filter(c => !c.inCombat));
    
    setIsConnected(false);
    setRoomId('');
    setCurrentTurn(0);
    setRoundNumber(1);
    setDisplayConnected(true);
  }, []);

  // 更新房间数据（通过WebSocket）
  const updateRoom = useCallback((updates: Partial<RoomState>) => {
    if (!isConnected || !roomId) return;

    sendMessage({
      type: 'UPDATE_ROOM',
      payload: { roomId, updates },
    });
  }, [isConnected, roomId, sendMessage]);

  // 从localStorage加载掷骰预设 + 上次的自定义表达式文本（初始化时执行一次）
  useEffect(() => {
    setDicePresets(loadDicePresets());
    const savedAppearanceId = localStorage.getItem(DICE_APPEARANCE_KEY);
    if (savedAppearanceId) setAppearancePresetId(savedAppearanceId);
    setCustomAppearancePresets(loadCustomAppearancePresets());
    const savedExpr = localStorage.getItem(CUSTOM_EXPR_KEY);
    if (savedExpr) setCustomExprText(savedExpr);
  }, []);

  // 表达式文本变化就存本地，下次打开面板还在原来的输入
  useEffect(() => {
    localStorage.setItem(CUSTOM_EXPR_KEY, customExprText);
  }, [customExprText]);

  // 实时解析当前表达式文本：成功则得到表达式树+预览文案，失败则得到具体报错原因
  const customExprParse = useMemo(() => parseDiceExpression(customExprText), [customExprText]);

  // 将初次结果立即写入历史，并在每次重投结果回来后覆盖同一条记录；收起只负责关闭界面。
  const upsertDiceHistory = useCallback(() => {
    const current = currentRollHistoryRef.current;
    if (!roomId || !current || current.id !== lastRollIdRef.current || current.finalTotal === null || !current.result) return;
    const entry: DiceHistoryEntry = {
      id: current.id,
      recordedAt: current.recordedAt,
      label: current.label,
      expression: current.expression,
      finalTotal: current.finalTotal,
      rerolls: current.rerolls,
    };
    setDiceHistory((previous) => {
      const next = [entry, ...previous.filter((item) => item.id !== entry.id)].slice(0, 50);
      saveDiceHistory(roomId, next);
      return next;
    });
    sendMessage({ type: 'DICE_HISTORY_APPEND', payload: { roomId, entry } });
  }, [roomId, sendMessage]);

  // 发起一次掷骰：生成唯一ID，通过WebSocket广播给房间（主屏幕收到后播放3D动画，用当前选中的外观预设的按形状纹理）。
  // recipe可选：只有自定义表达式(带kh/kl)投掷才会传，随消息一起发给主屏幕，让主屏幕自己也能算出
  // 同样细致的kh/kl明细并高亮对应骰子，不需要主屏幕认识表达式语法。
  const rollNotation = useCallback((
    notation: string,
    recipe: FlattenedRecipe | undefined,
    historyMeta: { label: string; expression: string },
  ) => {
    if (!notation || !isConnected || !roomId) return;
    const preset = getAppearancePreset(appearancePresetId, customAppearancePresets);

    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    lastRollIdRef.current = id;
    setDiceRolling(true);
    setDiceResult(null);
    setCustomEvalResult(null);

    sendMessage({
      type: 'DICE_ROLL',
      payload: {
        roomId,
        id,
        notation,
        shapeTextures: preset.shapeTextures,
        recipe,
        label: historyMeta.label,
        expression: historyMeta.expression,
      },
    });
  }, [isConnected, roomId, sendMessage, appearancePresetId, customAppearancePresets]);

  // 掷一个预设：预设现在也是完整表达式(可能带kh/kl)，所以跟"自定义掷骰"走同一条路——
  // 解析成表达式树，拆成配方，记住配方等结果回来后重新计算展示+决定高亮哪些骰子。
  // 万一存量数据里有解析失败的坏预设(理论上保存时已经校验过，不会发生)，直接忽略这次点击。
  const handleRollPreset = useCallback((preset: DicePreset) => {
    const parsed = parseDiceExpression(preset.expr);
    if (!parsed.ok) return;
    const recipe = flattenToRecipe(parsed.node);
    pendingRecipeRef.current = recipe;
    rollNotation(toEngineNotation(parsed.node), recipe, { label: preset.name, expression: preset.expr });
  }, [rollNotation]);

  // 点击未使用机会的骰子时，只切换选择状态；用户可选多颗后再统一确认。
  const handleRequestReroll = useCallback((dieId: number) => {
    if (rerolledDieIds.has(dieId) || pendingRerollDieIds.has(dieId)) return;
    setSelectedRerollDieIds((previous) => {
      const next = new Set(previous);
      if (next.has(dieId)) next.delete(dieId);
      else next.add(dieId);
      return next;
    });
  }, [rerolledDieIds, pendingRerollDieIds]);

  const openRerollConfirm = useCallback(() => {
    if (!diceResult || selectedRerollDieIds.size === 0) return;
    const targets = diceResult.sets.flatMap((set) => (set.rolls || [])
      .filter((roll) => selectedRerollDieIds.has(roll.id))
      .map((roll) => ({ dieId: roll.id, sides: set.sides, value: roll.value })));
    if (targets.length) setRerollConfirmTargets(targets);
  }, [diceResult, selectedRerollDieIds]);

  // 确认后把本次选中的所有骰子作为一个原子请求发给主屏幕，保证它们同时播放重投动画。
  const confirmReroll = useCallback(() => {
    if (!rerollConfirmTargets || !isConnected || !roomId || !lastRollIdRef.current) {
      setRerollConfirmTargets(null);
      return;
    }
    const dieIds = rerollConfirmTargets.map((target) => target.dieId);
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setPendingRerollDieIds(new Set(dieIds));
    setSelectedRerollDieIds(new Set());
    sendMessage({
      type: 'DICE_DIE_REROLL',
      payload: { roomId, rollId: lastRollIdRef.current, requestId, dieIds },
    });
    setRerollConfirmTargets(null);
  }, [rerollConfirmTargets, isConnected, roomId, sendMessage]);

  // 掷"自定义掷骰"标签页里当前输入框解析出的表达式：拆成配方(骰子分组+kh/kl+符号，不含语法树)，
  // 记住这次投掷对应的配方，等结果回来后据此重新计算展示；配方也随DICE_ROLL一起发给主屏幕，
  // 让主屏幕自己也能算出同样的明细，进而知道该给哪几颗骰子加发光描边。
  // 真正发给引擎摇的是"摊平后不含kh/kl"的普通NdS表达式。
  const handleRollCustomExpression = useCallback((node: ExprNode) => {
    const recipe = flattenToRecipe(node);
    pendingRecipeRef.current = recipe;
    rollNotation(toEngineNotation(node), recipe, {
      label: '自定义掷骰',
      expression: customExprText.trim(),
    });
  }, [rollNotation, customExprText]);

  // 选中一个外观预设（内置或自定义）：立即生效并记住在本地
  const handleSelectAppearancePreset = useCallback((id: string) => {
    setAppearancePresetId(id);
    localStorage.setItem(DICE_APPEARANCE_KEY, id);
  }, []);

  // 开始新建一个自定义外观预设：6种形状默认都是"纯白无纹理"，等用户逐个指定
  const handleStartNewAppearance = useCallback(() => {
    if (customAppearancePresets.length >= MAX_CUSTOM_APPEARANCE_PRESETS) return;
    setEditingAppearanceId('__new__');
    setEditingAppearanceName('');
    setEditingAppearanceTextures({});
  }, [customAppearancePresets.length]);

  // 开始编辑一个已有的自定义外观预设（内置预设不可编辑，只能新建时参考它的配置手动重现）
  const handleStartEditAppearance = useCallback((preset: DiceAppearancePreset) => {
    setEditingAppearanceId(preset.id);
    setEditingAppearanceName(preset.name);
    setEditingAppearanceTextures({ ...preset.shapeTextures });
  }, []);

  // 保存正在编辑/新建的外观预设：保存后立刻把它设为当前生效的预设，
  // 不然用户编辑完还得自己切到"使用预设"标签页手动点一下才算数，体验上像是"没应用上"。
  const handleSaveAppearance = useCallback(() => {
    const name = editingAppearanceName.trim() || '未命名样式';
    const isNew = editingAppearanceId === '__new__';
    const savedId = isNew ? genAppearancePresetId() : (editingAppearanceId as string);

    setCustomAppearancePresets((prev) => {
      let next: DiceAppearancePreset[];
      if (isNew) {
        next = [...prev, { id: savedId, name, shapeTextures: editingAppearanceTextures }];
      } else {
        next = prev.map((p) => (p.id === editingAppearanceId ? { ...p, name, shapeTextures: editingAppearanceTextures } : p));
      }
      saveCustomAppearancePresets(next);
      return next;
    });
    setEditingAppearanceId(null);
    handleSelectAppearancePreset(savedId);
  }, [editingAppearanceId, editingAppearanceName, editingAppearanceTextures, handleSelectAppearancePreset]);

  // 删除一个自定义外观预设；如果删的正好是当前选中的预设，退回内置默认预设
  const handleDeleteAppearance = useCallback((id: string) => {
    setCustomAppearancePresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveCustomAppearancePresets(next);
      return next;
    });
    if (editingAppearanceId === id) setEditingAppearanceId(null);
    if (appearancePresetId === id) handleSelectAppearancePreset(DEFAULT_APPEARANCE_PRESET_ID);
  }, [editingAppearanceId, appearancePresetId, handleSelectAppearancePreset]);

  // 开始新建一个预设：默认名字留空、表达式默认1d20当起点，减少空白感
  const handleStartNewPreset = useCallback(() => {
    if (dicePresets.length >= MAX_PRESETS) return;
    setEditingPresetId('__new__');
    setEditingPresetName('');
    setEditingPresetExpr('1d20');
  }, [dicePresets.length]);

  // 开始编辑一个已有预设
  const handleStartEditPreset = useCallback((preset: DicePreset) => {
    setEditingPresetId(preset.id);
    setEditingPresetName(preset.name);
    setEditingPresetExpr(preset.expr);
  }, []);

  // 保存正在编辑/新建的预设：表达式必须先解析通过才能保存(编辑器里保存按钮本身也禁用了非法状态)
  const handleSavePreset = useCallback(() => {
    const parsed = parseDiceExpression(editingPresetExpr);
    if (!parsed.ok) return;
    const name = editingPresetName.trim() || describeExpression(parsed.node).toUpperCase() || '未命名';
    const expr = editingPresetExpr.trim();

    setDicePresets((prev) => {
      let next: DicePreset[];
      if (editingPresetId === '__new__') {
        next = [...prev, { id: genPresetId(), name, expr }];
      } else {
        next = prev.map((p) => (p.id === editingPresetId ? { ...p, name, expr } : p));
      }
      saveDicePresets(next);
      return next;
    });
    setEditingPresetId(null);
  }, [editingPresetId, editingPresetName, editingPresetExpr]);

  // 删除一个预设
  const handleDeletePreset = useCallback((id: string) => {
    setDicePresets((prev) => {
      const next = prev.filter((p) => p.id !== id);
      saveDicePresets(next);
      return next;
    });
    if (editingPresetId === id) setEditingPresetId(null);
  }, [editingPresetId]);

  // 滑块拖动：更新压暗强度，写入localStorage记住位置，并同步给主屏幕实时生效
  const handleDimIntensityChange = useCallback((value: number) => {
    setDimIntensity(value);
    localStorage.setItem(DIM_INTENSITY_KEY, String(value));
    updateRoom({ dimIntensity: value });
  }, [updateRoom]);

  // 滑块拖动：更新结果面板不透明度，写入localStorage记住位置，并同步给主屏幕实时生效
  const handleResultPanelOpacityChange = useCallback((value: number) => {
    setResultPanelOpacity(value);
    localStorage.setItem(RESULT_PANEL_OPACITY_KEY, String(value));
    updateRoom({ resultPanelOpacity: value });
  }, [updateRoom]);

  const handleCharacterScaleChange = useCallback((value: number) => {
    setCharacterScale(value);
    localStorage.setItem(CHARACTER_SCALE_KEY, String(value));
    updateRoom({ characterScale: value });
  }, [updateRoom]);

  const handleDiceDisplayScaleChange = useCallback((value: number) => {
    setDiceDisplayScale(value);
    localStorage.setItem(DICE_DISPLAY_SCALE_KEY, String(value));
    updateRoom({ diceDisplayScale: value });
  }, [updateRoom]);

  const handleRoomInfoScaleChange = useCallback((value: number) => {
    setRoomInfoScale(value);
    localStorage.setItem(ROOM_INFO_SCALE_KEY, String(value));
    updateRoom({ roomInfoScale: value });
  }, [updateRoom]);

  const handleDiceHistoryScaleChange = useCallback((value: number) => {
    setDiceHistoryScale(value);
    localStorage.setItem(DICE_HISTORY_SCALE_KEY, String(value));
    updateRoom({ diceHistoryScale: value });
  }, [updateRoom]);

  const toggleDisplayRoomInfo = useCallback(() => {
    const next = !displayRoomInfoVisible;
    setDisplayRoomInfoVisible(next);
    updateRoom({ displayRoomInfoVisible: next });
  }, [displayRoomInfoVisible, updateRoom]);

  const toggleDisplayDiceHistory = useCallback(() => {
    const next = !displayDiceHistoryVisible;
    setDisplayDiceHistoryVisible(next);
    updateRoom({ displayDiceHistoryVisible: next });
  }, [displayDiceHistoryVisible, updateRoom]);

  const toggleDisplayRound = useCallback(() => {
    const next = !displayRoundVisible;
    setDisplayRoundVisible(next);
    updateRoom({ displayRoundVisible: next });
  }, [displayRoundVisible, updateRoom]);

  // 连接成功后（或重连后），把本地记住的压暗强度+结果面板不透明度推给房间，让主屏幕立即生效一次
  // （不依赖首次挂载时的连接状态，wsConnected变为true时才有意义推送）
  useEffect(() => {
    if (wsConnected && isConnected && roomId) {
      updateRoom({ dimIntensity, resultPanelOpacity, characterScale, diceDisplayScale, roomInfoScale, diceHistoryScale });
    }
    // 只在"刚连上"这一刻推送一次，两个值变化已经由各自的handle...Change自己同步，这里不需要重复依赖它们
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsConnected, isConnected, roomId]);

  // 保存备选池到 localStorage（只保存非战斗角色）
  // 跳过首次执行，避免用挂载时的旧值把刚从localStorage读出来的备选池覆盖掉（见上方isFirstSaveRef注释）
  useEffect(() => {
    if (isFirstSaveRef.current) {
      isFirstSaveRef.current = false;
      return;
    }
    const reservePool = characters.filter(c => !c.inCombat);
    localStorage.setItem('dnd-initiative-reserve-pool', JSON.stringify(reservePool));
  }, [characters]);

  // 添加角色
  const handleAddCharacter = useCallback(() => {
    if (!newCharName.trim()) return;
    
    let imageUrl = '';
    if (addingType === 'player') {
      // 玩家：尝试使用种族+职业图片，失败则用其他图片
      imageUrl = `/image/player/${selectedRace.name}_${selectedRace.en}/${selectedClass}.png`;
    } else if (addingType === 'enemy' && selectedEnemy) {
      // 敌人：使用选中的敌人图片
      imageUrl = getEnemyImageUrl(selectedEnemy, enemyList);
    } else if (addingType === 'npc') {
      // NPC：使用选中的图片
      if (npcImageType === 'player') {
        imageUrl = `/image/player/${npcSelectedRace.name}_${npcSelectedRace.en}/${npcSelectedClass}.png`;
      } else if (selectedNpcImage) {
        imageUrl = getEnemyImageUrl(selectedNpcImage, enemyList);
      }
    } else if (addingType === 'custom' && selectedCustomMedia) {
      // 自定义生物：使用从统一图片库选中的图片（怪物图或玩家立绘）
      imageUrl = selectedCustomMedia.url;
    }
    // 自定义生物类型（无论最终阵营是什么）都用 customCampType 决定实际存储的 type 字段
    const finalType = addingType === 'custom' ? customCampType : addingType;
    
    const newChar: Character = {
      id: Date.now().toString(),
      name: newCharName.trim(),
      initiative: 15,
      // 没选图片时，自定义生物用文字当"图片"（走token渲染路径，走了长文字自适应字号逻辑）；
      // 其他类型没图片时兜底用原有的随机emoji token
      token: addingType === 'custom' && !imageUrl
        ? (customTextToken.trim() || newCharName.trim())
        : newCharToken,
      imageUrl: imageUrl || undefined,
      type: finalType,
      color: TYPE_COLORS[finalType],
      // 自定义生物才允许自选边框色；其他类型保持未设置，走阵营默认色
      borderColor: addingType === 'custom' ? customBorderColor : undefined,
      inCombat: false,
    };
    
    setCharacters(prev => [...prev, newChar]);
    
    setNewCharName('');
    setNewCharImageUrl('');
    setEnemySearch('');
    setSelectedEnemy('');
    setNpcSearch('');
    setSelectedNpcImage('');
    setCustomSearch('');
    setSelectedCustomMedia(null);
    setCustomTextToken('');
    setCustomBorderColor(BORDER_COLOR_PRESETS[0].value);
    setIsAddingCharacter(false);
  }, [newCharName, newCharToken, addingType, selectedRace, selectedClass, selectedEnemy, npcImageType, npcSelectedRace, npcSelectedClass, selectedNpcImage, enemyList, selectedCustomMedia, customCampType, customTextToken, customBorderColor]);

  // 获取当前种族可用的图片列表
  const getAvailableRaceImages = useCallback((race: typeof RACES[0]) => {
    const available = ['其他1.png', '其他2.png'];
    CLASSES.forEach(cls => {
      available.push(`${cls}.png`);
    });
    return available;
  }, []);

  // 获取预览图片URL
  const getPreviewImage = useCallback(() => {
    if (addingType === 'player') {
      // 优先使用种族+职业组合
      const primaryImage = `/image/player/${selectedRace.name}_${selectedRace.en}/${selectedClass}.png`;
      return primaryImage;
    } else if (addingType === 'enemy' && selectedEnemy) {
      return getEnemyImageUrl(selectedEnemy, enemyList);
    } else if (addingType === 'npc') {
      if (npcImageType === 'player') {
        return `/image/player/${npcSelectedRace.name}_${npcSelectedRace.en}/${npcSelectedClass}.png`;
      } else if (selectedNpcImage) {
        return getEnemyImageUrl(selectedNpcImage, enemyList);
      }
    }
    return '';
  }, [addingType, selectedRace, selectedClass, selectedEnemy, npcImageType, npcSelectedRace, npcSelectedClass, selectedNpcImage, enemyList]);

  // 切换到种族的其他图片
  const switchToRaceAlternative = useCallback(() => {
    const alternatives = [`其他1.png`, `其他2.png`];
    const randomClass = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    alternatives.push(`${randomClass}.png`);
    
    setRaceImageIndex((prev) => (prev + 1) % alternatives.length);
  }, []);

  // 过滤敌人列表（按中文名或英文key搜索）
  const filteredEnemies = useMemo(() => filterEnemies(enemyList, enemySearch), [enemyList, enemySearch]);

  // 过滤NPC敌人列表
  const filteredNpcEnemies = useMemo(() => filterEnemies(enemyList, npcSearch), [enemyList, npcSearch]);

  // 过滤自定义生物的统一图片库（怪物图+玩家立绘一起搜）
  const filteredCustomMedia = useMemo(() => filterMediaLibrary(mediaLibrary, customSearch), [mediaLibrary, customSearch]);

  // 快速添加
  const handleQuickAdd = useCallback((type: 'player' | 'enemy' | 'npc') => {
    const count = characters.filter(c => c.type === type).length;
    const names = { player: '玩家', enemy: '敌人', npc: 'NPC' };
    const newChar: Character = {
      id: Date.now().toString(),
      name: `${names[type]} ${count + 1}`,
      initiative: Math.floor(Math.random() * 20) + 1,
      token: TOKEN_PRESETS[type][Math.floor(Math.random() * TOKEN_PRESETS[type].length)],
      type,
      color: TYPE_COLORS[type],
      inCombat: false,
    };
    setCharacters(prev => [...prev, newChar]);
  }, [characters]);

  // 删除战斗区角色：先弹出自定义确认弹窗（见 removeTarget state），确认后才真正执行删除
  const handleRemoveCombatCharacter = useCallback((charId: string, charName: string) => {
    setRemoveTarget({ id: charId, name: charName });
  }, []);

  // 真正执行移出战斗区（点击自定义确认弹窗的"确认移出"按钮后调用）
  const confirmRemoveCombatCharacter = useCallback(() => {
    if (!removeTarget) return;
    const charId = removeTarget.id;

    setCharacters(prev => {
      const newChars = prev.filter(c => c.id !== charId);
      
      // 同步到房间
      if (isConnected && roomId) {
        const combatChars = newChars.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      
      return newChars;
    });

    setRemoveTarget(null);
  }, [removeTarget, isConnected, roomId, updateRoom]);

  // 删除角色
  const handleRemoveCharacter = useCallback((id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
    setCurrentTurn(0);
  }, []);

  // 打开某个战斗区角色的状态管理弹窗
  const handleOpenStatusModal = useCallback((charId: string) => {
    setPendingStatusId('bless');
    setPendingDuration(3);
    setStatusModalCharId(charId);
  }, []);

  // 通用：用一个"根据旧statuses算出新statuses"的函数去更新某个角色，并同步到房间
  const applyStatusUpdate = useCallback((charId: string, updater: (statuses: CharacterStatusInstance[]) => CharacterStatusInstance[]) => {
    setCharacters(prev => {
      const next = prev.map(c => c.id === charId ? { ...c, statuses: updater(c.statuses || []) } : c);
      if (isConnected && roomId) {
        const combatChars = next.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      return next;
    });
  }, [isConnected, roomId, updateRoom]);

  // 添加一条buff/debuff（力竭/濒死走各自专门的按钮，不走这个通用添加）
  const handleAddStatus = useCallback((charId: string, statusId: StatusId, duration: number | null) => {
    applyStatusUpdate(charId, (statuses) => addStatus(statuses, statusId, duration));
  }, [applyStatusUpdate]);

  // 移除一条状态实例
  const handleRemoveStatus = useCallback((charId: string, instanceId: string) => {
    applyStatusUpdate(charId, (statuses) => removeStatusInstance(statuses, instanceId));
  }, [applyStatusUpdate]);

  // 调整力竭等级：达到6级视为死亡，直接把角色从战斗区移除（不弹确认，规则上是即时死亡）
  const handleSetExhaustionLevel = useCallback((charId: string, level: number) => {
    setCharacters(prev => {
      const target = prev.find(c => c.id === charId);
      if (!target) return prev;
      const { statuses, died } = setExhaustionLevel(target.statuses || [], level);
      const next = died
        ? prev.filter(c => c.id !== charId)
        : prev.map(c => c.id === charId ? { ...c, statuses } : c);
      if (isConnected && roomId) {
        const combatChars = next.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      if (died) setStatusModalCharId(null);
      return next;
    });
  }, [isConnected, roomId, updateRoom]);

  // 记录一次死亡豁免（濒死状态专用）：3次成功稳定脱离濒死，3次失败彻底死亡（从战斗区移除）
  const handleDeathSave = useCallback((charId: string, success: boolean) => {
    setCharacters(prev => {
      const target = prev.find(c => c.id === charId);
      if (!target) return prev;
      const { statuses, died } = recordDeathSave(target.statuses || [], success);
      const next = died
        ? prev.filter(c => c.id !== charId)
        : prev.map(c => c.id === charId ? { ...c, statuses } : c);
      if (isConnected && roomId) {
        const combatChars = next.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      if (died) setStatusModalCharId(null);
      return next;
    });
  }, [isConnected, roomId, updateRoom]);

  // 下一个
  const handleNextTurn = useCallback(() => {
    const combatChars = characters.filter(c => c.inCombat).sort((a, b) => b.initiative - a.initiative);
    if (combatChars.length > 0) {
      const currentIndex = currentTurn;
      const nextIndex = (currentIndex + 1) % combatChars.length;
      const newCurrentChar = combatChars[nextIndex];
      
      if (currentIndex === combatChars.length - 1 && nextIndex === 0) {
        const newRound = roundNumber + 1;
        setRoundNumber(newRound);
        setCurrentTurn(nextIndex);

        // 轮到新的当前回合角色：其限时状态（buff/debuff）回合数-1，减到0自动清除
        setCharacters(prev => {
          const next = prev.map(c => c.id === newCurrentChar.id
            ? { ...c, statuses: tickStatusesForTurnStart(c.statuses || []) }
            : c);
          if (isConnected && roomId) {
            updateRoom({
              roundNumber: newRound,
              currentTurn: nextIndex,
              characters: next.filter(c => c.inCombat),
            });
          } else {
            updateRoom({ roundNumber: newRound, currentTurn: nextIndex });
          }
          return next;
        });
      } else {
        setCurrentTurn(nextIndex);

        setCharacters(prev => {
          const next = prev.map(c => c.id === newCurrentChar.id
            ? { ...c, statuses: tickStatusesForTurnStart(c.statuses || []) }
            : c);
          if (isConnected && roomId) {
            updateRoom({
              currentTurn: nextIndex,
              characters: next.filter(c => c.inCombat),
            });
          } else {
            updateRoom({ currentTurn: nextIndex });
          }
          return next;
        });
      }
    }
  }, [characters, currentTurn, roundNumber, updateRoom, isConnected, roomId]);

  // 上一个
  const handlePrevTurn = useCallback(() => {
    const combatChars = characters.filter(c => c.inCombat).sort((a, b) => b.initiative - a.initiative);
    if (combatChars.length > 0) {
      const currentIndex = currentTurn;
      const prevIndex = (currentIndex - 1 + combatChars.length) % combatChars.length;
      
      if (currentIndex === 0 && prevIndex === combatChars.length - 1) {
        const newRound = Math.max(1, roundNumber - 1);
        setRoundNumber(newRound);
        setCurrentTurn(prevIndex);
        
        // 同步到房间
        updateRoom({
          roundNumber: newRound,
          currentTurn: prevIndex,
        });
      } else {
        setCurrentTurn(prevIndex);
        
        // 同步到房间
        updateRoom({
          currentTurn: prevIndex,
        });
      }
    }
  }, [characters, currentTurn, roundNumber, updateRoom]);

  // 重置战斗区（将所有角色移回备选区）
  const handleResetCombat = useCallback(() => {
    if (confirm('确定要将所有角色移出战斗区吗？')) {
      setCharacters(prev => prev.map(c => ({ ...c, inCombat: false })));
      setCurrentTurn(0);
    }
  }, []);

  // 完全重置
  const handleReset = useCallback(() => {
    if (confirm('确定要完全重置吗？这会删除所有角色。')) {
      setCharacters([]);
      setCurrentTurn(0);
      setRoundNumber(1);
      setIsCombatMode(false);
      localStorage.removeItem('dnd-initiative-tracker');
    }
  }, []);

  // 拖拽开始
  const handleDragStart = (char: Character) => {
    setDraggedChar(char);
  };

  // 核心放置逻辑：从鼠标/触摸坐标计算先攻值并放入战斗区，供拖拽和触摸两种输入共用
  const processDrop = (clientX: number) => {
    if (!draggedChar || !combatZoneRef.current) return;

    const zone = combatZoneRef.current.getBoundingClientRect();
    const x = clientX - zone.left - 32;
    const percentage = Math.max(0, Math.min(1, x / (zone.width - 64)));
    let newInit = Math.round((1 - percentage) * 30);

    newInit = Math.round(newInit);

    // 复制模式：如果从备选区拖拽，创建新的副本
    let updatedChar: Character;
    if (!draggedChar.inCombat) {
      // 从备选区拖拽：创建战斗角色副本，生成新的combatId
      const combatId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      updatedChar = {
        ...draggedChar,
        id: combatId, // 新的唯一ID
        initiative: newInit,
        inCombat: true,
      };
    } else {
      // 从战斗区拖拽：只更新先攻值
      updatedChar = { ...draggedChar, initiative: newInit, inCombat: true };
    }

    // 检查是否有重叠
    const charsAtSameInit = characters.filter(
      c => c.inCombat && c.id !== updatedChar.id && c.initiative === newInit
    );

    if (charsAtSameInit.length > 0) {
      const allOverlap = [...charsAtSameInit, updatedChar];
      setOverlapCharacters(allOverlap);
      setSortedOverlapChars(allOverlap); // 初始化排序列表
      setShowOverlapModal(true);

      if (!draggedChar.inCombat) {
        // 从备选区：添加新副本
        setCharacters(prev => [...prev, updatedChar]);
      } else {
        // 从战斗区：更新现有角色
        setCharacters(prev => prev.map(c => c.id === draggedChar.id ? updatedChar : c));
      }
    } else {
      setCharacters(prev => {
        let newChars: Character[];
        if (!draggedChar.inCombat) {
          // 从备选区：添加新副本（不删除原角色）
          newChars = [...prev, updatedChar];
        } else {
          // 从战斗区：更新现有角色
          newChars = prev.map(c => c.id === draggedChar.id ? updatedChar : c);
        }

        // 同步到房间（通过WebSocket）
        if (isConnected && roomId) {
          // 准备要发送的角色列表（只包含战斗中的角色）
          const combatChars = newChars.filter(c => c.inCombat);
          updateRoom({ characters: combatChars });
        }

        return newChars;
      });
    }

    setDraggedChar(null);
    setDragPreviewInit(null);
  };

  // 拖拽到战斗区（复制模式：从备选池拖拽时不删除原角色）
  const handleDropToCombat = (e: React.DragEvent) => {
    e.preventDefault();
    processDrop(e.clientX);
  };

  // 拖拽到备选区（禁用：战斗区角色改用删除按钮）
  const handleDropToReserve = (e: React.DragEvent) => {
    e.preventDefault();
    // 不再允许拖回备选区
    return;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // 实时显示先攻值预览
    if (draggedChar && combatZoneRef.current && e.currentTarget === combatZoneRef.current) {
      const zone = combatZoneRef.current.getBoundingClientRect();
      const x = e.clientX - zone.left - 32;
      const percentage = Math.max(0, Math.min(1, x / (zone.width - 64)));
      const previewInit = Math.round((1 - percentage) * 30);
      setDragPreviewInit(previewInit);
    }
  };

  // ===== 手机端触摸拖拽：HTML5 Drag API 在移动端不工作，用 touch 事件做等效实现 =====

  // 触摸开始（在卡片上触发）：标记当前拖拽的角色
  const handleCardTouchStart = (char: Character, e: React.TouchEvent) => {
    e.stopPropagation();
    setDraggedChar(char);
  };

  // 触摸移动（在战斗区容器上触发）：实时计算先攻值预览
  const handleCombatZoneTouchMove = (e: React.TouchEvent) => {
    if (!draggedChar || !combatZoneRef.current) return;
    e.preventDefault(); // 阻止页面跟随手指滚动

    const touch = e.touches[0];
    const zone = combatZoneRef.current.getBoundingClientRect();
    const x = touch.clientX - zone.left - 32;
    const percentage = Math.max(0, Math.min(1, x / (zone.width - 64)));
    const previewInit = Math.round((1 - percentage) * 30);
    setDragPreviewInit(previewInit);
  };

  // 触摸结束（在战斗区容器上触发）：执行放置
  const handleCombatZoneTouchEnd = (e: React.TouchEvent) => {
    if (!draggedChar) {
      setDraggedChar(null);
      setDragPreviewInit(null);
      return;
    }
    const touch = e.changedTouches[0];
    processDrop(touch.clientX);
  };

  const combatCharacters = characters.filter(c => c.inCombat).sort((a, b) => b.initiative - a.initiative);
  const reserveCharacters = characters.filter(c => !c.inCombat);

  return (
    <div className="min-h-screen rc-chassis flex flex-col items-center py-6 px-3 sm:px-6 pb-24">

      {/* ========== 共同信息面板：房间号 / 信号状态 / 断开连接，放在遥控器画面最上面，
          不属于任何一个CONSOLE，是跨越DICE CONSOLE和INITIATIVE CONSOLE的全局状态展示。 ========== */}
      {isConnected && roomId && (
        <div className="w-full max-w-5xl rc-screen rounded-xl px-4 sm:px-5 py-3 mb-3 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="rc-label">房间号</span>
              <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 tracking-wider">
                {roomId}
              </span>
            </div>

            {/* WebSocket连接状态指示灯 */}
            {!wsConnected && (
              <div className="flex items-center gap-2">
                <div className="rc-led bg-red-500 animate-pulse" />
                <span className="rc-label text-red-400">连接断开</span>
              </div>
            )}
            {wsConnected && !displayConnected && (
              <div className="flex items-center gap-2">
                <div className="rc-led bg-amber-500 animate-pulse" />
                <span className="rc-label text-amber-400">主屏幕掉线</span>
              </div>
            )}
            {wsConnected && displayConnected && (
              <div className="flex items-center gap-2">
                <div className="rc-led bg-emerald-500" />
                <span className="rc-label text-emerald-400">信号正常</span>
              </div>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            className="rc-btn px-3 py-1.5 rounded-lg font-bold text-xs text-red-400 bg-red-950/60"
          >
            断开连接
          </button>
        </div>
      )}

      {/* 主屏幕掉线警告横幅：跟共同信息面板放一起，同样是跨CONSOLE的全局状态 */}
      {isConnected && wsConnected && !displayConnected && (
        <div className="w-full max-w-5xl rc-screen rounded-xl px-4 py-2 mb-3 text-center border border-amber-600/30">
          <span className="text-amber-300 text-sm font-semibold">
            ⚠️ 主屏幕已断开连接，房间数据已保留，等待主屏幕重连中...
          </span>
        </div>
      )}

      {/* ========== 骰子sheet页：跟INITIATIVE CONSOLE是同级的两个独立页面，同一时刻只显示一个，
          用底部tab切换。不再是"按钮唤起弹窗"的交互，常用掷骰/自定义掷骰/骰子设置三个标签页的内容
          直接摊开展示，房间连上就能用（跟之前悬浮按钮的可用条件一致）。样式跟INITIATIVE CONSOLE统一：
          同样的四角螺丝钉 + 顶部品牌铭牌条(LED+标题+副标题+右侧散热孔装饰)。 ========== */}
      {isConnected && activeSheet === 'dice' && (
        <div className="w-full max-w-5xl rc-chassis-edge rounded-[28px] p-3 sm:p-5 relative mb-4">
          {/* 四角装饰螺丝钉 */}
          <div className="absolute top-4 left-4 rc-screw" />
          <div className="absolute top-4 right-4 rc-screw" />
          <div className="absolute bottom-4 left-4 rc-screw" />
          <div className="absolute bottom-4 right-4 rc-screw" />

          {/* 顶部品牌铭牌条 */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="rc-led bg-purple-400" style={{ boxShadow: '0 0 6px #a855f7' }} />
              <div>
                <div className="text-purple-100 font-black text-sm sm:text-base tracking-widest">
                  DICE CONSOLE
                </div>
                <div className="rc-label">骰子板块 · 常用 / 自定义 / 设置</div>
              </div>
            </div>
            <div className="h-4 w-20 sm:w-32 rc-vents rounded opacity-60" />
          </div>

          <div className="rc-screen rounded-2xl p-4 sm:p-5">

            {/* 投掷结果：不再用弹窗/悬浮横幅展示，直接摊在DICE CONSOLE面板里，投掷中/有结果时都显示在这里 */}
            {(diceRolling || diceResult) && (
              <div className="mb-4 rounded-xl bg-slate-950/60 border border-purple-500/30 p-3">
                {diceRolling ? (
                  <div className="text-center text-purple-300 font-bold py-2">🎲 骰子在主屏幕上滚动中...</div>
                ) : diceResult && customEvalResult ? (
                  <>
                    <div className="flex flex-wrap justify-center gap-2 mb-2">
                      {customEvalResult.groups.map((g, i) => (
                        <div key={i} className="w-full sm:w-auto min-w-0 px-3 py-1.5 rounded-lg bg-slate-800 border border-purple-500/30 text-center">
                          <div className="text-[10px] text-slate-400">
                            {i > 0 && (g.sign === -1 ? '− ' : '+ ')}
                            {g.count}D{g.sides}{g.keep ? `(${g.keep.mode}${g.keep.amount})` : ''}
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                            {g.rolls.map((r) => (
                              <DiceShapeIcon
                                key={r.id}
                                sides={g.sides}
                                value={r.value}
                                size={36}
                                state={
                                  pendingRerollDieIds.has(r.id) ? 'rerolling' :
                                  (r.discarded || rerolledDieIds.has(r.id)) ? 'used' :
                                  selectedRerollDieIds.has(r.id) ? 'selected' : 'idle'
                                }
                                onClick={() => handleRequestReroll(r.id)}
                              />
                            ))}
                          </div>
                          <div className="text-lg font-black text-purple-300">{g.sign === -1 ? '−' : ''}{g.total}</div>
                        </div>
                      ))}
                      {customEvalResult.modifier !== 0 && (
                        <div className="px-3 py-1.5 rounded-lg bg-slate-800 border border-purple-500/30 text-center self-center">
                          <div className="text-lg font-black text-purple-300">
                            {customEvalResult.modifier > 0 ? '+' : ''}{customEvalResult.modifier}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="text-center pt-2 border-t border-purple-500/20">
                      <span className="text-slate-400 text-sm mr-2">总和</span>
                      <span className="text-3xl font-black text-amber-400">{customEvalResult.total}</span>
                    </div>
                  </>
                ) : diceResult ? (
                  // 掷预设/常规组合(不涉及kh/kl)：每颗骰子换成形状图标，可点击(未重投过的)发起重投请求
                  <>
                    <div className="flex flex-wrap justify-center gap-2 mb-2">
                      {diceResult.sets.map((set, i) => (
                        <div key={i} className="w-full sm:w-auto min-w-0 px-3 py-1.5 rounded-lg bg-slate-800 border border-purple-500/30 text-center">
                          <div className="text-[10px] text-slate-400">{set.num}D{set.sides}</div>
                          <div className="flex flex-wrap items-center justify-center gap-1 mt-1">
                            {(set.rolls || []).map((r) => (
                              <DiceShapeIcon
                                key={r.id}
                                sides={set.sides}
                                value={r.value}
                                size={36}
                                state={
                                  pendingRerollDieIds.has(r.id) ? 'rerolling' :
                                  rerolledDieIds.has(r.id) ? 'used' :
                                  selectedRerollDieIds.has(r.id) ? 'selected' : 'idle'
                                }
                                onClick={() => handleRequestReroll(r.id)}
                              />
                            ))}
                          </div>
                          <div className="text-lg font-black text-purple-300 mt-1">{set.total}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-center pt-2 border-t border-purple-500/20">
                      <span className="text-slate-400 text-sm mr-2">总和</span>
                      <span className="text-3xl font-black text-amber-400">{diceResult.total}</span>
                    </div>
                  </>
                ) : null}
                {diceResult && selectedRerollDieIds.size > 0 && (
                  <button
                    onClick={openRerollConfirm}
                    className="w-full mt-3 px-3 py-2 rounded-lg text-sm font-black text-amber-100 border border-amber-400/50 bg-amber-500/15 hover:bg-amber-500/25 transition-colors"
                  >
                    重投已选 {selectedRerollDieIds.size} 颗骰子
                  </button>
                )}
                {diceResult && (
                  <button
                    onClick={() => {
                      currentRollHistoryRef.current = null;
                      setDiceResult(null);
                      setCustomEvalResult(null);
                      setRerolledDieIds(new Set());
                      setSelectedRerollDieIds(new Set());
                      setPendingRerollDieIds(new Set());
                      // 通知主屏幕（和其他遥控器）也立刻收起结果展示，不用等倒计时自然结束
                      if (isConnected && roomId) {
                        sendMessage({
                          type: 'DICE_ROLL_DISMISS',
                          payload: { roomId, id: lastRollIdRef.current },
                        });
                      }
                    }}
                    className="w-full mt-3 px-4 py-3 rounded-xl text-sm font-black text-slate-100 border border-slate-500/50 bg-slate-700 hover:bg-slate-600 shadow-lg transition-colors"
                  >
                    ▾ 收起骰盘与本次结果
                  </button>
                )}
              </div>
            )}

            {/* 历史掷骰：初次结果与重投后都会即时更新，最新一条在最上方。 */}
            <section className="mb-4 rounded-xl border border-slate-700/80 bg-slate-950/45 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setIsDiceHistoryExpanded((expanded) => !expanded)}
                  className="flex-1 flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-left hover:bg-slate-800/70 transition-colors"
                  aria-expanded={isDiceHistoryExpanded}
                >
                  <span>
                    <span className="rc-label block">历史掷骰</span>
                    <span className="text-[10px] text-slate-500">{diceHistory.length} 条已结算记录</span>
                  </span>
                  <span className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-bold text-purple-200">{isDiceHistoryExpanded ? '▴ 收起' : '▾ 展开'}</span>
                </button>
                {diceHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!roomId) return;
                      setDiceHistory([]);
                      saveDiceHistory(roomId, []);
                      sendMessage({ type: 'DICE_HISTORY_CLEAR', payload: { roomId } });
                    }}
                    className="text-[10px] font-bold text-slate-500 hover:text-red-300 transition-colors"
                  >
                    清空
                  </button>
                )}
              </div>
              {isDiceHistoryExpanded && (
                diceHistory.length === 0 ? (
                  <div className="border-t border-slate-700/70 px-3 py-4 text-center text-xs text-slate-500">暂无已收起的掷骰记录</div>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/90 border-t border-slate-700/70">
                    {diceHistory.map((entry) => (
                      <div key={entry.id} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-black text-purple-200 truncate">{entry.label}</div>
                            <div className="mt-0.5 font-mono text-xs text-slate-400 break-all">{entry.expression}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-lg leading-none font-black text-amber-400">{entry.finalTotal}</div>
                            <time className="text-[10px] text-slate-500">
                              {new Date(entry.recordedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
                            </time>
                          </div>
                        </div>
                        {entry.rerolls.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {entry.rerolls.map((reroll, index) => (
                              <span key={`${reroll.dieId}-${index}`} className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-mono text-amber-200">
                                重投 D{reroll.sides}：{reroll.from} → {reroll.to}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>

            {/* 标签切换：常用掷骰 / 自定义掷骰 / 骰子设置 */}
            <div className="flex gap-1 mb-4 p-1 rounded-lg bg-slate-800/60">
              <button
                onClick={() => setDiceModalTab('presets')}
                className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${
                  diceModalTab === 'presets' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                常用掷骰
              </button>
              <button
                onClick={() => setDiceModalTab('custom')}
                className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${
                  diceModalTab === 'custom' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                自定义掷骰
              </button>
              <button
                onClick={() => setDiceModalTab('settings')}
                className={`flex-1 py-2 rounded-md text-sm font-bold transition-colors ${
                  diceModalTab === 'settings' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                骰子设置
              </button>
            </div>

            {/* ===== 预设标签页：两栏网格展示，正在编辑的那一项单独占满整行(表单内容多，两栏挤不下) ===== */}
            {diceModalTab === 'presets' && (
              <div className="grid grid-cols-2 gap-2">
                {dicePresets.map((preset) => (
                  <div
                    key={preset.id}
                    className={`rounded-lg bg-slate-800/60 overflow-hidden ${editingPresetId === preset.id ? 'col-span-2' : ''}`}
                  >
                    {editingPresetId === preset.id ? (
                      <PresetEditor
                        name={editingPresetName}
                        expr={editingPresetExpr}
                        onNameChange={setEditingPresetName}
                        onExprChange={setEditingPresetExpr}
                        onSave={handleSavePreset}
                        onCancel={() => setEditingPresetId(null)}
                      />
                    ) : (
                      <div className="flex items-center gap-1.5 p-2.5">
                        <button
                          onClick={() => handleRollPreset(preset)}
                          disabled={diceRolling}
                          className="flex-1 min-w-0 text-left disabled:opacity-50"
                        >
                          <div className="text-sm font-bold text-white truncate">{preset.name}</div>
                          <div className="text-xs text-purple-400 font-mono mt-0.5 truncate">
                            {preset.expr.toUpperCase()}
                          </div>
                        </button>
                        {/* 修改/删除图标：跟名字同一行，靠右侧，缩小成小方块，不再单独占一整行 */}
                        <button
                          onClick={() => handleStartEditPreset(preset)}
                          className="w-6 h-6 flex-shrink-0 rounded-md bg-slate-700 hover:bg-slate-600 text-slate-300 text-[10px] transition-colors"
                          title="编辑"
                        >
                          ✎
                        </button>
                        <button
                          onClick={() => handleDeletePreset(preset.id)}
                          className="w-6 h-6 flex-shrink-0 rounded-md bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white text-[10px] transition-colors"
                          title="删除"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {editingPresetId === '__new__' && (
                  <div className="col-span-2 rounded-lg bg-slate-800/60 overflow-hidden">
                    <PresetEditor
                      name={editingPresetName}
                      expr={editingPresetExpr}
                      onNameChange={setEditingPresetName}
                      onExprChange={setEditingPresetExpr}
                      onSave={handleSavePreset}
                      onCancel={() => setEditingPresetId(null)}
                    />
                  </div>
                )}

                {editingPresetId === null && dicePresets.length < MAX_PRESETS && (
                  <button
                    onClick={handleStartNewPreset}
                    className="col-span-2 py-2.5 rounded-lg text-sm font-bold text-purple-300 bg-slate-800/40 hover:bg-slate-800 border border-dashed border-purple-500/30 transition-colors"
                  >
                    + 新建预设（{dicePresets.length}/{MAX_PRESETS}）
                  </button>
                )}
              </div>
            )}

            {/* ===== 自定义掷骰标签页：表达式输入框(可打字/可用按钮面板拼) + 实时校验预览 + 投掷 ===== */}
            {diceModalTab === 'custom' && (
              <div>
                {/* 表达式输入框：系统键盘直接打字，也可以配合下方按钮面板拼接，两者等价操作同一份文本 */}
                <input
                  type="text"
                  value={customExprText}
                  onChange={(e) => setCustomExprText(e.target.value)}
                  placeholder="例如：2d20kh1+1d4"
                  spellCheck={false}
                  className={`w-full px-3 py-2.5 rounded-lg bg-slate-950 border-2 text-white font-mono text-center text-lg tracking-wide focus:outline-none transition-colors ${
                    customExprParse.ok ? 'border-purple-500/40 focus:border-purple-500' : 'border-red-500/60 focus:border-red-500'
                  }`}
                />

                {/* 实时预览：解析成功显示可读展开式，失败显示具体错误原因（标红） */}
                <div className="text-center my-2 min-h-[1.5rem]">
                  {customExprParse.ok ? (
                    <span className="text-purple-300 font-mono text-sm">
                      {describeExpression(customExprParse.node).toUpperCase()}
                    </span>
                  ) : (
                    <span className="text-red-400 text-xs font-medium">⚠ {customExprParse.error}</span>
                  )}
                </div>

                {/* 拼字按钮面板：数字/骰子面数/kh·kl/加减括号/删除清空，点击即插入到上面的输入框 */}
                <div className="mb-3">
                  <ExpressionKeypad value={customExprText} onChange={setCustomExprText} />
                </div>

                <button
                  onClick={() => customExprParse.ok && handleRollCustomExpression(customExprParse.node)}
                  disabled={diceRolling || !customExprParse.ok}
                  className="w-full px-6 py-3 rounded-xl font-black shadow-lg hover:scale-[1.02] transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(135deg, #a855f7, #7e22ce)' }}
                >
                  投掷
                </button>
              </div>
            )}

            {/* ===== 骰子设置标签页：使用预设(从列表选) / 自定义骰子材质(新建改删预设)，二选一 ===== */}
            {diceModalTab === 'settings' && (
              <div>
                {/* 模式切换：radio二选一，未选中的那个模式标签变灰弱化，不隐藏 */}
                <div className="flex gap-4 mb-4 px-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="diceStyleMode"
                      checked={diceStyleMode === 'preset'}
                      onChange={() => setDiceStyleMode('preset')}
                      className="accent-purple-500"
                    />
                    <span className={`text-sm font-bold transition-colors ${diceStyleMode === 'preset' ? 'text-white' : 'text-slate-500'}`}>
                      使用预设
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="diceStyleMode"
                      checked={diceStyleMode === 'custom'}
                      onChange={() => setDiceStyleMode('custom')}
                      className="accent-purple-500"
                    />
                    <span className={`text-sm font-bold transition-colors ${diceStyleMode === 'custom' ? 'text-white' : 'text-slate-500'}`}>
                      自定义骰子材质
                    </span>
                  </label>
                </div>

                {/* ---- 使用预设：内置6套 + 自建的自定义预设，并列展示，点哪个就整体应用哪个 ---- */}
                {diceStyleMode === 'preset' && (
                  <div className="space-y-2">
                    {getAllAppearancePresets(customAppearancePresets).map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => handleSelectAppearancePreset(preset.id)}
                        className={`w-full flex items-center gap-2 p-2.5 rounded-lg text-left transition-all ${
                          appearancePresetId === preset.id ? 'bg-slate-700 ring-1 ring-purple-400' : 'bg-slate-800/60 hover:bg-slate-800'
                        }`}
                      >
                        {/* 用D6和D20两张纹理缩略图拼一下，让预设列表也能一眼看出大概质感 */}
                        <div className="flex -space-x-1.5 flex-shrink-0">
                          {(['d6', 'd20'] as DiceShape[]).map((shape) => {
                            const tex = getTextureOption(preset.shapeTextures[shape] || '');
                            return tex.thumbnail ? (
                              <span
                                key={shape}
                                className="w-7 h-7 rounded-md bg-cover bg-center border-2 border-slate-900"
                                style={{ backgroundImage: `url(${tex.thumbnail})` }}
                              />
                            ) : (
                              <span key={shape} className="w-7 h-7 rounded-md bg-white border-2 border-slate-900" />
                            );
                          })}
                        </div>
                        <span className={`flex-1 text-sm font-bold ${appearancePresetId === preset.id ? 'text-white' : 'text-slate-300'}`}>
                          {preset.name}
                        </span>
                        {preset.builtin && <span className="text-[10px] text-slate-500">内置</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* ---- 自定义骰子材质：新建/编辑/删除自定义预设，每种形状固定绑定一张纹理 ---- */}
                {diceStyleMode === 'custom' && (
                  <div className="space-y-2">
                    {customAppearancePresets.map((preset) => (
                      <div key={preset.id} className="rounded-lg bg-slate-800/60 overflow-hidden">
                        {editingAppearanceId === preset.id ? (
                          <AppearanceEditor
                            name={editingAppearanceName}
                            textures={editingAppearanceTextures}
                            onNameChange={setEditingAppearanceName}
                            onTexturesChange={setEditingAppearanceTextures}
                            onSave={handleSaveAppearance}
                            onCancel={() => setEditingAppearanceId(null)}
                          />
                        ) : (
                          <div className="flex items-center gap-2 p-3">
                            <span className="flex-1 text-sm font-bold text-white">{preset.name}</span>
                            <button
                              onClick={() => handleStartEditAppearance(preset)}
                              className="w-8 h-8 flex-shrink-0 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
                              title="编辑"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => handleDeleteAppearance(preset.id)}
                              className="w-8 h-8 flex-shrink-0 rounded-lg bg-slate-700 hover:bg-red-600 text-slate-300 hover:text-white text-xs transition-colors"
                              title="删除"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    ))}

                    {editingAppearanceId === '__new__' && (
                      <div className="rounded-lg bg-slate-800/60 overflow-hidden">
                        <AppearanceEditor
                          name={editingAppearanceName}
                          textures={editingAppearanceTextures}
                          onNameChange={setEditingAppearanceName}
                          onTexturesChange={setEditingAppearanceTextures}
                          onSave={handleSaveAppearance}
                          onCancel={() => setEditingAppearanceId(null)}
                        />
                      </div>
                    )}

                    {editingAppearanceId === null && customAppearancePresets.length < MAX_CUSTOM_APPEARANCE_PRESETS && (
                      <button
                        onClick={handleStartNewAppearance}
                        className="w-full py-2.5 rounded-lg text-sm font-bold text-purple-300 bg-slate-800/40 hover:bg-slate-800 border border-dashed border-purple-500/30 transition-colors"
                      >
                        + 新建样式（{customAppearancePresets.length}/{MAX_CUSTOM_APPEARANCE_PRESETS}）
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========== 显示设置sheet页：所有跨先攻/骰子的主屏幕控制集中在这里。 ========== */}
      {isConnected && activeSheet === 'settings' && (
        <div className="w-full max-w-5xl rc-chassis-edge rounded-[28px] p-3 sm:p-5 relative mb-4">
          <div className="absolute top-4 left-4 rc-screw" />
          <div className="absolute top-4 right-4 rc-screw" />
          <div className="absolute bottom-4 left-4 rc-screw" />
          <div className="absolute bottom-4 right-4 rc-screw" />
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="rc-led bg-cyan-400" style={{ boxShadow: '0 0 6px #22d3ee' }} />
              <div>
                <div className="text-cyan-100 font-black text-sm sm:text-base tracking-widest">DISPLAY SETTINGS</div>
                <div className="rc-label">主屏幕显示与面板控制</div>
              </div>
            </div>
            <div className="h-4 w-20 sm:w-32 rc-vents rounded opacity-60" />
          </div>
          <div className="rc-screen rounded-2xl p-4 sm:p-5 space-y-5">
            <section className="space-y-3">
              <div className="rc-label">显示缩放</div>
              <div className="space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">角色卡片</span>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={characterScale} onChange={(e) => handleCharacterScaleChange(parseFloat(e.target.value))} className="flex-1 accent-amber-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{characterScale.toFixed(2)}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">3D骰子大小</span>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={diceDisplayScale} onChange={(e) => handleDiceDisplayScaleChange(parseFloat(e.target.value))} className="flex-1 accent-purple-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{diceDisplayScale.toFixed(2)}</span>
                </label>
              </div>
            </section>
            <section className="space-y-3">
              <div className="rc-label">主屏幕视觉</div>
              <div className="space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">压暗强度</span>
                  <input type="range" min={0} max={1} step={0.05} value={dimIntensity} onChange={(e) => handleDimIntensityChange(parseFloat(e.target.value))} className="flex-1 accent-amber-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{dimIntensity.toFixed(2)}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">结果面板透明度</span>
                  <input type="range" min={0} max={1} step={0.05} value={resultPanelOpacity} onChange={(e) => handleResultPanelOpacityChange(parseFloat(e.target.value))} className="flex-1 accent-purple-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{resultPanelOpacity.toFixed(2)}</span>
                </label>
              </div>
            </section>
            <section className="space-y-3">
              <div className="rc-label">主屏幕面板尺寸</div>
              <div className="space-y-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-3">
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">房间号与二维码</span>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={roomInfoScale} onChange={(e) => handleRoomInfoScaleChange(parseFloat(e.target.value))} className="flex-1 accent-cyan-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{roomInfoScale.toFixed(2)}</span>
                </label>
                <label className="flex items-center gap-2">
                  <span className="w-24 sm:w-32 text-xs text-slate-300">历史掷骰</span>
                  <input type="range" min={0.6} max={1.5} step={0.05} value={diceHistoryScale} onChange={(e) => handleDiceHistoryScaleChange(parseFloat(e.target.value))} className="flex-1 accent-purple-500" />
                  <span className="w-9 text-right font-mono text-xs text-slate-400">{diceHistoryScale.toFixed(2)}</span>
                </label>
              </div>
            </section>
            <section className="space-y-3">
              <div className="rc-label">主屏幕面板</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button onClick={toggleDisplayRoomInfo} className={`rounded-xl border p-3 text-left transition-colors ${displayRoomInfoVisible ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-slate-700 bg-slate-950/40 text-slate-400'}`}>
                  <div className="text-sm font-black">{displayRoomInfoVisible ? '▣ 房间号与二维码：展示中' : '□ 房间号与二维码：已收起'}</div>
                  <div className="mt-1 text-[11px] opacity-75">点击{displayRoomInfoVisible ? '收起' : '展示'}主屏幕左上角房间信息</div>
                </button>
                <button onClick={toggleDisplayDiceHistory} className={`rounded-xl border p-3 text-left transition-colors ${displayDiceHistoryVisible ? 'border-purple-400/50 bg-purple-500/10 text-purple-100' : 'border-slate-700 bg-slate-950/40 text-slate-400'}`}>
                  <div className="text-sm font-black">{displayDiceHistoryVisible ? '▣ 历史掷骰：展示中' : '□ 历史掷骰：已收起'}</div>
                  <div className="mt-1 text-[11px] opacity-75">点击{displayDiceHistoryVisible ? '收起' : '展示'}主屏幕右下角历史面板</div>
                </button>
                <button onClick={toggleDisplayRound} className={`rounded-xl border p-3 text-left transition-colors ${displayRoundVisible ? 'border-amber-400/50 bg-amber-500/10 text-amber-100' : 'border-slate-700 bg-slate-950/40 text-slate-400'}`}>
                  <div className="text-sm font-black">{displayRoundVisible ? '▣ 回合数：展示中' : '□ 回合数：已收起'}</div>
                  <div className="mt-1 text-[11px] opacity-75">点击{displayRoundVisible ? '收起' : '展示'}主屏幕顶部回合数</div>
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ========== 先攻sheet页：未连接房间时始终显示(承载连接房间的界面)；
          已连接房间时只在activeSheet==='initiative'才显示，跟骰子sheet页二选一。 ========== */}
      {(!isConnected || activeSheet === 'initiative') && (
      <div className="w-full max-w-5xl rc-chassis-edge rounded-[28px] p-3 sm:p-5 relative">
        {/* 四角装饰螺丝钉 */}
        <div className="absolute top-4 left-4 rc-screw" />
        <div className="absolute top-4 right-4 rc-screw" />
        <div className="absolute bottom-4 left-4 rc-screw" />
        <div className="absolute bottom-4 right-4 rc-screw" />

        {/* 顶部品牌铭牌条 */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="rc-led bg-amber-400" style={{ boxShadow: '0 0 6px #fbbf24' }} />
            <div>
              <div className="text-amber-100 font-black text-sm sm:text-base tracking-widest">
                INITIATIVE CONSOLE
              </div>
              <div className="rc-label">先攻追踪 · 遥控终端</div>
            </div>
          </div>
          <div className="h-4 w-20 sm:w-32 rc-vents rounded opacity-60" />
        </div>

        {/* 状态条：当前回合信息。所有会影响主屏幕显示的滑块都集中在“显示设置”sheet。 */}
        {isConnected && roomId && (
          <div className="rc-screen rounded-xl px-4 sm:px-5 py-3 mb-3 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-baseline gap-2">
              <span className="rc-label">回合</span>
              <span className="text-lg font-bold text-purple-300">{roundNumber}</span>
            </div>
          </div>
        )}

        {/* 连接房间界面（嵌入屏幕面板样式） */}
        {!isConnected ? (
          <div className="rc-screen rc-scanline rounded-2xl p-6 sm:p-10 flex items-center justify-center min-h-[70vh]">
            <div className="max-w-md w-full">
              <h2 className="text-2xl sm:text-3xl font-black text-amber-400 mb-6 text-center tracking-wide">
                🎮 先攻追踪器
              </h2>
              
              <div className="space-y-4 mb-6">
                <div>
                  <label className="block rc-label mb-2 text-center">
                    输入房间号 · 6位数字
                  </label>
                  <input
                    type="text"
                    value={inputRoomId}
                    onChange={(e) => setInputRoomId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="123456"
                    className="w-full px-4 py-3 rounded-lg bg-black/60 border-2 border-amber-500/25 text-amber-100 text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-amber-500 placeholder-slate-700"
                    maxLength={6}
                  />
                </div>
                
                <button
                  onClick={handleConnectRoom}
                  disabled={inputRoomId.length !== 6}
                  className="rc-btn w-full px-6 py-4 rounded-xl font-black text-xl text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'linear-gradient(180deg, #10b981, #059669)' }}
                >
                  ▶ 连接房间
                </button>
              </div>

              <div className="border-t border-white/10 pt-6">
                <p className="rc-label text-center mb-3">或使用本地模式（单机）</p>
                <button
                  onClick={() => setIsConnected(true)}
                  className="rc-btn w-full px-6 py-3 rounded-xl font-bold text-lg text-slate-200 bg-slate-800"
                >
                  本地模式
                </button>
              </div>

              <div className="mt-6 p-4 bg-black/40 rounded-lg border border-white/5">
                <p className="text-slate-400 text-sm">
                  <strong className="text-slate-300">提示：</strong>房间号由主屏幕生成。打开
                  <a 
                    href="/tools/initiative-tracker/display" 
                    target="_blank"
                    className="text-amber-400 hover:text-amber-300 underline mx-1"
                  >
                    主屏幕
                  </a>
                  获取房间号。
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* 主界面 */
          <>
            {/* ========== 1. 战斗主显示区（嵌入式屏幕面板） ========== */}
            <div
              ref={combatZoneRef}
              onDragOver={handleDragOver}
              onDrop={handleDropToCombat}
              onTouchMove={handleCombatZoneTouchMove}
              onTouchEnd={handleCombatZoneTouchEnd}
              className="rc-screen rc-scanline relative h-[320px] min-h-[320px] sm:h-[380px] sm:min-h-[380px] md:h-[400px] md:min-h-[400px] rounded-2xl mb-3 overflow-hidden"
              style={{ touchAction: 'none' }}
            >
              {/* 区域标题 */}
              <div className="absolute top-3 left-4 rc-label z-20">
                ⚔ 战斗区域
              </div>

              <div className="absolute inset-0 bg-gradient-to-b from-purple-900/10 to-transparent" />
          
            {/* 战斗区角色立牌：按先攻值排序平铺，避免拥挤重叠（可换行/滚动） */}
            {/* flex-col + justify-end：让卡片整体贴着底部（靠近刻度尺），顶部富余空间留给箭头 */}
            <div className="absolute top-8 left-8 right-8 bottom-14 overflow-y-auto flex flex-col justify-end">
              {combatCharacters.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-purple-400">
                  <div>
                    <div className="text-4xl mb-2">⚔️</div>
                    <p className="text-lg">从下方拖拽角色到这里</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-end justify-center content-end gap-x-2 sm:gap-x-4 md:gap-x-6 gap-y-12 sm:gap-y-16 md:gap-y-20 pt-12 sm:pt-20 md:pt-24 pb-0">
                  {combatCharacters.map((char, index) => {
                    const isCurrent = index === currentTurn;
                    
                    return (
                      <div
                        key={char.id}
                        draggable
                        onDragStart={() => handleDragStart(char)}
                        onTouchStart={(e) => handleCardTouchStart(char, e)}
                        className="relative cursor-move transition-all duration-300"
                        style={{
                          transform: `scale(${isCurrent ? 1.15 : 1})`,
                          transformOrigin: 'bottom center',
                          zIndex: isCurrent ? 10 : 1,
                          touchAction: 'none',
                          userSelect: 'none',
                          WebkitUserSelect: 'none' as any,
                        }}
                      >
                        {/* 先攻值（在卡片上方） */}
                        <div className="absolute -top-8 sm:-top-10 left-1/2 -translate-x-1/2 z-10">
                          <div className={`text-base sm:text-lg md:text-xl font-black px-2 py-0.5 rounded whitespace-nowrap ${
                            isCurrent 
                              ? 'text-white bg-amber-500' 
                              : 'text-amber-400 bg-slate-900/80'
                          }`}>
                            {Math.floor(char.initiative)}
                          </div>
                        </div>
                        
                        {/* 删除按钮 */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveCombatCharacter(char.id, char.name);
                          }}
                          className="absolute -top-2 -right-2 z-30 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-all hover:scale-110"
                          title="移出战斗区"
                        >
                          ✕
                        </button>
                        
                        {/* Token 立牌：点击打开状态管理弹窗（buff/debuff/濒死） */}
                        <CharacterCard
                          char={char}
                          isCombat={false}
                          isCurrent={isCurrent}
                          onClick={() => handleOpenStatusModal(char.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 刻度绳（在底部） */}
            <div className="absolute bottom-8 left-8 right-8 h-12">
              <div className="absolute top-1/2 left-0 right-0 h-1 bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700 shadow-lg -translate-y-1/2" />
              
              {/* 刻度 */}
              {Array.from({ length: 31 }, (_, i) => 30 - i).map(val => (
                <div
                  key={val}
                  className="absolute top-1/2 -translate-y-1/2"
                  style={{ left: `${((30 - val) / 30) * 100}%` }}
                >
                  <div className={`w-px ${val % 5 === 0 ? 'h-6 bg-amber-300' : 'h-3 bg-amber-500/50'} -translate-x-1/2`} />
                  {val % 5 === 0 && (
                    <span className="absolute top-8 left-1/2 -translate-x-1/2 text-sm font-bold text-amber-400">
                      {val}
                    </span>
                  )}
                </div>
              ))}
              
              {/* 拖拽预览先攻值 */}
              {dragPreviewInit !== null && draggedChar && (
                <div
                  className="absolute top-8"
                  style={{ 
                    left: `${((30 - dragPreviewInit) / 30) * 100}%`, 
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="text-green-400 font-black text-xl bg-green-900/80 px-3 py-1 rounded animate-pulse border-2 border-green-400">
                    {dragPreviewInit}
                  </div>
                </div>
              )}
            </div>

            </div>

            {/* ========== 2. 备选角色池（嵌入式屏幕面板） ========== */}
            <div className="rc-screen rc-scanline relative p-5 pt-10 overflow-auto rounded-2xl mb-3 max-h-[45vh]">
              <div className="absolute top-3 left-4 rc-label z-10">
                ▤ 备选角色池
              </div>
              
              {reserveCharacters.length === 0 ? (
                <div className="text-center text-slate-500 py-8">
                  <p>备选区为空，从下方添加角色</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 sm:gap-3 justify-center">
                  {reserveCharacters.map((char) => (
                    <div
                      key={char.id}
                      draggable
                      onDragStart={() => handleDragStart(char)}
                      onTouchStart={(e) => handleCardTouchStart(char, e)}
                      className="relative cursor-move hover:scale-110 transition-all"
                      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' as any }}
                    >
                      <CharacterCard char={char} isCombat={false} isCurrent={false} />
                      
                      {/* 删除按钮 */}
                      <button
                        onClick={() => handleRemoveCharacter(char.id)}
                        className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 text-white text-xs hover:bg-red-600 transition-colors shadow-lg z-10"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ========== 3. 控制台：角色创建 / 重置 / 回合切换（物理按键区）========== */}
            <div className="rc-screen relative p-4 pt-9 rounded-2xl">
              <div className="absolute top-3 left-4 rc-label z-10">
                ⌘ 控制台
              </div>
              
              <div className="flex items-center justify-center gap-3 flex-wrap">
                <button
                  onClick={() => {
                    setAddingType('player');
                    setIsAddingCharacter(true);
                  }}
                  className="rc-btn px-5 py-2.5 rounded-xl font-bold text-white text-sm"
                  style={{ background: 'linear-gradient(180deg, #3b82f6, #2563eb)' }}
                >
                  ➕ 自定义角色
                </button>
                <button
                  onClick={handleReset}
                  className="rc-btn px-5 py-2.5 rounded-xl font-bold text-slate-200 bg-slate-800 text-sm"
                >
                  🔄 完全重置
                </button>
                {/* 回合切换：原来是fixed悬浮在视口右侧，现在挪进控制台面板里，跟其他按键放一起 */}
                {combatCharacters.length > 0 && (
                  <>
                    <button
                      onClick={handlePrevTurn}
                      className="rc-btn px-5 py-2.5 rounded-xl font-bold text-slate-100 bg-slate-800 text-sm"
                      title="上一个"
                    >
                      ◀ 上一个
                    </button>
                    <button
                      onClick={handleNextTurn}
                      className="rc-btn px-5 py-2.5 rounded-xl font-bold text-white text-sm"
                      style={{ background: 'linear-gradient(180deg, #f59e0b, #d97706)' }}
                      title="下一个"
                    >
                      下一个 ▶
                    </button>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      )}

      {/* 机身底部品牌条 */}
      <div className="w-full max-w-5xl flex items-center justify-center gap-2 mt-3 opacity-40">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-500 to-transparent" />
        <span className="rc-label">RC-01 · DND SERIES</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-500 to-transparent" />
      </div>

      {/* 底部sheet切换tab：房间连上后才出现(未连接时只有先攻页承载连接界面，没有切换的意义)。
          fixed固定在屏幕最下面，留出安全间距(pb-24给页面内容)避免被这个tab条挡住。 */}
      {isConnected && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center px-3 pb-3 pt-2 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent">
          <div className="w-full max-w-5xl rc-chassis-edge rounded-2xl p-1.5 grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setActiveSheet('initiative')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-xl font-bold transition-all ${
                activeSheet === 'initiative' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-lg leading-none">⚔</span>
              <span className="text-[11px] tracking-wide">先攻</span>
            </button>
            <button
              onClick={() => setActiveSheet('dice')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-xl font-bold transition-all ${
                activeSheet === 'dice' ? 'bg-purple-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 2 L21 7 L21 17 L12 22 L3 17 L3 7 Z" strokeLinejoin="round" />
                <path d="M12 2 L12 22 M3 7 L12 12 L21 7 M3 17 L12 12" strokeLinejoin="round" strokeLinecap="round" opacity="0.5" />
              </svg>
              <span className="text-[11px] tracking-wide">骰子</span>
            </button>
            <button
              onClick={() => setActiveSheet('settings')}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 rounded-xl font-bold transition-all ${
                activeSheet === 'settings' ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-lg leading-none">⚙</span>
              <span className="text-[11px] tracking-wide">显示设置</span>
            </button>
          </div>
        </div>
      )}

      {/* 角色创建弹窗 */}
      {isAddingCharacter && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-4xl w-full border-2 border-purple-500/50 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-black text-amber-400 mb-4 text-center">
              创建{addingType === 'player' ? '玩家角色' : addingType === 'enemy' ? '敌人' : addingType === 'npc' ? 'NPC' : '自定义生物'}
            </h3>

            {/* 类型选择 */}
            <div className="flex gap-2 justify-center mb-6 flex-wrap">
              <button
                onClick={() => setAddingType('player')}
                className={`px-6 py-2 rounded-lg font-bold transition-all ${
                  addingType === 'player'
                    ? 'bg-blue-500 text-white scale-110'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                👤 玩家
              </button>
              <button
                onClick={() => setAddingType('enemy')}
                className={`px-6 py-2 rounded-lg font-bold transition-all ${
                  addingType === 'enemy'
                    ? 'bg-red-500 text-white scale-110'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                👹 敌人
              </button>
              <button
                onClick={() => setAddingType('npc')}
                className={`px-6 py-2 rounded-lg font-bold transition-all ${
                  addingType === 'npc'
                    ? 'bg-green-500 text-white scale-110'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                🧔 NPC
              </button>
              <button
                onClick={() => setAddingType('custom')}
                className={`px-6 py-2 rounded-lg font-bold transition-all ${
                  addingType === 'custom'
                    ? 'bg-purple-500 text-white scale-110'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                ✨ 自定义生物
              </button>
            </div>

            {/* 角色名称 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-purple-300 mb-2">角色名称</label>
              <input
                type="text"
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                placeholder="输入角色名称..."
                className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-purple-500/30 text-white placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                autoFocus
              />
            </div>

            {/* 玩家角色选择 */}
            {addingType === 'player' && (
              <div className="space-y-4">
                {/* 种族选择 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">种族</label>
                  <div className="grid grid-cols-3 gap-2">
                    {RACES.map((race) => (
                      <button
                        key={race.en}
                        onClick={() => setSelectedRace(race)}
                        className={`px-4 py-2 rounded-lg font-bold transition-all ${
                          selectedRace.en === race.en
                            ? 'bg-purple-500 text-white scale-105'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {race.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 职业选择 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">职业</label>
                  <div className="grid grid-cols-4 gap-2">
                    {CLASSES.map((cls) => (
                      <button
                        key={cls}
                        onClick={() => setSelectedClass(cls)}
                        className={`px-3 py-2 rounded-lg font-bold transition-all text-sm ${
                          selectedClass === cls
                            ? 'bg-amber-500 text-white scale-105'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {cls}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 预览图片 */}
                <div className="flex items-center justify-center gap-4 p-4 bg-slate-800 rounded-lg">
                  <div className="text-center">
                    <p className="text-purple-300 mb-2">预览</p>
                    <img
                      src={getPreviewImage()}
                      alt="预览"
                      draggable={false}
                      className="w-32 h-48 object-contain rounded-lg border-2 border-purple-500"
                      style={{ imageRendering: 'pixelated' }}
                      onError={(e) => {
                        // 如果图片加载失败，尝试其他图片
                        const target = e.target as HTMLImageElement;
                        if (!target.src.includes('其他')) {
                          target.src = `/image/player/${selectedRace.name}_${selectedRace.en}/其他1.png`;
                        }
                      }}
                    />
                    <button
                      onClick={switchToRaceAlternative}
                      className="mt-2 px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs"
                    >
                      换一个
                    </button>
                  </div>
                  <div className="text-purple-300 text-sm">
                    <p>种族: <span className="text-white font-bold">{selectedRace.name}</span></p>
                    <p>职业: <span className="text-white font-bold">{selectedClass}</span></p>
                  </div>
                </div>
              </div>
            )}

            {/* 敌人选择 */}
            {addingType === 'enemy' && (
              <div className="space-y-4">
                {/* 搜索框 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">搜索怪物（中英文）</label>
                  <input
                    type="text"
                    value={enemySearch}
                    onChange={(e) => setEnemySearch(e.target.value)}
                    placeholder="搜索：哥布林、goblin、骷髅..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-purple-500/30 text-white placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* 怪物列表 */}
                <div className="grid grid-cols-4 gap-3 max-h-64 overflow-y-auto p-2">
                  {filteredEnemies.map((enemy) => (
                    <button
                      key={enemy.key}
                      onClick={() => {
                        setSelectedEnemy(enemy.key);
                        // 快捷填充角色名：每次点击图片都自动填成对应名字，方便连续挑选
                        setNewCharName(enemy.name);
                      }}
                      className={`relative p-2 rounded-lg transition-all ${
                        selectedEnemy === enemy.key
                          ? 'bg-red-500/30 border-2 border-red-500 scale-105'
                          : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <img
                        src={getEnemyImageUrl(enemy.key, enemyList)}
                        alt={enemy.name}
                        draggable={false}
                        className="w-full h-20 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <p className="text-xs text-white mt-1 truncate">
                        {enemy.name}
                      </p>
                    </button>
                  ))}
                </div>

                {filteredEnemies.length === 0 && (
                  <div className="text-center text-purple-400 py-8">
                    <p>没有找到匹配的怪物</p>
                    <p className="text-sm text-purple-500 mt-2">将使用随机emoji</p>
                  </div>
                )}
              </div>
            )}

            {/* NPC选择 */}
            {addingType === 'npc' && (
              <div className="space-y-4">
                {/* 图片来源选择 */}
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setNpcImageType('player')}
                    className={`px-6 py-2 rounded-lg font-bold transition-all ${
                      npcImageType === 'player'
                        ? 'bg-blue-500 text-white scale-105'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    玩家角色图片
                  </button>
                  <button
                    onClick={() => setNpcImageType('enemy')}
                    className={`px-6 py-2 rounded-lg font-bold transition-all ${
                      npcImageType === 'enemy'
                        ? 'bg-red-500 text-white scale-105'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    怪物图片
                  </button>
                </div>

                {/* 玩家角色图片选择 */}
                {npcImageType === 'player' && (
                  <div className="space-y-4">
                    {/* 种族选择 */}
                    <div>
                      <label className="block text-sm font-medium text-purple-300 mb-2">种族</label>
                      <div className="grid grid-cols-3 gap-2">
                        {RACES.map((race) => (
                          <button
                            key={race.en}
                            onClick={() => setNpcSelectedRace(race)}
                            className={`px-4 py-2 rounded-lg font-bold transition-all ${
                              npcSelectedRace.en === race.en
                                ? 'bg-green-500 text-white scale-105'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {race.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 职业选择 */}
                    <div>
                      <label className="block text-sm font-medium text-purple-300 mb-2">职业</label>
                      <div className="grid grid-cols-4 gap-2">
                        {CLASSES.map((cls) => (
                          <button
                            key={cls}
                            onClick={() => setNpcSelectedClass(cls)}
                            className={`px-3 py-2 rounded-lg font-bold transition-all text-sm ${
                              npcSelectedClass === cls
                                ? 'bg-green-500 text-white scale-105'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {cls}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 预览图片 */}
                    <div className="flex items-center justify-center gap-4 p-4 bg-slate-800 rounded-lg">
                      <div className="text-center">
                        <p className="text-green-300 mb-2">预览</p>
                        <img
                          src={getPreviewImage()}
                          alt="预览"
                          draggable={false}
                          className="w-32 h-48 object-contain rounded-lg border-2 border-green-500"
                          style={{ imageRendering: 'pixelated' }}
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            if (!target.src.includes('其他')) {
                              target.src = `/image/player/${npcSelectedRace.name}_${npcSelectedRace.en}/其他1.png`;
                            }
                          }}
                        />
                      </div>
                      <div className="text-green-300 text-sm">
                        <p>种族: <span className="text-white font-bold">{npcSelectedRace.name}</span></p>
                        <p>职业: <span className="text-white font-bold">{npcSelectedClass}</span></p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 怪物图片选择 */}
                {npcImageType === 'enemy' && (
                  <div className="space-y-4">
                    {/* 搜索框 */}
                    <div>
                      <label className="block text-sm font-medium text-purple-300 mb-2">搜索怪物（中英文）</label>
                      <input
                        type="text"
                        value={npcSearch}
                        onChange={(e) => setNpcSearch(e.target.value)}
                        placeholder="搜索：哥布林、goblin、骷髅..."
                        className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-purple-500/30 text-white placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                      />
                    </div>

                    {/* 怪物列表 */}
                    <div className="grid grid-cols-4 gap-3 max-h-64 overflow-y-auto p-2">
                      {filteredNpcEnemies.map((enemy) => (
                        <button
                          key={enemy.key}
                          onClick={() => {
                            setSelectedNpcImage(enemy.key);
                            // 快捷填充角色名：每次点击图片都自动填成对应名字，方便连续挑选
                            setNewCharName(enemy.name);
                          }}
                          className={`relative p-2 rounded-lg transition-all ${
                            selectedNpcImage === enemy.key
                              ? 'bg-green-500/30 border-2 border-green-500 scale-105'
                              : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          <img
                            src={getEnemyImageUrl(enemy.key, enemyList)}
                            alt={enemy.name}
                            draggable={false}
                            className="w-full h-20 object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <p className="text-xs text-white mt-1 truncate">
                            {enemy.name}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 自定义生物：阵营选择 + 统一图片库 / 文字当图片 + 边框色选择 */}
            {addingType === 'custom' && (
              <div className="space-y-4">
                {/* 阵营选择：决定类型标签和默认边框色分组，但边框色可自由覆盖 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">所属阵营</label>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={() => setCustomCampType('player')}
                      className={`px-6 py-2 rounded-lg font-bold transition-all ${
                        customCampType === 'player'
                          ? 'bg-amber-500 text-white scale-105'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      👤 玩家
                    </button>
                    <button
                      onClick={() => setCustomCampType('npc')}
                      className={`px-6 py-2 rounded-lg font-bold transition-all ${
                        customCampType === 'npc'
                          ? 'bg-blue-500 text-white scale-105'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      🧔 NPC
                    </button>
                    <button
                      onClick={() => setCustomCampType('enemy')}
                      className={`px-6 py-2 rounded-lg font-bold transition-all ${
                        customCampType === 'enemy'
                          ? 'bg-red-500 text-white scale-105'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      👹 怪物
                    </button>
                  </div>
                </div>

                {/* 边框色选择 */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">边框颜色</label>
                  <div className="flex gap-2 justify-center flex-wrap">
                    {BORDER_COLOR_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        onClick={() => setCustomBorderColor(preset.value)}
                        title={preset.label}
                        className={`w-9 h-9 rounded-full transition-all ${
                          customBorderColor === preset.value ? 'scale-125 ring-2 ring-white' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: preset.value }}
                      />
                    ))}
                    {/* 自由选色：不局限于预设 */}
                    <input
                      type="color"
                      value={customBorderColor}
                      onChange={(e) => setCustomBorderColor(e.target.value)}
                      className="w-9 h-9 rounded-full cursor-pointer border border-slate-600 bg-transparent"
                      title="自定义颜色"
                    />
                  </div>
                </div>

                {/* 搜索图片库（怪物图+玩家立绘一起搜） */}
                <div>
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    从图片库选择（可搜索全部怪物图/玩家立绘）
                  </label>
                  <input
                    type="text"
                    value={customSearch}
                    onChange={(e) => setCustomSearch(e.target.value)}
                    placeholder="搜索：狼、战士、哥布林..."
                    className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-purple-500/30 text-white placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div className="grid grid-cols-4 gap-3 max-h-56 overflow-y-auto p-2">
                  {filteredCustomMedia.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        setSelectedCustomMedia(item);
                        setCustomTextToken(''); // 选了图片就不再用文字模式
                        // 快捷填充角色名：每次点击图片都自动填成对应名字，方便连续挑选
                        setNewCharName(item.name);
                      }}
                      className={`relative p-2 rounded-lg transition-all ${
                        selectedCustomMedia?.key === item.key
                          ? 'bg-purple-500/30 border-2 border-purple-500 scale-105'
                          : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <img
                        src={item.url}
                        alt={item.name}
                        draggable={false}
                        className="w-full h-20 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <p className="text-xs text-white mt-1 truncate">
                        {item.name}
                      </p>
                    </button>
                  ))}
                </div>

                {filteredCustomMedia.length === 0 && (
                  <div className="text-center text-purple-400 py-4 text-sm">
                    没有找到匹配的图片
                  </div>
                )}

                {/* 图片库没有想要的：写文字当"图片" */}
                <div className="border-t border-purple-500/20 pt-4">
                  <label className="block text-sm font-medium text-purple-300 mb-2">
                    图片库里没有想要的？写文字当"图片"（会显示在卡片正中，自动调整字号）
                  </label>
                  <input
                    type="text"
                    value={customTextToken}
                    onChange={(e) => {
                      setCustomTextToken(e.target.value);
                      if (e.target.value.trim()) setSelectedCustomMedia(null); // 写文字就清空图片选择
                    }}
                    placeholder="例如：巨龟、远古魔像、💀 等，留空则默认用角色名"
                    className="w-full px-4 py-2 rounded-lg bg-slate-800 border border-purple-500/30 text-white placeholder-purple-400/50 focus:outline-none focus:border-purple-500"
                  />
                </div>

                {/* 实时预览 */}
                <div className="flex items-center justify-center p-4 bg-slate-800 rounded-lg">
                  <div className="text-center">
                    <p className="text-purple-300 mb-2 text-sm">预览</p>
                    <CharacterCard
                      char={{
                        id: 'preview',
                        name: newCharName.trim() || '未命名',
                        initiative: 0,
                        token: customTextToken.trim() || newCharName.trim() || '?',
                        imageUrl: selectedCustomMedia?.url,
                        type: customCampType,
                        color: TYPE_COLORS[customCampType],
                        borderColor: customBorderColor,
                        inCombat: false,
                      }}
                      isCombat
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 按钮组 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={handleAddCharacter}
                disabled={!newCharName.trim()}
                className="flex-1 px-6 py-3 rounded-xl font-black text-lg shadow-2xl hover:scale-105 transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                ✓ 添加角色
              </button>
              <button
                onClick={() => {
                  setIsAddingCharacter(false);
                  setNewCharName('');
                  setEnemySearch('');
                  setSelectedEnemy('');
                  setNpcSearch('');
                  setSelectedNpcImage('');
                  setCustomSearch('');
                  setSelectedCustomMedia(null);
                  setCustomTextToken('');
                  setCustomBorderColor(BORDER_COLOR_PRESETS[0].value);
                }}
                className="px-6 py-3 rounded-xl font-black text-lg shadow-2xl hover:scale-105 transition-all bg-slate-700 text-white"
              >
                ✕ 取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 重叠角色排序弹窗 */}
      {showOverlapModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-3xl w-full max-h-[85vh] overflow-y-auto border-2 border-purple-500/50 shadow-2xl">
            <h3 className="text-2xl font-black text-amber-400 mb-4 text-center">
              先攻值重叠 - 调整顺序
            </h3>
            <p className="text-purple-300 text-center mb-6">
              拖动卡片左右排序，左边先行动
            </p>
            
            <div className="flex gap-6 justify-center mb-6 overflow-x-auto pt-12 pb-10 px-4"
              onTouchMove={(e) => {
                // 触摸排序：检测手指划过哪张卡片，动态调整顺序
                if (!draggedChar) return;
                const touch = e.touches[0];
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (target) {
                  const cardEl = target.closest('[data-overlap-char-id]');
                  if (cardEl) {
                    const targetId = cardEl.getAttribute('data-overlap-char-id');
                    if (targetId && targetId !== draggedChar.id) {
                      setOverlapCharacters(prev => {
                        const dragIndex = prev.findIndex(c => c.id === draggedChar.id);
                        const dropIndex = prev.findIndex(c => c.id === targetId);
                        if (dragIndex === -1 || dropIndex === -1 || dragIndex === dropIndex) return prev;
                        const newOrder = [...prev];
                        const [moved] = newOrder.splice(dragIndex, 1);
                        newOrder.splice(dropIndex, 0, moved);
                        return newOrder;
                      });
                    }
                  }
                }
              }}
              onTouchEnd={() => setDraggedChar(null)}
            >
              {overlapCharacters.map((char, index) => {
                const isDragging = draggedChar?.id === char.id;
                return (
                <div
                  key={char.id}
                  data-overlap-char-id={char.id}
                  draggable
                  onDragStart={() => setDraggedChar(char)}
                  onDragEnd={() => setDraggedChar(null)}
                  onTouchStart={(e) => { e.stopPropagation(); setDraggedChar(char); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    if (!draggedChar || draggedChar.id === char.id) return;
                    
                    setOverlapCharacters(prev => {
                      const dragIndex = prev.findIndex(c => c.id === draggedChar.id);
                      const dropIndex = prev.findIndex(c => c.id === char.id);
                      if (dragIndex === -1 || dropIndex === -1 || dragIndex === dropIndex) return prev;
                      
                      // 拖拽移动到目标位置（推挤其他卡片，而非交换）
                      const newOrder = [...prev];
                      const [moved] = newOrder.splice(dragIndex, 1);
                      newOrder.splice(dropIndex, 0, moved);
                      return newOrder;
                    });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDraggedChar(null);
                  }}
                  className={`relative cursor-move flex-shrink-0 transition-all duration-300 ease-out ${
                    isDragging ? 'scale-110 opacity-50 z-20' : 'hover:scale-105'
                  }`}
                  style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' as any }}
                >
                  <CharacterCard char={char} isCombat={false} isCurrent={false} />
                  <div className="absolute -top-9 left-1/2 -translate-x-1/2 text-amber-400 font-black text-xl whitespace-nowrap">
                    {Math.floor(char.initiative)}
                  </div>
                  <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 text-purple-300 text-xs whitespace-nowrap">
                    顺序 {index + 1}
                  </div>
                </div>
                );
              })}
            </div>
            
            <button
              onClick={() => {
                // 应用排序：调整先攻值小数位
                const updatedChars = overlapCharacters.map((char, index) => ({
                  ...char,
                  initiative: char.initiative + (overlapCharacters.length - index - 1) * 0.01
                }));
                
                setCharacters(prev => {
                  const updated = [...prev];
                  updatedChars.forEach(newChar => {
                    const idx = updated.findIndex(c => c.id === newChar.id);
                    if (idx !== -1) updated[idx] = newChar;
                  });
                  
                  // 同步到房间（通过WebSocket）
                  if (isConnected && roomId) {
                    const combatChars = updated.filter(c => c.inCombat);
                    updateRoom({ characters: combatChars });
                  }
                  
                  return updated;
                });
                
                setShowOverlapModal(false);
                setOverlapCharacters([]);
              }}
              className="w-full px-6 py-3 rounded-xl font-black text-lg shadow-2xl hover:scale-105 transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              ✓ 确认顺序
            </button>
          </div>
        </div>
      )}

      {/* 移出战斗区确认弹窗：替代浏览器原生confirm，风格和其他弹窗统一 */}
      {removeTarget && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setRemoveTarget(null)}
        >
          <div
            className="bg-slate-900 rounded-2xl p-6 max-w-sm w-full border-2 border-red-500/40 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-3 mb-6">
              <div className="w-14 h-14 rounded-full bg-red-500/15 border-2 border-red-500/40 flex items-center justify-center text-3xl">
                🗑️
              </div>
              <h3 className="text-xl font-black text-red-400">移出战斗区</h3>
              <p className="text-slate-300 text-sm">
                确定要将 <span className="font-bold text-amber-400">「{removeTarget.name}」</span> 移出战斗区吗？
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRemoveTarget(null)}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmRemoveCombatCharacter}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold text-white shadow-lg hover:scale-105 transition-all"
                style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
              >
                确认移出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量重投确认：用户可先在结果中多选骰子，再用一次确认触发同一段物理动画。 */}
      {rerollConfirmTargets && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
          onClick={() => setRerollConfirmTargets(null)}
        >
          <div
            className="bg-slate-900 rounded-2xl p-5 sm:p-6 max-w-sm w-full border-2 border-amber-500/40 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center gap-3 mb-6">
              <div className="flex flex-wrap justify-center gap-2 max-h-40 overflow-y-auto">
                {rerollConfirmTargets.map((target) => (
                  <DiceShapeIcon key={target.dieId} sides={target.sides} value={target.value} size={48} state="selected" />
                ))}
              </div>
              <h3 className="text-xl font-black text-amber-400">重投已选 {rerollConfirmTargets.length} 颗骰子？</h3>
              <p className="text-slate-300 text-sm">
                它们会在主屏幕中同时重投；每颗骰子都只能重投一次，确认后不能取消。
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRerollConfirmTargets(null)}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold text-slate-200 bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmReroll}
                className="flex-1 px-4 py-2.5 rounded-xl font-bold text-white shadow-lg hover:scale-105 transition-all"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
              >
                确认重投
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 状态管理弹窗（buff/debuff/濒死）：点击战斗区角色卡触发 */}
      {statusModalCharId && (() => {
        const statusChar = characters.find((c) => c.id === statusModalCharId);
        if (!statusChar) return null;
        const statuses = statusChar.statuses || [];
        const dyingInstance = statuses.find((s) => s.statusId === 'dying');
        const exhaustionInstance = statuses.find((s) => s.statusId === 'exhaustion');
        const pendingDef = STATUS_LIBRARY[pendingStatusId];

        return (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={() => setStatusModalCharId(null)}
          >
            <div
              className="bg-slate-900 rounded-2xl p-6 max-w-lg w-full border-2 border-purple-500/50 shadow-2xl max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 标题：角色名 + 小型卡片预览 */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-16 flex-shrink-0">
                  <CharacterCard char={statusChar} isCombat={false} isCurrent={false} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-amber-400">{statusChar.name}</h3>
                  <p className="text-xs text-slate-400">状态管理 · Buff / Debuff / 濒死</p>
                </div>
              </div>

              {/* 已附加的状态列表 */}
              <div className="mb-5">
                <p className="text-sm font-medium text-purple-300 mb-2">当前状态</p>
                {statuses.length === 0 ? (
                  <p className="text-slate-500 text-sm py-3 text-center bg-slate-800/50 rounded-lg">暂无状态</p>
                ) : (
                  <div className="space-y-2">
                    {statuses.map((s) => {
                      const def = STATUS_LIBRARY[s.statusId];
                      return (
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border"
                          style={{ backgroundColor: `${def.color}1a`, borderColor: `${def.color}55` }}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-white truncate">{def.name}</p>
                              <p className="text-xs text-slate-400">
                                {s.statusId === 'exhaustion' && `等级 ${s.level ?? 1} / 6`}
                                {s.statusId === 'dying' && `成功 ${s.successes ?? 0}/3 · 失败 ${s.failures ?? 0}/3`}
                                {s.statusId !== 'exhaustion' && s.statusId !== 'dying' && (
                                  s.duration == null ? '无限持续' : `剩余 ${s.duration} 回合`
                                )}
                              </p>
                            </div>
                          </div>
                          {/* 力竭/濒死有专用控件，不显示通用移除按钮（力竭用等级按钮调整，濒死只能通过豁免结果变化） */}
                          {s.statusId !== 'exhaustion' && s.statusId !== 'dying' && (
                            <button
                              onClick={() => handleRemoveStatus(statusChar.id, s.id)}
                              className="w-7 h-7 flex-shrink-0 rounded-full bg-slate-700 hover:bg-red-600 text-white text-xs transition-colors"
                              title="移除状态"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 力竭等级调整（力竭已存在时才显示，或者从下方"添加状态"新增） */}
              {exhaustionInstance && (
                <div className="mb-5 p-3 rounded-lg bg-red-950/30 border border-red-700/40">
                  <p className="text-sm font-medium text-red-300 mb-2">力竭等级（6级直接死亡）</p>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSetExhaustionLevel(statusChar.id, (exhaustionInstance.level ?? 1) - 1)}
                      className="w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-bold"
                    >
                      −
                    </button>
                    <div className="flex-1 text-center text-xl font-black text-red-400">
                      {exhaustionInstance.level ?? 1} / 6
                    </div>
                    <button
                      onClick={() => handleSetExhaustionLevel(statusChar.id, (exhaustionInstance.level ?? 1) + 1)}
                      className="w-9 h-9 rounded-lg bg-red-700 hover:bg-red-600 text-white font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              )}

              {/* 濒死：死亡豁免记录（成功3次稳定脱离，失败3次彻底死亡并从战斗区移除） */}
              {dyingInstance && (
                <div className="mb-5 p-3 rounded-lg bg-red-950/40 border-2 border-red-600/50">
                  <p className="text-sm font-bold text-red-300 mb-2">濒死 · 死亡豁免</p>
                  <div className="flex items-center justify-center gap-4 mb-3">
                    <div className="text-center">
                      <div className="text-xs text-emerald-400 mb-1">成功</div>
                      <div className="text-2xl font-black text-emerald-400">{dyingInstance.successes ?? 0} / 3</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-red-400 mb-1">失败</div>
                      <div className="text-2xl font-black text-red-400">{dyingInstance.failures ?? 0} / 3</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDeathSave(statusChar.id, true)}
                      className="flex-1 px-3 py-2 rounded-lg font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors"
                    >
                      豁免成功
                    </button>
                    <button
                      onClick={() => handleDeathSave(statusChar.id, false)}
                      className="flex-1 px-3 py-2 rounded-lg font-bold text-white bg-red-600 hover:bg-red-500 transition-colors"
                    >
                      豁免失败
                    </button>
                  </div>
                </div>
              )}

              {/* 添加新状态 */}
              <div className="border-t border-purple-500/20 pt-4">
                <p className="text-sm font-medium text-purple-300 mb-2">添加状态</p>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">增益 Buff</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_ORDER.filter((id) => STATUS_LIBRARY[id].category === 'buff').map((id) => (
                        <button
                          key={id}
                          onClick={() => setPendingStatusId(id)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold border-2 transition-all whitespace-nowrap ${
                            pendingStatusId === id ? 'scale-105 border-white text-white' : 'border-transparent opacity-70 hover:opacity-100 text-slate-200'
                          }`}
                          style={{ backgroundColor: `${STATUS_LIBRARY[id].color}40` }}
                        >
                          {STATUS_LIBRARY[id].name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">减益 Debuff / 特殊</p>
                    <div className="flex flex-wrap gap-1.5">
                      {STATUS_ORDER.filter((id) => STATUS_LIBRARY[id].category !== 'buff').map((id) => (
                        <button
                          key={id}
                          onClick={() => setPendingStatusId(id)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold border-2 transition-all whitespace-nowrap ${
                            pendingStatusId === id ? 'scale-105 border-white text-white' : 'border-transparent opacity-70 hover:opacity-100 text-slate-200'
                          }`}
                          style={{ backgroundColor: `${STATUS_LIBRARY[id].color}40` }}
                        >
                          {STATUS_LIBRARY[id].name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800/60 mb-3">
                  <span className="text-sm font-bold text-white flex-1">{pendingDef.name}</span>
                  <span className="text-xs text-slate-500">{pendingDef.description}</span>
                </div>

                {/* 力竭/濒死没有"回合数"概念，添加按钮文案和行为不同 */}
                {pendingStatusId === 'exhaustion' ? (
                  <button
                    onClick={() => handleSetExhaustionLevel(statusChar.id, (exhaustionInstance?.level ?? 0) + 1)}
                    className="w-full px-4 py-2.5 rounded-xl font-bold text-white bg-red-600 hover:bg-red-500 transition-colors"
                  >
                    {exhaustionInstance ? '力竭等级 +1' : '添加力竭（1级）'}
                  </button>
                ) : pendingStatusId === 'dying' ? (
                  <button
                    onClick={() => handleAddStatus(statusChar.id, 'dying', null)}
                    disabled={!!dyingInstance}
                    className="w-full px-4 py-2.5 rounded-xl font-bold text-white bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {dyingInstance ? '已处于濒死状态' : '进入濒死状态'}
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-slate-400 whitespace-nowrap">持续回合</label>
                    <input
                      type="number"
                      min={1}
                      value={pendingDuration}
                      onChange={(e) => setPendingDuration(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value) || 1))}
                      disabled={pendingDuration === ''}
                      className="w-16 px-2 py-1.5 rounded-lg bg-slate-800 border border-purple-500/30 text-white text-center text-sm disabled:opacity-40"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={pendingDuration === ''}
                        onChange={(e) => setPendingDuration(e.target.checked ? '' : 3)}
                      />
                      无限
                    </label>
                    <button
                      onClick={() => handleAddStatus(statusChar.id, pendingStatusId, pendingDuration === '' ? null : pendingDuration)}
                      className="flex-1 px-4 py-2 rounded-xl font-bold text-white shadow-lg transition-all hover:scale-105"
                      style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
                    >
                      ✓ 添加
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => setStatusModalCharId(null)}
                className="w-full mt-4 px-4 py-2.5 rounded-xl font-bold text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
