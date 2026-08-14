'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWebSocket, getWsUrl } from '@/lib/useWebSocket';
// 状态效果（buff/debuff/濒死）：主屏幕只做只读展示，复用和遥控器同一份类型/常量/动效映射
import { CharacterStatusInstance, STATUS_LIBRARY, getAllCardEffects } from '@/lib/statusEffects';
// 状态环绕动效：每种buff/debuff一个专属的粒子/光效组件，围绕在卡片周围渲染
import StatusAura from '@/components/dnd/StatusAura';
// 3D骰子：主屏幕当骰盘用，铺满全屏播放投掷动画，摇完后展示结果再自动收起
import DiceRoller, { DiceRollRequest, DiceRollResult, DiceRerollRequest } from '@/components/dnd/DiceRoller';
import type { DiceHistoryEntry, DiceRerollHistoryItem } from '@/lib/diceHistory';
// 骰子形状图标：结果面板里每颗骰子用形状轮廓(能看出D几)+数字+文字标识展示，
// 主屏幕这边只做展示(用idle/used/rerolling三态标识重投状态)，不需要可点击(重投只能从遥控器发起)
import DiceShapeIcon from '@/components/dnd/DiceShapeIcon';
// 自定义表达式的kh/kl取高取低：主屏幕拿到遥控器发来的"配方"+引擎摇出的原始点数，
// 自己重新算一遍明细，决定哪几颗骰子该被丢弃、该给哪几颗骰子加发光描边（不需要认识完整表达式语法）
import { FlattenedRecipe, EvaluatedExpression, EngineResultSet, evaluateRecipe, computeHighlights, DiceHighlight } from '@/lib/diceExpression';

// 角色类型
interface Character {
  id: string; // combatId（战斗区中的唯一ID）
  name: string;
  initiative: number;
  token: string;
  imageUrl?: string;
  type: 'player' | 'enemy' | 'npc';
  color: string;
  combatId?: string; // 战斗区中的唯一ID（与id相同）
  borderColor?: string; // 自定义边框色（十六进制），未设置时按type使用阵营默认配色
  statuses?: CharacterStatusInstance[]; // buff/debuff/濒死状态列表
}

// 阵营默认配色：玩家=金色，NPC=蓝色，怪物=红色
const TYPE_THEME: Record<Character['type'], { border: string; tagBg: string; tagBorder: string; label: string }> = {
  player: { border: '#fbbf24', tagBg: 'rgba(251,191,36,0.75)', tagBorder: 'rgba(251,191,36,0.5)', label: '玩家' },
  npc: { border: '#3b82f6', tagBg: 'rgba(59,130,246,0.75)', tagBorder: 'rgba(59,130,246,0.5)', label: 'NPC' },
  enemy: { border: '#ef4444', tagBg: 'rgba(239,68,68,0.75)', tagBorder: 'rgba(239,68,68,0.5)', label: '敌人' },
};

// 自定义生物允许用长文字当"图片"，卡片上的大字需要根据文字长度自适应缩小，避免溢出
function getTokenFontSizeClass(token: string): string {
  const len = token.length;
  if (len <= 2) return 'text-6xl';
  if (len <= 4) return 'text-4xl';
  if (len <= 6) return 'text-2xl';
  if (len <= 10) return 'text-lg';
  return 'text-sm';
}

interface RoomState {
  roomId: string;
  characters: Character[];
  currentTurn: number;
  roundNumber: number;
  dimIntensity?: number; // 非当前回合角色的压暗强度(0~1)，由遥控器上的滑块控制，0=不灰，1=特别灰
  resultPanelOpacity?: number; // "骰子计算总和"结果面板的不透明度(0~1)，由遥控器上的滑块控制，0=全透明，1=完全不透明
  characterScale?: number;
  diceDisplayScale?: number;
  roomInfoScale?: number;
  diceHistoryScale?: number;
  displayRoomInfoVisible?: boolean;
  displayDiceHistoryVisible?: boolean;
  displayRoundVisible?: boolean;
  diceHistory?: DiceHistoryEntry[];
}

// 与遥控器一致的默认值：房间刚创建、遥控器还没推送过滑块值时使用
const DEFAULT_DIM_INTENSITY = 0.55;
const DEFAULT_RESULT_PANEL_OPACITY = 1;
const DEFAULT_CHARACTER_SCALE = 1;
const DEFAULT_DICE_DISPLAY_SCALE = 1;
const DEFAULT_ROOM_INFO_SCALE = 1;
const DEFAULT_DICE_HISTORY_SCALE = 1;

type CriticalEffect = 'success' | 'failure';

// 只有纯粹的D20检定才触发大成功/大失败：1D20、2D20kh1（优势）或2D20kl1（劣势）。
// 配方中只要多一个骰子组、修正值、负号，或不是"取1颗"，就不会通过此严格判定。
function classifyCriticalEffect(recipe: FlattenedRecipe | null, evaluated: EvaluatedExpression): CriticalEffect | null {
  if (!recipe || recipe.modifierConstant !== 0 || recipe.recipes.length !== 1 || evaluated.groups.length !== 1) return null;

  const rollRecipe = recipe.recipes[0];
  const keep = rollRecipe.keep;
  const isSingleD20 = rollRecipe.sides === 20 && rollRecipe.sign === 1 && rollRecipe.count === 1 && !keep;
  const isAdvantageOrDisadvantage = rollRecipe.sides === 20
    && rollRecipe.sign === 1
    && rollRecipe.count === 2
    && keep
    && (keep.mode === 'kh' || keep.mode === 'kl')
    && keep.amount === 1;

  if (!isSingleD20 && !isAdvantageOrDisadvantage) return null;

  // kh/kl时只读取没有discarded标记的最终保留骰；单D20自然也只有这唯一一颗。
  const keptRoll = evaluated.groups[0].rolls.find((roll) => !roll.discarded);
  if (keptRoll?.value === 20) return 'success';
  if (keptRoll?.value === 1) return 'failure';
  return null;
}

// 背景飘动余烬火星的固定参数（避免每次渲染重新随机导致动效跳动）
const EMBER_PARTICLES = [
  { left: '8%', size: '3px', duration: '9s', delay: '0s' },
  { left: '22%', size: '2px', duration: '11s', delay: '2s' },
  { left: '38%', size: '3px', duration: '8s', delay: '4s' },
  { left: '55%', size: '2px', duration: '10s', delay: '1s' },
  { left: '68%', size: '3px', duration: '12s', delay: '3s' },
  { left: '82%', size: '2px', duration: '9s', delay: '5s' },
  { left: '93%', size: '3px', duration: '11s', delay: '2.5s' },
];

// 全屏浮尘粒子固定参数（营造空气中悬浮光尘的电影质感，铺满整个屏幕，比余烬更细密安静）
const DUST_PARTICLES = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 41 + 7) % 100}%`,
  top: `${(i * 29 + 13) % 100}%`,
  size: 1 + (i % 3),
  dx: `${((i % 5) - 2) * 18}px`,
  dy: `${-30 - (i % 4) * 15}px`,
  duration: `${10 + (i % 6) * 2}s`,
  delay: `${(i % 8) * 0.8}s`,
  opacity: 0.25 + (i % 3) * 0.1,
}));

// 按当前回合角色阵营切换的背景主题色
// player=玩家回合(冷静的蓝) enemy=怪物回合(危险的红) npc=NPC回合(中性的绿)
const TURN_THEMES = {
  player: {
    glow1: 'rgba(37, 99, 235, 0.18)',
    glow2: 'rgba(56, 189, 248, 0.14)',
    line: 'rgba(59, 130, 246, 0.4)',
    ember: '#38bdf8',
    emberGlow: 'rgba(56, 189, 248, 0.7)',
  },
  enemy: {
    glow1: 'rgba(220, 38, 38, 0.2)',
    glow2: 'rgba(251, 146, 60, 0.12)',
    line: 'rgba(239, 68, 68, 0.45)',
    ember: '#f87171',
    emberGlow: 'rgba(248, 113, 113, 0.7)',
  },
  npc: {
    glow1: 'rgba(5, 150, 105, 0.18)',
    glow2: 'rgba(45, 212, 191, 0.12)',
    line: 'rgba(16, 185, 129, 0.4)',
    ember: '#34d399',
    emberGlow: 'rgba(52, 211, 153, 0.7)',
  },
  // 无人在战斗中时的默认中性主题
  default: {
    glow1: 'rgba(120, 53, 15, 0.15)',
    glow2: 'rgba(120, 53, 15, 0.15)',
    line: 'rgba(180, 83, 9, 0.3)',
    ember: '#fbbf24',
    emberGlow: 'rgba(251, 191, 36, 0.7)',
  },
} as const;

// 主屏幕状态文字标签堆叠：纵向排列，悬浮在卡片正上方留出明显间距（不贴着卡片边缘），
// 比遥控器上的版本字号更大更醒目，因为这是给所有人看的展示屏。纯文字，不用emoji。
// 由近到远从下往上堆叠（离卡片最近的在最下面）。
const StatusLabelStack = ({ statuses, isCurrent = false }: { statuses?: CharacterStatusInstance[]; isCurrent?: boolean }) => {
  const list = statuses || [];
  if (list.length === 0 && !isCurrent) return null;
  return (
    <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-3 z-30 flex flex-col-reverse items-center gap-1.5 pointer-events-none">
      {isCurrent && (
        <div className="text-red-500 text-4xl leading-none animate-bounce-slow drop-shadow-[0_0_6px_rgba(239,68,68,0.85)]">
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
            className={`px-3 py-1 rounded-full text-sm font-bold whitespace-nowrap border-2 shadow-lg text-white ${
              s.statusId === 'dying' ? 'status-badge-dying' : ''
            }`}
            style={{ backgroundColor: `${def.color}dd`, borderColor: def.color, boxShadow: `0 0 10px ${def.color}99` }}
          >
            {def.name}{suffix}
          </div>
        );
      })}
    </div>
  );
};

// 角色卡片组件（高级质感版）
const BG3CharacterCard = ({ 
  char, 
  isCurrent,
  isEntering = false,
  isLeaving = false,
  dimIntensity = DEFAULT_DIM_INTENSITY,
}: { 
  char: Character; 
  isCurrent: boolean;
  isEntering?: boolean;
  isLeaving?: boolean;
  dimIntensity?: number;
}) => {
  // 阵营默认配色，除非角色设置了自定义边框色（borderColor）
  const theme = TYPE_THEME[char.type];
  const borderColor = char.borderColor || theme.border;
  // 每一种活跃的状态都各自渲染一个专属的环绕动效（不再只挑一个"主要"效果）
  const activeEffects = getAllCardEffects(char.statuses || []);
  // 非当前回合角色：整体压暗+去饱和+轻微缩小，把视觉焦点让给当前回合角色。
  // 压暗强度由遥控器上的滑块(0~1)控制：0=完全不灰，1=特别灰，按比例插值出灰度/亮度/饱和度/透明度。
  const isDimmed = !isCurrent;
  const t = Math.max(0, Math.min(1, dimIntensity));
  const dimOpacity = 1 - t * 0.45; // 1 -> 0.55
  const dimGrayscale = t * 0.55; // 0 -> 0.55
  const dimBrightness = 1 - t * 0.38; // 1 -> 0.62
  const dimSaturate = 1 - t * 0.25; // 1 -> 0.75

  return (
    <div
      className={`relative flex-shrink-0 transition-all duration-700 ease-out ${
        isEntering ? 'animate-slideInUp' : ''
      } ${isLeaving ? 'animate-slideOutDown' : ''}`}
      style={{
        transform: `scale(${isCurrent ? 1.25 : 1}) translateY(${isCurrent ? '-12px' : '0'})`,
        opacity: isLeaving ? 0 : (isDimmed ? dimOpacity : 1),
        filter: isDimmed ? `grayscale(${dimGrayscale}) brightness(${dimBrightness}) saturate(${dimSaturate})` : 'none',
      }}
    >
      <StatusLabelStack statuses={char.statuses} isCurrent={isCurrent} />

      {/* 当前回合：优雅的指示 */}
      {isCurrent && (
        <>
          {/* 脚下法阵光环：双环反向旋转，营造仪式感/被选中的视觉焦点 */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-0 pointer-events-none"
            style={{ bottom: '-6px', width: 180, height: 180 }}
          >
            <svg viewBox="0 0 100 100" className="absolute inset-0 animate-rune-spin" style={{ opacity: 0.55 }}>
              <circle cx="50" cy="50" r="46" fill="none" stroke={borderColor} strokeWidth="0.6" strokeDasharray="4 3" />
              <circle cx="50" cy="50" r="38" fill="none" stroke={borderColor} strokeWidth="0.4" opacity="0.6" />
            </svg>
            <svg viewBox="0 0 100 100" className="absolute inset-0 animate-rune-spin-reverse" style={{ opacity: 0.4 }}>
              <polygon points="50,6 88,74 12,74" fill="none" stroke={borderColor} strokeWidth="0.5" />
              <polygon points="50,94 12,26 88,26" fill="none" stroke={borderColor} strokeWidth="0.4" opacity="0.7" />
            </svg>
          </div>

          {/* 脚下聚光光柱：从角色位置向上升起的锥形光束 */}
          <div
            className="absolute left-1/2 -translate-x-1/2 z-0 pointer-events-none animate-beam-pulse"
            style={{
              bottom: '0px',
              width: 90,
              height: 260,
              background: `linear-gradient(to top, ${borderColor}55, ${borderColor}14 40%, transparent 80%)`,
              clipPath: 'polygon(35% 100%, 65% 100%, 100% 0%, 0% 0%)',
            }}
          />

          {/* 底部发光 - 跟随阵营/自定义边框色 */}
          <div
            className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-full h-2 blur-md"
            style={{ background: `linear-gradient(to right, transparent, ${borderColor}, transparent)` }}
          />
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-1 blur-sm" style={{ backgroundColor: `${borderColor}cc` }} />
        </>
      )}
      
      {/* 卡片容器 */}
      <div className="relative z-10">
        {/* 先攻值徽章 - 缩小 */}
        <div className="absolute -top-2 -left-2 z-20">
          <div
            className="relative w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 border"
            style={
              isCurrent
                ? { background: `linear-gradient(135deg, ${borderColor}, ${borderColor}cc)`, color: '#fff', borderColor: 'transparent', boxShadow: `0 2px 8px ${borderColor}66` }
                : { backgroundColor: 'rgba(30,41,59,0.9)', color: `${borderColor}cc`, borderColor: `${borderColor}33` }
            }
          >
            {Math.floor(char.initiative)}
            {/* 内光 */}
            {isCurrent && (
              <div className="absolute inset-0 rounded-full bg-gradient-to-t from-white/20 to-transparent" />
            )}
          </div>
        </div>
        
        {/* 类型标签 - 缩小并降低透明度，跟随阵营配色（不随自定义边框色变化，始终反映真实阵营） */}
        <div className="absolute -top-1 -right-1 z-20">
          <div
            className="px-1.5 py-0.5 rounded text-[10px] font-medium backdrop-blur-sm border transition-all duration-300 text-white"
            style={{ backgroundColor: theme.tagBg, borderColor: theme.tagBorder }}
          >
            {theme.label}
          </div>
        </div>
        
        {/* 状态环绕动效容器：不能有overflow-hidden，否则粒子会被卡片边界裁掉。
            z-40明确高于下方主卡片(卡片图片是不透明的)，确保动效浮在图片前面而不是被挡在图片背后。 */}
        <div className="relative">
          <div className="absolute inset-0 z-40 pointer-events-none">
            {activeEffects.map((fx) => (
              <StatusAura key={fx.effect} effect={fx.effect} color={fx.color} scale={1.8} />
            ))}
          </div>
          {/* 主卡片：只读展示不可交互 */}
          <div
            className="relative w-32 h-48 rounded-lg overflow-hidden transition-all duration-500 border-2"
            style={{
              borderColor: isCurrent ? borderColor : `${borderColor}80`,
              boxShadow: isCurrent ? `0 20px 40px -10px ${borderColor}80` : '0 8px 20px -4px rgba(0,0,0,0.4)',
            }}
          >
          {/* 卡片边框 - 使用渐变和内阴影，跟随阵营/自定义边框色 */}
          <div
            className="absolute inset-0 rounded-lg transition-all duration-500"
            style={{
              background: isCurrent
                ? `linear-gradient(180deg, ${borderColor}33, transparent, ${borderColor}4d)`
                : `linear-gradient(180deg, ${borderColor}1a, transparent, rgba(30,41,59,0.2))`,
            }}
          />
          
          <div
            className="absolute inset-[2px] rounded-lg overflow-hidden border transition-all duration-500"
            style={{
              borderColor: isCurrent ? `${borderColor}66` : 'rgba(51,65,85,0.6)',
              background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.99) 100%)',
            }}
          >
            {/* 背景图片：当前回合角色额外叠加呼吸动效(缓慢放大+提亮再回落)，让焦点角色更"活" */}
            {char.imageUrl && (
              <div className="absolute inset-0">
                <img 
                  src={char.imageUrl} 
                  alt={char.name}
                  className={`absolute inset-0 w-full h-full object-cover ${isCurrent ? 'animate-portrait-breathe' : ''}`}
                  style={{ 
                    imageRendering: 'pixelated',
                    filter: isCurrent 
                      ? 'brightness(1.1) contrast(1.1) saturate(1.05)' 
                      : 'brightness(0.92) contrast(1.02)',
                  }}
                />
                {/* 精致的渐变遮罩 */}
                <div className={`absolute inset-0 transition-all duration-500 ${
                  isCurrent 
                    ? 'bg-gradient-to-t from-slate-950/95 via-slate-900/40 to-transparent' 
                    : 'bg-gradient-to-t from-slate-950/98 via-slate-900/50 to-transparent'
                }`} />
              </div>
            )}
            
            {/* Token（如果没有图片，也用于自定义生物的长文字"当图片"，自动缩小字号避免溢出）
                当前回合同样叠加呼吸动效，和有图片的角色保持一致的视觉语言 */}
            {!char.imageUrl && (
              <div className="absolute inset-0 flex items-center justify-center px-2">
                <div className={`${getTokenFontSizeClass(char.token)} opacity-90 text-center leading-tight break-all ${isCurrent ? 'animate-portrait-breathe' : ''}`}>
                  {char.token}
                </div>
              </div>
            )}
            
            {/* 当前回合：顶部微光 */}
            {isCurrent && (
              <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{ background: `linear-gradient(to right, transparent, ${borderColor}66, transparent)` }}
              />
            )}

          </div>
          </div>
        </div>

        {/* 名字放在卡片外面下方：固定宽度跟随卡片(w-32)，超长名字换行最多两行+省略，
            不会无限撑开撐乱flex布局导致整行卡片挤歪 */}
        <div className="mt-2.5 w-32 mx-auto">
          <div
            className={`font-black text-center leading-tight transition-all duration-500 px-1 line-clamp-2 break-words ${
              isCurrent ? 'text-2xl' : 'text-xl text-slate-200'
            }`}
            style={isCurrent ? { color: borderColor, filter: `drop-shadow(0 0 10px ${borderColor}bb)` } : undefined}
          >
            {char.name}
          </div>
        </div>
      </div>
    </div>
  );
};

// 房间列表接口返回的条目：/api/rooms
interface RoomSummary {
  roomId: string;
  characterCount: number;
  roundNumber: number;
  displayConnected: boolean;
  lastActivity: number;
}

function InitiativeDisplayPageInner() {
  const searchParams = useSearchParams();
  const paramRoomId = searchParams.get('room');
  
  const [roomId, setRoomId] = useState('');
  const [roomState, setRoomState] = useState<RoomState>({
    roomId: '',
    characters: [],
    currentTurn: 0,
    roundNumber: 1,
  });

  const [enteringCharIds, setEnteringCharIds] = useState<Set<string>>(new Set());
  const [leavingCharIds, setLeavingCharIds] = useState<Set<string>>(new Set());
  const [prevCharacterIds, setPrevCharacterIds] = useState<Set<string>>(new Set());

  // ===== 3D掷骰：主屏幕当骰盘用，铺满全屏播放投掷动画，结果出来后停留几秒再自动收起 =====
  const [diceRollRequest, setDiceRollRequest] = useState<DiceRollRequest | null>(null);
  const [diceOverlayVisible, setDiceOverlayVisible] = useState(false); // 控制淡入淡出的全屏遮罩
  const [diceLastResult, setDiceLastResult] = useState<DiceRollResult | null>(null);
  // 这一轮投掷如果带了自定义表达式配方(kh/kl等)，摇完后按配方+原始点数重新算出的明细结果，
  // 用于结果面板展示"哪颗被丢弃"，以及算出该给3D场景里哪几颗骰子加发光描边(highlights)
  const [diceCustomEval, setDiceCustomEval] = useState<EvaluatedExpression | null>(null);
  const [diceHighlights, setDiceHighlights] = useState<DiceHighlight[]>([]);
  // 只由严格的纯D20判定产生：success=自然20，failure=自然1；会在新投掷、重投及收起时更新。
  const [criticalEffect, setCriticalEffect] = useState<CriticalEffect | null>(null);
  // 记住这一轮投掷请求带的配方，摇完拿到结果后才用得上；发起新一轮投掷/收起时清空
  const pendingRecipeRef = useRef<FlattenedRecipe | null>(null);
  // 只有手动收起后的700ms淡出卸载定时器；骰盘不再设置自动隐藏倒计时。
  const diceUnmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 单颗骰子重投："这一次投掷里，哪些骰子(全局id)已经用过唯一一次重投机会"——
  // 绑定当前这次投掷(diceRollRequest.id)，新的一次DICE_ROLL一来就清空，不会跨投掷保留。
  // 主屏幕是这份状态真正的权威来源：算完新点数后通过DICE_DIE_REROLL_RESULT广播出去，
  // 所有遥控器都跟着这份广播刷新，不会因为两台遥控器各自维护状态而互相不一致。
  const [rerolledDieIds, setRerolledDieIds] = useState<Set<number>>(new Set());
  const [diceRerollRequest, setDiceRerollRequest] = useState<DiceRerollRequest | null>(null);
  // 引擎的原始摇骰结果需要留一份最新快照，重投单颗骰子后要用"全部骰子的最新点数"重新跑一遍
  // evaluateRecipe——不能只改被重投的这一颗的显示值，否则kh/kl的总和和高亮会跟实际不一致。
  const diceEngineResultRef = useRef<DiceRollResult | null>(null);
  // 主屏是重投旧值/新值的权威来源，记录完整审计数组再广播给所有遥控器。
  const diceRerollHistoryRef = useRef<DiceRerollHistoryItem[]>([]);

  // 房间号复制按钮：点击后短暂显示"✓"反馈，1.5秒后恢复成复制图标
  const [roomIdCopied, setRoomIdCopied] = useState(false);
  const handleCopyRoomId = useCallback(() => {
    if (!roomId) return;
    navigator.clipboard.writeText(roomId).then(() => {
      setRoomIdCopied(true);
      setTimeout(() => setRoomIdCopied(false), 1500);
    }).catch(() => {
      // 极少数浏览器/环境下clipboard API不可用，静默失败即可，不影响主屏幕主要功能
    });
  }, [roomId]);

  // 二维码固定使用正式遥控器地址；二维码中的 room 参数会让遥控器页面自动加入当前房间。
  const remoteJoinUrl = roomId
    ? `https://box.dsqqlb.top/tools/initiative-tracker?room=${encodeURIComponent(roomId)}`
    : '';
  const roomQrCodeUrl = remoteJoinUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(remoteJoinUrl)}`
    : '';
  // 没有记录房间号在URL里，就展示"还在跑的房间"列表，可以选择回到原来的房间，或者新建一个）。
  // null=还没决定要不要展示（等/api/rooms请求结果），true=展示选择器，false=已经决定好房间号了
  const [showPicker, setShowPicker] = useState<boolean | null>(paramRoomId ? false : null);
  const [roomList, setRoomList] = useState<RoomSummary[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  // 生成6位数字房间ID
  function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 把房间号写入URL并激活连接（不管是选了已有房间还是新建的房间，都走这个函数）
  function activateRoom(id: string) {
    setRoomId(id);
    setShowPicker(false);
    const url = new URL(window.location.href);
    url.searchParams.set('room', id);
    window.history.replaceState({}, '', url.toString());
  }

  // 初始化房间ID（客户端）：
  // - URL带了房间号：直接用它连（刷新页面/书签重连的既有行为，不受选择器影响）
  // - URL没带房间号：先拉一下"还在跑的房间"列表，展示选择器，而不是立刻生成一个新房间号，
  //   这样断线/设备没电后重新打开主屏幕，能选择回到原来的房间
  useEffect(() => {
    if (paramRoomId) {
      setRoomId(paramRoomId);
      return;
    }

    let cancelled = false;
    setPickerLoading(true);
    fetch('/api/rooms', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`获取房间列表失败: ${res.status}`);
        return res.json();
      })
      .then((list: RoomSummary[]) => {
        if (cancelled) return;
        setRoomList(list);
        setShowPicker(true);
        setPickerLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('❌ 获取房间列表失败:', err);
        setPickerError(err.message);
        setPickerLoading(false);
        // 房间列表拿不到（比如接口暂时挂了），不能卡在这里，直接退回"新建房间"这条老路
        activateRoom(generateRoomId());
      });

    return () => {
      cancelled = true;
    };
  }, [paramRoomId]);

  // WebSocket地址：优先用环境变量，否则自动跟随当前访问的主机名（局域网/公网设备都能连上同一台服务器）
  // 选择器展示期间roomId还是空的，不会触发连接
  const wsUrl = roomId ? getWsUrl() : null;
  
  const { isConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      console.log('📩 主屏收到消息:', message.type, message.payload);
      
      if (message.type === 'ROOM_STATE') {
        console.log('✅ 更新房间状态:', message.payload);
        setRoomState(message.payload);
      } else if (message.type === 'DICE_ROLL') {
        // 遥控器发起了一次掷骰：铺满全屏，触发3D动画。
        // rollRequest.id变化时DiceRoller组件才会真正触发新的一次投掷（见DiceRoller内部判重逻辑）。
        // 新一轮投掷只需取消可能正在淡出的旧场景。
        if (diceUnmountTimerRef.current) clearTimeout(diceUnmountTimerRef.current);
        setDiceLastResult(null);
        setDiceCustomEval(null);
        setDiceHighlights([]);
        setCriticalEffect(null);
        setRerolledDieIds(new Set()); // 新一轮投掷，"已用过重投机会"的记录清空重来
        setDiceRerollRequest(null);
        diceEngineResultRef.current = null;
        diceRerollHistoryRef.current = [];
        pendingRecipeRef.current = message.payload.recipe || null;
        setDiceOverlayVisible(true);
        setDiceRollRequest({
          id: message.payload.id,
          notation: message.payload.notation,
          shapeTextures: message.payload.shapeTextures,
          recipe: message.payload.recipe,
        });
      } else if (message.type === 'DICE_DIE_REROLL') {
        // 一个请求可以包含多颗骰子：主屏幕作为权威方，过滤掉无效、已重投或重复的id后一次性动画。
        const { rollId, requestId, dieIds } = message.payload;
        if (!diceRollRequest || diceRollRequest.id !== rollId || !diceEngineResultRef.current) return;
        const validIds = new Set(
          diceEngineResultRef.current.sets.flatMap((set) => (set.rolls || []).map((roll) => roll.id)),
        );
        const acceptedDieIds = [...new Set(Array.isArray(dieIds) ? dieIds : [])]
          .filter((dieId) => validIds.has(dieId) && !rerolledDieIds.has(dieId));
        if (!acceptedDieIds.length) return;
        // 新一段重投动画开始时先清除旧的临界结果；完成后按最新保留骰重新判定。
        setCriticalEffect(null);
        setDiceRerollRequest({ requestId, dieIds: acceptedDieIds });
      } else if (message.type === 'DICE_ROLL_DISMISS') {
        // 只有当前这一轮的明确收起操作才可以关闭骰盘，避免旧消息误关新一轮。
        if (!diceRollRequest || message.payload.id !== diceRollRequest.id) return;
        if (diceUnmountTimerRef.current) clearTimeout(diceUnmountTimerRef.current);
        setDiceOverlayVisible(false);
        diceUnmountTimerRef.current = setTimeout(() => {
          setDiceRollRequest(null);
          setDiceLastResult(null);
          setDiceCustomEval(null);
          setDiceHighlights([]);
          setCriticalEffect(null);
          setRerolledDieIds(new Set());
          setDiceRerollRequest(null);
          diceEngineResultRef.current = null;
          pendingRecipeRef.current = null;
        }, 700);
      } else if (message.type === 'ERROR') {
        console.error('❌ 服务器错误:', message.payload.message);
      }
    },
    onOpen: () => {
      console.log('🎉 主屏WebSocket连接成功');
      // 连接成功后创建房间
      if (roomId) {
        console.log('📤 发送CREATE_ROOM:', roomId);
        sendMessage({
          type: 'CREATE_ROOM',
          payload: { roomId },
        });
      }
    },
    onClose: () => {
      console.log('👋 主屏WebSocket断开');
    },
    onError: (error) => {
      console.error('❌ 主屏WebSocket错误:', error);
    },
  });

  // 重新连接（刷新页面）
  const handleReconnect = () => {
    window.location.reload();
  };

  // 3D骰子动画播放完毕：把结构化结果广播回房间（遥控器据此展示文字结果），
  // 并在这块屏幕上也停留展示几秒结果，然后自动收起遮罩，露出下面的战斗区
  const handleDiceRollComplete = useCallback((result: DiceRollResult) => {
    if (!diceRollRequest) return;
    setDiceLastResult(result);
    diceEngineResultRef.current = result; // 留一份快照，重投单颗骰子后要用最新的全部点数重新计算

    // 如果这次投掷带了自定义表达式配方(kh/kl等)，用摇出的原始点数(sets[].rolls)重新算一遍明细，
    // 算出哪些骰子被丢弃、真正的总和，并据此决定该给哪几颗骰子加发光描边(kh=金边，kl=红边)
    if (pendingRecipeRef.current) {
      const engineSets: EngineResultSet[] = result.sets.map((s) => ({ sides: s.sides, rolls: s.rolls || [] }));
      const evaluated = evaluateRecipe(pendingRecipeRef.current, engineSets);
      setDiceCustomEval(evaluated);
      setDiceHighlights(computeHighlights(evaluated));
      setCriticalEffect(classifyCriticalEffect(pendingRecipeRef.current, evaluated));
    } else {
      setDiceCustomEval(null);
      setDiceHighlights([]);
      setCriticalEffect(null);
    }

    if (roomId) {
      sendMessage({
        type: 'DICE_ROLL_RESULT',
        payload: { roomId, id: diceRollRequest.id, notation: diceRollRequest.notation, result },
      });
    }

    // 骰盘与结果会持续显示，直到遥控器发送 DICE_ROLL_DISMISS；不再建立自动收起倒计时。
  }, [diceRollRequest, roomId, sendMessage]);

  // 批量重投动画播完：用全部最新点数重新计算总和、kh/kl和高亮，再一次性广播给所有遥控器。
  // evaluateRecipe(如果这次投掷带kh/kl配方)，因为重投可能改变取高/取低的筛选结果(比如把原本
  // 该丢弃的那颗换成了更大的点数，它就该变成被保留的那颗)。算完把新结果+"已用过"列表广播出去，
  // 所有客户端(包括发起重投的遥控器和主屏幕自己)都据此同步刷新。
  const handleDieRerollComplete = useCallback((requestId: string, completedDice: { dieId: number; value: number }[]) => {
    if (!diceRollRequest || !diceEngineResultRef.current) return;
    const prevResult = diceEngineResultRef.current;
    const rerollBatch: DiceRerollHistoryItem[] = completedDice.flatMap(({ dieId, value: to }) => {
      for (const set of prevResult.sets) {
        const roll = set.rolls?.find((candidate) => candidate.id === dieId);
        if (roll) return [{ dieId, sides: set.sides, from: roll.value, to }];
      }
      return [];
    });
    diceRerollHistoryRef.current = [...diceRerollHistoryRef.current, ...rerollBatch];
    const valueByDieId = new Map(completedDice.map(({ dieId, value }) => [dieId, value]));

    const newSets = prevResult.sets.map((set) => {
      const rolls = set.rolls?.map((roll) => {
        const value = valueByDieId.get(roll.id);
        return value === undefined ? roll : { ...roll, value };
      });
      const total = rolls ? rolls.reduce((sum, roll) => sum + roll.value, 0) : set.total;
      return { ...set, rolls, total };
    });
    const newTotal = newSets.reduce((sum, set) => sum + set.total, 0) + prevResult.modifier;
    const newResult: DiceRollResult = { ...prevResult, sets: newSets, total: newTotal };

    diceEngineResultRef.current = newResult;
    setDiceLastResult(newResult);

    const nextRerolledIds = new Set(rerolledDieIds);
    completedDice.forEach(({ dieId }) => nextRerolledIds.add(dieId));
    setRerolledDieIds(nextRerolledIds);
    setDiceRerollRequest(null);

    if (pendingRecipeRef.current) {
      const engineSets: EngineResultSet[] = newResult.sets.map((set) => ({ sides: set.sides, rolls: set.rolls || [] }));
      const evaluated = evaluateRecipe(pendingRecipeRef.current, engineSets);
      setDiceCustomEval(evaluated);
      setDiceHighlights(computeHighlights(evaluated));
      setCriticalEffect(classifyCriticalEffect(pendingRecipeRef.current, evaluated));
    } else {
      setCriticalEffect(null);
    }

    if (roomId) {
      sendMessage({
        type: 'DICE_DIE_REROLL_RESULT',
        payload: {
          roomId,
          id: diceRollRequest.id,
          requestId,
          notation: diceRollRequest.notation,
          result: newResult,
          rerolledDieIds: Array.from(nextRerolledIds),
          rerolls: diceRerollHistoryRef.current,
        },
      });
    }
  }, [diceRollRequest, roomId, sendMessage, rerolledDieIds]);

  // 组件卸载时清理掷骰相关的定时器，避免卸载后还触发setState
  useEffect(() => {
    return () => {
      if (diceUnmountTimerRef.current) clearTimeout(diceUnmountTimerRef.current);
    };
  }, []);

  // 检测角色进出场
  useEffect(() => {
    const currentIds = new Set(roomState.characters.map(c => c.id));
    
    // 检测新进入的角色
    const entering = new Set<string>();
    currentIds.forEach(id => {
      if (!prevCharacterIds.has(id)) {
        entering.add(id);
      }
    });
    
    // 检测离开的角色
    const leaving = new Set<string>();
    prevCharacterIds.forEach(id => {
      if (!currentIds.has(id)) {
        leaving.add(id);
      }
    });
    
    if (entering.size > 0) {
      setEnteringCharIds(entering);
      setTimeout(() => setEnteringCharIds(new Set()), 800);
    }
    
    if (leaving.size > 0) {
      setLeavingCharIds(leaving);
      setTimeout(() => setLeavingCharIds(new Set()), 800);
    }
    
    // 只有当角色真的变化时才更新
    if (entering.size > 0 || leaving.size > 0) {
      setPrevCharacterIds(currentIds);
    }
  }, [roomState.characters, prevCharacterIds]);

  const sortedCharacters = roomState.characters.sort((a, b) => b.initiative - a.initiative);
  
  // 根据当前回合角色的阵营，决定背景主题色
  const currentChar = sortedCharacters[roomState.currentTurn];
  const theme = currentChar ? TURN_THEMES[currentChar.type] : TURN_THEMES.default;

  // 房间选择器：只在URL没带房间号时出现（首次打开主屏幕，或者断线/设备没电后重新打开）。
  // 展示"服务器上还活着的房间"，可以选择回到之前的战斗，也可以直接新建一个空房间。
  if (showPicker === null || showPicker === true) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-radial from-slate-900 via-slate-950 to-black" />
        <div className="relative z-10 w-full max-w-2xl bg-slate-900/70 backdrop-blur-xl rounded-2xl border border-amber-600/30 shadow-2xl p-8">
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 mb-2">
            选择房间
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            服务还在跑的战斗房间列在下面，可以直接回到原来的战斗，或者新建一个。
          </p>

          {showPicker === null || pickerLoading ? (
            <div className="text-slate-500 text-center py-10">正在查询服务器上的房间...</div>
          ) : (
            <>
              {pickerError && (
                <div className="text-red-400 text-sm mb-4">获取房间列表失败：{pickerError}</div>
              )}

              {roomList.length === 0 ? (
                <div className="text-slate-500 text-center py-6 mb-4 bg-slate-800/40 rounded-xl">
                  服务器上目前没有活跃的房间
                </div>
              ) : (
                <div className="space-y-2 mb-6 max-h-80 overflow-y-auto">
                  {roomList.map((room) => (
                    <button
                      key={room.roomId}
                      onClick={() => activateRoom(room.roomId)}
                      className="w-full flex items-center justify-between gap-4 px-5 py-3.5 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 hover:border-amber-500/50 transition-all text-left"
                    >
                      <div>
                        <div className="text-2xl font-black font-mono text-amber-400 tracking-wider">
                          {room.roomId}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {room.characterCount} 名角色 · 第 {room.roundNumber} 回合
                          {room.displayConnected && <span className="text-emerald-500"> · 主屏在线</span>}
                        </div>
                      </div>
                      <div className="text-amber-400 text-sm font-bold whitespace-nowrap">回到这个房间 →</div>
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => activateRoom(generateRoomId())}
                className="w-full px-6 py-3.5 rounded-xl font-bold text-white shadow-lg hover:scale-[1.02] transition-all"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
              >
                + 新建房间
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col overflow-hidden relative">
      {/* 高级背景 - 战场紧张感，随当前回合阵营变换色调 */}
      <div className="absolute inset-0">
        {/* 深色径向渐变 */}
        <div className="absolute inset-0 bg-gradient-radial from-slate-900 via-slate-950 to-black" />
        
        {/* 呼吸感警示光晕（随回合阵营变色，缓慢明暗，颜色渐变过渡） */}
        <div 
          className="absolute top-0 left-1/4 w-96 h-96 rounded-full filter blur-[120px] animate-tension-pulse transition-colors duration-1000"
          style={{ backgroundColor: theme.glow1 }}
        />
        <div 
          className="absolute bottom-0 right-1/4 w-96 h-96 rounded-full filter blur-[120px] animate-tension-pulse transition-colors duration-1000"
          style={{ backgroundColor: theme.glow2, animationDelay: '2s' }}
        />
        
        {/* 缓慢平移的战术网格 */}
        <div className="absolute inset-0 opacity-[0.035] animate-grid-drift" style={{
          backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.06) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
        
        {/* 飘动余烬火星（随回合阵营变色） */}
        {EMBER_PARTICLES.map((ember, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-ember-float transition-colors duration-1000"
            style={{
              left: ember.left,
              bottom: '-10px',
              width: ember.size,
              height: ember.size,
              backgroundColor: theme.ember,
              boxShadow: `0 0 6px 1px ${theme.emberGlow}`,
              animationDuration: ember.duration,
              animationDelay: ember.delay,
            }}
          />
        ))}
        
        {/* 顶部光晕（随回合阵营变色） */}
        <div 
          className="absolute top-0 left-0 right-0 h-px transition-colors duration-1000"
          style={{ background: `linear-gradient(to right, transparent, ${theme.line}, transparent)` }}
        />

        {/* 全屏浮尘粒子：细密、安静地漂浮，增加空气感和纵深感 */}
        {DUST_PARTICLES.map((d, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white animate-dust-float"
            style={{
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              '--dust-x': d.dx,
              '--dust-y': d.dy,
              '--dust-duration': d.duration,
              '--dust-opacity': d.opacity,
              animationDelay: d.delay,
            } as React.CSSProperties}
          />
        ))}

        {/* 暗角运镜：四角压暗，把视觉焦点收拢到画面中央的战斗区域 */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)' }}
        />

        {/* HUD科技边角框：四角呼吸式微光装饰，营造广播级战况面板感 */}
        {[
          { pos: 'top-6 left-6', border: 'border-t-2 border-l-2' },
          { pos: 'top-6 right-6', border: 'border-t-2 border-r-2' },
          { pos: 'bottom-6 left-6', border: 'border-b-2 border-l-2' },
          { pos: 'bottom-6 right-6', border: 'border-b-2 border-r-2' },
        ].map((corner, i) => (
          <div
            key={i}
            className={`absolute ${corner.pos} w-16 h-16 ${corner.border} animate-hud-corner transition-colors duration-1000`}
            style={{ borderColor: theme.line }}
          />
        ))}
      </div>
      
      {/* WebSocket连接状态 */}
      {!isConnected && (
        <div className="absolute top-6 right-6 z-50">
          <div className="bg-red-950/90 backdrop-blur-xl rounded-xl px-6 py-4 border-2 border-red-700/60 shadow-2xl animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse shadow-lg shadow-red-500/50" />
              <div className="text-red-300 text-lg font-black">连接已断开</div>
            </div>
            <div className="text-red-400/90 text-sm mb-3 leading-relaxed">
              WebSocket连接丢失<br/>
              房间数据可能不同步
            </div>
            <button
              onClick={handleReconnect}
              className="w-full px-4 py-2 rounded-lg font-bold text-sm bg-red-600 hover:bg-red-500 text-white transition-all shadow-lg hover:shadow-xl hover:scale-105"
            >
              🔄 刷新重连
            </button>
          </div>
        </div>
      )}
      
      {/* 房间ID与二维码；二维码会直达带房间号的遥控器链接。 */}
      {roomState.displayRoomInfoVisible !== false && (
        <>
      {sortedCharacters.length === 0 ? (
        /* 无角色时：大显示房间号（唯一一处显示，之前"等待玩家加入战斗"文案下面还重复显示了一次，
           已经删掉，避免同一个房间号在屏幕上出现两次）。右上角加一个复制按钮，点击直接拷贝房间号。 */
        <div className="absolute top-8 left-8 z-50">
          <div className="relative bg-slate-900/60 backdrop-blur-xl rounded-xl px-6 py-4 pr-4 border border-slate-700/50 shadow-2xl flex items-center gap-5" style={{ transform: `scale(${roomState.roomInfoScale ?? DEFAULT_ROOM_INFO_SCALE})`, transformOrigin: 'top left' }}>
            <div>
              <div className="text-slate-400 text-xs mb-1.5 font-medium tracking-wider uppercase">房间号</div>
              <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 tracking-wider font-mono">
                {roomId || '---'}
              </div>
              {roomId && (
                <button
                  onClick={handleCopyRoomId}
                  title="复制房间号"
                  className="mt-2 w-8 h-8 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-slate-600/50 flex items-center justify-center text-slate-300 hover:text-amber-400 transition-colors"
                >
                  {roomIdCopied ? <span className="text-emerald-400 text-sm">✓</span> : <span className="text-xs">复制</span>}
                </button>
              )}
            </div>
            {roomQrCodeUrl && (
              <div className="rounded-lg bg-white p-1.5 shadow-lg">
                <img src={roomQrCodeUrl} alt="扫描加入当前房间" width={96} height={96} className="w-24 h-24" />
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* 有角色时：左上角小房间号 */}
          <div className="absolute top-6 left-6 z-50">
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-lg px-3 py-2 border border-slate-700/50 shadow-xl flex items-center gap-2" style={{ transform: `scale(${roomState.roomInfoScale ?? DEFAULT_ROOM_INFO_SCALE})`, transformOrigin: 'top left' }}>
              <div>
                <div className="text-slate-500 text-[10px] mb-0.5 font-medium tracking-wider uppercase">Room</div>
                <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 tracking-wider font-mono">
                  {roomId}
                </div>
              </div>
              {roomQrCodeUrl && (
                <div className="rounded bg-white p-1">
                  <img src={roomQrCodeUrl} alt="扫描加入当前房间" width={56} height={56} className="w-14 h-14" />
                </div>
              )}
            </div>
          </div>
        </>
      )}
        </>
      )}

      {/* 回合数独立于房间信息面板：即使房间号/二维码被隐藏，仍可单独展示。 */}
      {roomState.displayRoundVisible !== false && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50">
          <div className="bg-slate-900/60 backdrop-blur-xl rounded-xl px-8 py-3 border border-amber-600/30 shadow-2xl">
            <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 text-center tracking-wide">
              第 {roomState.roundNumber} 回合
            </div>
          </div>
        </div>
      )}

      {/* 主战斗区域 */}
      <div className="flex-1 flex items-center justify-center p-4 relative z-10 overflow-hidden">
        {sortedCharacters.length === 0 ? (
          <div className="text-center">
            <div className="text-7xl mb-8">⚔️</div>
            <div className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-slate-400 via-amber-400 to-slate-400 mb-6 tracking-wide">
              等待玩家加入战斗...
            </div>
            <div className="text-xl text-slate-500 mb-8 font-medium">
              请使用遥控器连接房间号
            </div>
            {/* 房间号已经在左上角显示（带复制按钮），这里不再重复渲染一遍，只保留提示文案 */}
            {roomId && (
              <div className="mt-2 text-slate-400 text-base font-medium">
                💡 打开遥控器页面，输入房间号即可连接
              </div>
            )}
          </div>
        ) : (
          <>
            {/* BG3样式的横向卡片条：整体向下偏移一点，避免贴着顶部回合数/房间号显得太挤 */}
            <div className="w-full flex items-center justify-center translate-y-12">
              <div
                className="relative max-w-[95vw] transition-transform duration-200"
                style={{ transform: `scale(${roomState.characterScale ?? DEFAULT_CHARACTER_SCALE})`, transformOrigin: 'center center' }}
              >
                {/* 卡片容器 */}
                <div className="flex items-center justify-center gap-6 px-4 py-8">
                  {sortedCharacters.map((char, index) => {
                    const isCurrent = index === roomState.currentTurn;
                    const isEntering = enteringCharIds.has(char.id);
                    const isLeaving = leavingCharIds.has(char.id);
                    
                    return (
                      <BG3CharacterCard
                        key={char.id}
                        char={char}
                        isCurrent={isCurrent}
                        isEntering={isEntering}
                        isLeaving={isLeaving}
                        dimIntensity={roomState.dimIntensity ?? DEFAULT_DIM_INTENSITY}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 主屏幕历史掷骰：来自房间共享状态，在初次结果和每次重投后即时更新。 */}
      {roomState.displayDiceHistoryVisible !== false && (roomState.diceHistory?.length || 0) > 0 && (
        <aside className="absolute right-6 bottom-6 z-50 w-[min(22rem,calc(100vw-3rem))] overflow-hidden rounded-xl border border-purple-500/35 bg-slate-950/80 shadow-2xl backdrop-blur-xl" style={{ transform: `scale(${roomState.diceHistoryScale ?? DEFAULT_DICE_HISTORY_SCALE})`, transformOrigin: 'bottom right' }}>
          <div className="flex items-center justify-between border-b border-purple-500/20 px-3 py-2">
            <span className="text-xs font-black tracking-widest text-purple-200">历史掷骰</span>
            <span className="text-[10px] text-slate-500">最近 {Math.min(roomState.diceHistory?.length || 0, 50)} 条</span>
          </div>
          <div className="max-h-64 divide-y divide-slate-800/90 overflow-y-auto">
            {(roomState.diceHistory || []).map((entry) => (
              <div key={entry.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-purple-100">{entry.label}</div>
                    <div className="truncate font-mono text-[11px] text-slate-400">{entry.expression}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg font-black leading-none text-amber-400">{entry.finalTotal}</div>
                    <time className="text-[10px] text-slate-500">{new Date(entry.recordedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
                  </div>
                </div>
                {entry.rerolls.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {entry.rerolls.map((reroll, index) => (
                      <span key={`${reroll.dieId}-${index}`} className="rounded border border-amber-500/25 bg-amber-500/10 px-1 py-0.5 font-mono text-[9px] text-amber-200">D{reroll.sides} {reroll.from}→{reroll.to}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 底部装饰 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800/50 to-transparent" />

      {/* 3D掷骰全屏遮罩：铺满全屏暂时盖住角色卡战斗区，投掷动画结束后停留展示结果，再自动淡出收起。
          rollRequest不为null才挂载3D场景，避免场景一直闲置在DOM里浪费GPU资源。 */}
      {diceRollRequest && (
        <div
          className={`fixed inset-0 z-[60] bg-slate-950/70 backdrop-blur-[2px] transition-opacity duration-700 ${
            diceOverlayVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <DiceRoller
            rollRequest={diceRollRequest}
            diceScale={roomState.diceDisplayScale ?? DEFAULT_DICE_DISPLAY_SCALE}
            onRollComplete={handleDiceRollComplete}
            highlights={diceHighlights}
            rerollRequest={diceRerollRequest}
            onRerollComplete={handleDieRerollComplete}
          />
        </div>
      )}

      {/* 大成功/大失败独立效果层：在3D骰盘上方、计算结果面板下方；仅严格匹配的纯D20检定会渲染。 */}
      {criticalEffect && diceOverlayVisible && (
        <div className="fixed inset-0 z-[65] pointer-events-none overflow-hidden">
          <div
            className={`absolute inset-0 transition-opacity duration-700 ${
              criticalEffect === 'success'
                ? 'bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.35),rgba(245,158,11,0.12)_34%,transparent_70%)]'
                : 'bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.38),rgba(127,29,29,0.14)_36%,transparent_70%)]'
            }`}
          />
          <div
            className={`absolute inset-0 blur-3xl animate-critical-aura ${
              criticalEffect === 'success' ? 'bg-amber-400/20' : 'bg-red-600/25'
            }`}
          />
          <div className="absolute inset-0 flex items-center justify-center pb-8">
            <div
              key={`${diceRollRequest?.id}-${criticalEffect}-${rerolledDieIds.size}`}
              className={`animate-critical-impact text-center px-8 py-6 rounded-2xl border-2 shadow-2xl backdrop-blur-sm ${
                criticalEffect === 'success'
                  ? 'border-amber-300/80 bg-amber-500/15 shadow-amber-400/40'
                  : 'border-red-400/80 bg-red-950/40 shadow-red-500/40'
              }`}
            >
              <div className={`text-xs sm:text-sm font-black tracking-[0.35em] mb-2 ${
                criticalEffect === 'success' ? 'text-amber-200' : 'text-red-200'
              }`}>
                NATURAL {criticalEffect === 'success' ? '20' : '1'}
              </div>
              <div className={`text-5xl sm:text-7xl font-black tracking-[0.12em] drop-shadow-2xl ${
                criticalEffect === 'success'
                  ? 'text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-amber-300 to-amber-500'
                  : 'text-transparent bg-clip-text bg-gradient-to-b from-red-100 via-red-400 to-red-600'
              }`}>
                {criticalEffect === 'success' ? '大成功' : '大失败'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 主屏幕独立结果层：不属于骰子遮罩、骰子画布或3D场景。
          该层直接挂在主屏幕页面根节点，固定在浏览器视口顶部正中；骰子滚动位置、画布尺寸及动画
          坐标均不会影响它。外层负责屏幕定位，动画仅作用于内部内容，避免覆盖横向居中 transform。 */}
      {diceRollRequest && diceLastResult && (
        <div
          className="fixed top-16 left-1/2 z-[70] -translate-x-1/2 pointer-events-none transition-opacity duration-700"
          style={{ opacity: diceOverlayVisible ? (roomState?.resultPanelOpacity ?? DEFAULT_RESULT_PANEL_OPACITY) : 0 }}
        >
          <div className="animate-slideInUp">
            {diceCustomEval ? (
              // 自定义表达式(带kh/kl)投掷：展示明细——每颗骰子换成形状图标(能看出D几)+数字，
              // 被丢弃的用DiceShapeIcon的'used'态变灰(视觉上跟"已重投过"共用同一套灰态，
              // 因为都表示"这颗骰子的点数不算/已经用掉机会"，不会互相混淆，两者不会同时出现在同一颗骰子上：
              // 一颗骰子如果被kh/kl丢弃了，它仍然可以被重投；重投完会重新计算kh/kl归属)。
              // 一眼看出"取最高/取最低"实际发生了什么，跟遥控器上的展示方式保持一致，只是字号更大更醒目。
              <div className="flex items-stretch bg-slate-900/95 border-2 border-purple-500/60 rounded-md shadow-2xl overflow-hidden divide-x divide-purple-500/30">
                {diceCustomEval.groups.map((g, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 px-4 py-3 min-w-[5.5rem]">
                    <div className="text-slate-400 text-xs font-mono whitespace-nowrap">
                      {i > 0 && (g.sign === -1 ? '− ' : '+ ')}
                      {g.count}D{g.sides}{g.keep ? `(${g.keep.mode === 'kh' ? '取高' : '取低'}${g.keep.amount})` : ''}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {g.rolls.map((r) => (
                        <DiceShapeIcon
                          key={r.id}
                          sides={g.sides}
                          value={r.value}
                          size={40}
                          state={r.discarded ? 'used' : rerolledDieIds.has(r.id) ? 'used' : 'idle'}
                        />
                      ))}
                    </div>
                    <div className="text-2xl font-black text-purple-200">{g.sign === -1 ? '−' : ''}{g.total}</div>
                  </div>
                ))}
                {diceCustomEval.modifier !== 0 && (
                  <div className="flex items-center px-4 py-3">
                    <span className="text-2xl font-black text-purple-200">
                      {diceCustomEval.modifier > 0 ? '+' : ''}{diceCustomEval.modifier}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 px-5 py-3 bg-amber-500/10">
                  <span className="text-purple-400 text-xl font-bold">=</span>
                  <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500">
                    {diceCustomEval.total}
                  </span>
                </div>
              </div>
            ) : (
              // 普通投掷(不涉及kh/kl)：同样把每颗骰子换成形状图标展示，用不用来区分是D几一眼可见，
              // 已重投过的骰子按DiceShapeIcon的'used'态变灰标出来。
              <div className="flex items-stretch bg-slate-900/95 border-2 border-purple-500/60 rounded-md shadow-2xl overflow-hidden divide-x divide-purple-500/30">
                {diceLastResult.sets.map((set, i) => (
                  <div key={i} className="flex flex-col items-center gap-1.5 px-4 py-3">
                    <div className="text-slate-400 text-xs font-mono whitespace-nowrap">
                      {i > 0 && '+ '}{set.num}D{set.sides}
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {(set.rolls || []).map((r) => (
                        <DiceShapeIcon
                          key={r.id}
                          sides={set.sides}
                          value={r.value}
                          size={40}
                          state={rerolledDieIds.has(r.id) ? 'used' : 'idle'}
                        />
                      ))}
                    </div>
                    <span className="text-2xl font-black text-purple-200">{set.total}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-5 py-3 bg-amber-500/10">
                  <span className="text-purple-400 text-xl font-bold">=</span>
                  <span className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500">
                    {diceLastResult.total}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams() 要求包裹在 Suspense 内，否则静态导出构建会报错
export default function InitiativeDisplayPage() {
  return (
    <Suspense fallback={null}>
      <InitiativeDisplayPageInner />
    </Suspense>
  );
}
