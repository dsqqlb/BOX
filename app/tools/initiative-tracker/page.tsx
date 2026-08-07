'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
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
}

// 非当前回合压暗强度的localStorage key + 默认值
const DIM_INTENSITY_KEY = 'dnd-initiative-dim-intensity';
const DEFAULT_DIM_INTENSITY = 0.55;

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
        if (typeof roomData.displayConnected === 'boolean') {
          setDisplayConnected(roomData.displayConnected);
        }
      } else if (message.type === 'DISPLAY_STATUS') {
        // 主屏幕连接状态变化通知
        setDisplayConnected(message.payload.connected);
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

  // 滑块拖动：更新压暗强度，写入localStorage记住位置，并同步给主屏幕实时生效
  const handleDimIntensityChange = useCallback((value: number) => {
    setDimIntensity(value);
    localStorage.setItem(DIM_INTENSITY_KEY, String(value));
    updateRoom({ dimIntensity: value });
  }, [updateRoom]);

  // 连接成功后（或重连后），把本地记住的压暗强度推给房间，让主屏幕立即生效一次
  // （不依赖首次挂载时的连接状态，wsConnected变为true时才有意义推送）
  useEffect(() => {
    if (wsConnected && isConnected && roomId) {
      updateRoom({ dimIntensity });
    }
    // 只在"刚连上"这一刻推送一次，dimIntensity变化已经由handleDimIntensityChange自己同步，这里不需要重复依赖它
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
    <div className="min-h-screen rc-chassis flex flex-col items-center py-6 px-3 sm:px-6">
      <ToolHeader
        className="!bg-transparent !border-none !static !w-full !max-w-5xl"
        textClassName="!text-slate-400 hover:!text-slate-200"
        showBackButton
      />

      {/* ========== 遥控器机身 ========== */}
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
            {/* 状态显示条：房间号 / 回合数 / 连接指示灯，做成仪表盘样式 */}
            {isConnected && roomId && (
              <div className="rc-screen rounded-xl px-4 sm:px-5 py-3 mb-3 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
                  <div className="flex items-baseline gap-2">
                    <span className="rc-label">房间号</span>
                    <span className="text-xl sm:text-2xl font-black font-mono text-amber-400 tracking-wider">
                      {roomId}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="rc-label">回合</span>
                    <span className="text-lg font-bold text-purple-300">{roundNumber}</span>
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
                <div className="flex items-center gap-3">
                  {/* 主屏幕非当前回合角色压暗强度滑块：0=不灰，1=特别灰，实时同步给主屏幕并记住在本机 */}
                  <div className="flex items-center gap-2">
                    <span className="rc-label whitespace-nowrap">压暗强度</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={dimIntensity}
                      onChange={(e) => handleDimIntensityChange(parseFloat(e.target.value))}
                      className="w-24 sm:w-32 accent-amber-500"
                      title="主屏幕上非当前回合角色的压暗程度"
                    />
                    <span className="text-xs text-slate-400 font-mono w-8 text-right">{dimIntensity.toFixed(2)}</span>
                  </div>
                  <button
                    onClick={handleDisconnect}
                    className="rc-btn px-3 py-1.5 rounded-lg font-bold text-xs text-red-400 bg-red-950/60"
                  >
                    断开连接
                  </button>
                </div>
              </div>
            )}
            
            {/* 主屏幕掉线警告横幅 */}
            {isConnected && wsConnected && !displayConnected && (
              <div className="rc-screen rounded-xl px-4 py-2 mb-3 text-center border border-amber-600/30">
                <span className="text-amber-300 text-sm font-semibold">
                  ⚠️ 主屏幕已断开连接，房间数据已保留，等待主屏幕重连中...
                </span>
              </div>
            )}

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

            {/* ========== 3. 控制台：角色创建 / 重置（物理按键区） ========== */}
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
              </div>
            </div>
          </>
        )}
      </div>

      {/* 机身底部品牌条 */}
      <div className="w-full max-w-5xl flex items-center justify-center gap-2 mt-3 opacity-40">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-500 to-transparent" />
        <span className="rc-label">RC-01 · DND SERIES</span>
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-slate-500 to-transparent" />
      </div>

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

      {/* 回合控制按钮：fixed定位悬浮在视口右侧，不随页面滚动消失（不再挂在战斗区域容器内） */}
      {isConnected && combatCharacters.length > 0 && (
        <div className="fixed right-4 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-3">
          <button
            onClick={handlePrevTurn}
            className="rc-btn flex flex-col items-center gap-1 px-4 py-3 rounded-2xl font-bold text-slate-100 bg-slate-800 shadow-2xl ring-1 ring-white/10"
            title="上一个"
          >
            <span className="text-xl leading-none">◀</span>
            <span className="text-[10px] rc-label">上一个</span>
          </button>
          <button
            onClick={handleNextTurn}
            className="rc-btn flex flex-col items-center gap-1 px-4 py-3 rounded-2xl font-bold text-white shadow-2xl ring-1 ring-amber-400/40"
            style={{ background: 'linear-gradient(180deg, #f59e0b, #d97706)' }}
            title="下一个"
          >
            <span className="text-xl leading-none">▶</span>
            <span className="text-[10px] font-semibold tracking-wide">下一个</span>
          </button>
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
