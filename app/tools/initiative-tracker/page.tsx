'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import { useWebSocket } from '@/lib/useWebSocket';
// 怪物图片清单：由 useEnemyList 从WebSocket服务器实时读取 public/image/enemies 目录
// 图片命名规则：中文名_英文标识.png（如 哥布林弓手_goblin_archer.png），加图/改名后刷新页面即可生效，无需重启服务
import { useEnemyList, getEnemyImageUrl, filterEnemies } from '@/lib/enemies';

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
  ownerId?: string; // 所属遥控器ID
  combatId?: string; // 战斗区中的唯一ID（从备选池拖入时生成）
}

interface RoomState {
  roomId: string;
  characters: Character[];
  currentTurn: number;
  roundNumber: number;
}

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

// 角色卡片组件
const CharacterCard = ({ 
  char, 
  isCombat = false, 
  isCurrent = false, 
  scale = 1,
  isOwned = false, // 是否是自己的角色
}: { 
  char: Character; 
  isCombat?: boolean; 
  isCurrent?: boolean; 
  scale?: number;
  isOwned?: boolean;
}) => {
  const size = isCombat ? 'w-24 h-32' : 'w-20 h-28';
  const textSize = isCombat ? 'text-5xl' : 'text-4xl';
  const nameSize = isCombat ? 'text-sm' : 'text-xs';
  
  // 边框颜色：自己的角色金色，其他人灰色
  const borderColor = isOwned 
    ? 'border-amber-500' 
    : 'border-gray-500';
  
  return (
    <div
      className={`relative ${size} rounded-xl shadow-2xl flex flex-col items-center justify-center border-4 overflow-hidden ${borderColor}`}
      style={{
        background: char.imageUrl 
          ? 'transparent' 
          : `linear-gradient(135deg, ${char.color}, ${char.color}dd)`,
      }}
    >
      {char.imageUrl ? (
        <>
          {/* 像素风GIF背景 */}
          <img 
            src={char.imageUrl} 
            alt={char.name}
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
          <div className={`${textSize} mb-1`}>{char.token}</div>
          <div className={`text-white font-bold ${nameSize} px-1 text-center line-clamp-2`}>
            {char.name}
          </div>
        </>
      )}
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
  const [controllerId, setControllerId] = useState(''); // 当前遥控器ID
  
  const [isAddingCharacter, setIsAddingCharacter] = useState(false);
  const [addingType, setAddingType] = useState<'player' | 'enemy' | 'npc'>('player'); // 添加类型
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

  // 敌人选择
  const [enemySearch, setEnemySearch] = useState('');
  const [selectedEnemy, setSelectedEnemy] = useState('');
  
  // NPC选择
  const [npcSearch, setNpcSearch] = useState('');
  const [selectedNpcImage, setSelectedNpcImage] = useState('');
  const [npcImageType, setNpcImageType] = useState<'player' | 'enemy'>('player'); // NPC图片来源
  const [npcSelectedRace, setNpcSelectedRace] = useState(RACES[0]);
  const [npcSelectedClass, setNpcSelectedClass] = useState(CLASSES[0]);
  
  const [draggedChar, setDraggedChar] = useState<Character | null>(null);
  const [dragPreviewInit, setDragPreviewInit] = useState<number | null>(null); // 拖拽预览先攻值
  const [displayConnected, setDisplayConnected] = useState(true); // 主屏幕是否在线
  const [showOverlapModal, setShowOverlapModal] = useState(false); // 显示重叠弹窗
  const [overlapCharacters, setOverlapCharacters] = useState<Character[]>([]); // 重叠的角色
  const [sortedOverlapChars, setSortedOverlapChars] = useState<Character[]>([]); // 排序后的重叠角色
  const combatZoneRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载本地备选池（初始化时）
  useEffect(() => {
    if (!controllerId) return;
    
    const saved = localStorage.getItem('dnd-initiative-reserve-pool');
    if (saved) {
      try {
        const reservePool = JSON.parse(saved).map((c: Character) => ({ 
          ...c, 
          inCombat: false, 
          ownerId: controllerId 
        }));
        setCharacters(reservePool);
      } catch (e) {
        console.error('Failed to load reserve pool:', e);
      }
    }
  }, [controllerId]);

  // 生成遥控器ID（每个标签页独立）
  useEffect(() => {
    // 使用sessionStorage代替localStorage，每个标签页独立
    const stored = sessionStorage.getItem('controller-id');
    if (stored) {
      setControllerId(stored);
    } else {
      const newId = 'C' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
      sessionStorage.setItem('controller-id', newId);
      setControllerId(newId);
    }
  }, []);

  // WebSocket连接（临时硬编码用于测试）
  const wsUrl = (isConnected && roomId) ? 'ws://localhost:9998' : null;
  
  const { isConnected: wsConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      if (message.type === 'ROOM_STATE') {
        const roomData = message.payload;
        
        // 接收房间战斗角色，与本地备选池合并
        setCharacters(prev => {
          // 保留本地备选池（从localStorage）
          const myReserve = prev.filter(c => !c.inCombat && c.ownerId === controllerId);
          
          // 房间里所有战斗角色（保持原有ownerId）
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
      if (roomId && controllerId) {
        sendMessage({
          type: 'JOIN_ROOM',
          payload: { roomId, controllerId },
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

  // 保存备选池到 localStorage（只保存非战斗角色）
  useEffect(() => {
    if (!controllerId) return;
    
    const reservePool = characters.filter(c => !c.inCombat && c.ownerId === controllerId);
    localStorage.setItem('dnd-initiative-reserve-pool', JSON.stringify(reservePool));
  }, [characters, controllerId]);

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
    }
    
    const newChar: Character = {
      id: Date.now().toString(),
      name: newCharName.trim(),
      initiative: 15,
      token: newCharToken,
      imageUrl: imageUrl || undefined,
      type: addingType,
      color: TYPE_COLORS[addingType],
      inCombat: false,
      ownerId: controllerId, // 设置所有者
    };
    
    setCharacters(prev => [...prev, newChar]);
    
    setNewCharName('');
    setNewCharImageUrl('');
    setEnemySearch('');
    setSelectedEnemy('');
    setNpcSearch('');
    setSelectedNpcImage('');
    setIsAddingCharacter(false);
  }, [newCharName, newCharToken, addingType, selectedRace, selectedClass, selectedEnemy, npcImageType, npcSelectedRace, npcSelectedClass, selectedNpcImage, controllerId, enemyList]);

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

  // 删除战斗区角色（带确认）
  const handleRemoveCombatCharacter = useCallback((charId: string, charName: string) => {
    if (!confirm(`确定要将「${charName}」移出战斗区吗？`)) {
      return;
    }
    
    setCharacters(prev => {
      const newChars = prev.filter(c => c.id !== charId);
      
      // 同步到房间
      if (isConnected && roomId) {
        const combatChars = newChars.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      
      return newChars;
    });
  }, [isConnected, roomId, updateRoom]);

  // 删除角色
  const handleRemoveCharacter = useCallback((id: string) => {
    setCharacters(prev => prev.filter(c => c.id !== id));
    setCurrentTurn(0);
  }, []);

  // 下一个
  const handleNextTurn = useCallback(() => {
    const combatChars = characters.filter(c => c.inCombat).sort((a, b) => b.initiative - a.initiative);
    if (combatChars.length > 0) {
      const currentIndex = currentTurn;
      const nextIndex = (currentIndex + 1) % combatChars.length;
      
      if (currentIndex === combatChars.length - 1 && nextIndex === 0) {
        const newRound = roundNumber + 1;
        setRoundNumber(newRound);
        setCurrentTurn(nextIndex);
        
        // 同步到房间
        updateRoom({
          roundNumber: newRound,
          currentTurn: nextIndex,
        });
      } else {
        setCurrentTurn(nextIndex);
        
        // 同步到房间
        updateRoom({
          currentTurn: nextIndex,
        });
      }
    }
  }, [characters, currentTurn, roundNumber, updateRoom]);

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
    // 只允许拖拽自己的角色
    if (char.ownerId !== controllerId) {
      return;
    }
    setDraggedChar(char);
  };

  // 拖拽到战斗区（复制模式：从备选池拖拽时不删除原角色）
  const handleDropToCombat = (e: React.DragEvent) => {
    e.preventDefault();
    
    if (!draggedChar || !combatZoneRef.current) {
      return;
    }

    const zone = combatZoneRef.current.getBoundingClientRect();
    const x = e.clientX - zone.left - 32;
    const percentage = Math.max(0, Math.min(1, x / (zone.width - 64)));
    let newInit = Math.round((1 - percentage) * 30);

    newInit = Math.round(newInit);

    // 复制模式：如果从备选区拖拽，创建新的副本
    let updatedChar: Character;
    if (!draggedChar.inCombat) {
      // 从备选区拖拽：创建战斗角色副本，生成新的combatId
      const combatId = `${controllerId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      updatedChar = { 
        ...draggedChar, 
        id: combatId, // 新的唯一ID
        initiative: newInit, 
        inCombat: true, 
        ownerId: controllerId 
      };
    } else {
      // 从战斗区拖拽：只更新先攻值
      updatedChar = { ...draggedChar, initiative: newInit, inCombat: true, ownerId: controllerId };
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

  const combatCharacters = characters.filter(c => c.inCombat).sort((a, b) => b.initiative - a.initiative);
  const reserveCharacters = characters.filter(c => !c.inCombat && c.ownerId === controllerId);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex flex-col">
      <ToolHeader
        className="!bg-slate-950/90 !backdrop-blur-sm !border-b !border-purple-500/20"
        textClassName="!text-purple-100 hover:!text-white"
      />

      {/* 连接房间界面 */}
      {!isConnected ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md w-full bg-slate-900/80 rounded-2xl p-8 border-2 border-purple-500/50 shadow-2xl">
            <h2 className="text-3xl font-black text-amber-400 mb-6 text-center">
              🎮 先攻追踪器遥控器
            </h2>
            
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-purple-300 mb-2">
                  输入房间号（6位数字）
                </label>
                <input
                  type="text"
                  value={inputRoomId}
                  onChange={(e) => setInputRoomId(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  className="w-full px-4 py-3 rounded-lg bg-slate-800 border-2 border-purple-500/30 text-white text-2xl font-mono text-center tracking-widest focus:outline-none focus:border-amber-500 placeholder-slate-600"
                  maxLength={6}
                />
              </div>
              
              <button
                onClick={handleConnectRoom}
                disabled={inputRoomId.length !== 6}
                className="w-full px-6 py-4 rounded-xl font-black text-xl shadow-2xl hover:scale-105 transition-all text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                连接房间
              </button>
            </div>

            <div className="border-t border-purple-500/30 pt-6">
              <p className="text-purple-300 text-sm text-center mb-3">
                或者使用本地模式（单机）
              </p>
              <button
                onClick={() => setIsConnected(true)}
                className="w-full px-6 py-3 rounded-xl font-bold text-lg shadow-lg hover:scale-105 transition-all bg-slate-700 text-white"
              >
                本地模式
              </button>
            </div>

            <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-purple-500/20">
              <p className="text-purple-400 text-sm">
                <strong>提示：</strong>房间号由主屏幕生成。打开
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
          {/* 房间信息栏 */}
          {isConnected && roomId && (
            <div className="bg-slate-950/90 border-b border-purple-500/20 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-purple-300 text-sm">房间号:</div>
                <div className="text-2xl font-black font-mono text-amber-400 tracking-wider">
                  {roomId}
                </div>
                <div className="text-purple-300 text-sm">第 {roundNumber} 回合</div>
                <div className="text-slate-500 text-xs">ID: {controllerId.slice(0, 8)}</div>
                
                {/* WebSocket连接状态指示 */}
                {!wsConnected && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-red-950/50 border border-red-700/50">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-red-400 text-xs font-semibold">连接断开</span>
                  </div>
                )}
                {wsConnected && !displayConnected && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-950/50 border border-amber-600/50">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <span className="text-amber-400 text-xs font-semibold">主屏幕已掉线</span>
                  </div>
                )}
                {wsConnected && displayConnected && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-green-950/50 border border-green-700/50">
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-green-400 text-xs font-semibold">已连接</span>
                  </div>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 rounded-lg font-bold text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                断开连接
              </button>
            </div>
          )}
          
          {/* 主屏幕掉线警告横幅 */}
          {isConnected && wsConnected && !displayConnected && (
            <div className="bg-amber-950/80 border-b border-amber-600/40 px-4 py-2 text-center">
              <span className="text-amber-300 text-sm font-semibold">
                ⚠️ 主屏幕已断开连接，房间数据已保留，等待主屏幕重连中...
              </span>
            </div>
          )}

          {/* ========== 1. 战斗主显示区 ========== */}
          <div
            ref={combatZoneRef}
            onDragOver={handleDragOver}
            onDrop={handleDropToCombat}
            className="relative h-[400px] min-h-[400px] bg-slate-900/50 rounded-2xl mx-4 mt-4 border-2 border-purple-500/30 shadow-2xl overflow-hidden"
          >
            {/* 区域标题 */}
            <div className="absolute top-3 left-4 text-purple-300 font-bold text-sm z-20">
              战斗区域
            </div>

            <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent" />
        
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
                <div className="flex flex-wrap items-end justify-center content-end gap-x-6 gap-y-10 pt-16 pb-0">
                  {combatCharacters.map((char, index) => {
                    const isOwned = char.ownerId === controllerId;
                    const isCurrent = index === currentTurn;
                    
                    return (
                      <div
                        key={char.id}
                        draggable={isOwned} // 只有自己的角色可拖拽
                        onDragStart={() => handleDragStart(char)}
                        className={`relative ${isOwned ? 'cursor-move' : 'cursor-not-allowed'} transition-all duration-300`}
                        style={{
                          transform: `scale(${isCurrent ? 1.15 : 1})`,
                          transformOrigin: 'bottom center',
                          zIndex: isCurrent ? 10 : 1,
                        }}
                      >
                        {/* 当前回合箭头指示 */}
                        {isCurrent && (
                          <div className="absolute -top-14 left-0 right-0 z-20 flex flex-col items-center animate-bounce">
                            <div className="text-3xl">🔻</div>
                          </div>
                        )}
                        
                        {/* 先攻值（在卡片上方） */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-10">
                          <div className={`text-xl font-black px-2 py-0.5 rounded whitespace-nowrap ${
                            isCurrent 
                              ? 'text-white bg-amber-500' 
                              : 'text-amber-400 bg-slate-900/80'
                          }`}>
                            {Math.floor(char.initiative)}
                          </div>
                        </div>
                        
                        {/* 删除按钮（只有自己的角色可删除） */}
                        {isOwned && (
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
                        )}
                        
                        {/* Token 立牌 */}
                        <CharacterCard char={char} isCombat={false} isCurrent={isCurrent} isOwned={isOwned} />
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

            {/* 回合控制按钮 */}
            {combatCharacters.length > 0 && (
              <div className="absolute top-3 right-4 flex gap-2 z-20">
                {/* 上一个/下一个（所有人都能用，防掉线） */}
                <button
                  onClick={handlePrevTurn}
                  className="px-4 py-2 rounded-xl font-bold text-sm shadow-lg hover:scale-105 transition-all bg-slate-700 text-white"
                >
                  ← 上一个
                </button>
                <button
                  onClick={handleNextTurn}
                  className="px-4 py-2 rounded-xl font-bold text-sm shadow-lg hover:scale-105 transition-all bg-slate-700 text-white"
                >
                  下一个 →
                </button>
              </div>
            )}
          </div>

          {/* ========== 2. 备选区 ========== */}
          <div
            className="relative flex-1 p-6 overflow-auto bg-slate-900/50 rounded-2xl mx-4 my-4 border-2 border-purple-500/30 shadow-2xl"
          >
            {/* 区域标题 */}
            <div className="absolute top-3 left-4 text-purple-300 font-bold text-sm z-10">
              备选角色池
            </div>
            
            <div className="mt-6">
              {reserveCharacters.length === 0 ? (
                <div className="text-center text-purple-500 py-8">
                  <p>备选区为空，从下方添加角色</p>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3 justify-center">
                  {reserveCharacters.map((char) => (
                    <div
                      key={char.id}
                      draggable
                      onDragStart={() => handleDragStart(char)}
                      className="relative cursor-move hover:scale-110 transition-all"
                    >
                      <CharacterCard char={char} isCombat={false} isCurrent={false} isOwned={true} />
                      
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
          </div>

          {/* ========== 3. 捏人区 ========== */}
          <div className="relative p-4 bg-slate-900/50 rounded-2xl mx-4 mb-4 border-2 border-purple-500/30 shadow-2xl">
            {/* 区域标题 */}
            <div className="absolute top-3 left-4 text-purple-300 font-bold text-sm z-10">
              角色创建
            </div>
            
            <div className="mt-6">
              {/* 按钮组 */}
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    setAddingType('player');
                    setIsAddingCharacter(true);
                  }}
                  className="px-4 py-2 rounded-lg font-bold shadow-lg hover:scale-105 transition-all text-white text-sm"
                  style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
                >
                  ➕ 自定义角色
                </button>
                <button
                  onClick={handleReset}
                  className="px-4 py-2 rounded-lg font-bold shadow-lg hover:scale-105 transition-all bg-slate-700 text-white text-sm"
                >
                  🔄 完全重置
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* 角色创建弹窗 */}
      {isAddingCharacter && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 rounded-2xl p-6 max-w-4xl w-full border-2 border-purple-500/50 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-black text-amber-400 mb-4 text-center">
              创建{addingType === 'player' ? '玩家角色' : addingType === 'enemy' ? '敌人' : 'NPC'}
            </h3>

            {/* 类型选择 */}
            <div className="flex gap-2 justify-center mb-6">
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
                      onClick={() => setSelectedEnemy(enemy.key)}
                      className={`relative p-2 rounded-lg transition-all ${
                        selectedEnemy === enemy.key
                          ? 'bg-red-500/30 border-2 border-red-500 scale-105'
                          : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <img
                        src={getEnemyImageUrl(enemy.key, enemyList)}
                        alt={enemy.name}
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
                          onClick={() => setSelectedNpcImage(enemy.key)}
                          className={`relative p-2 rounded-lg transition-all ${
                            selectedNpcImage === enemy.key
                              ? 'bg-green-500/30 border-2 border-green-500 scale-105'
                              : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          <img
                            src={getEnemyImageUrl(enemy.key, enemyList)}
                            alt={enemy.name}
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
            
            <div className="flex gap-6 justify-center mb-6 overflow-x-auto pt-12 pb-10 px-4">
              {overlapCharacters.map((char, index) => {
                const isDragging = draggedChar?.id === char.id;
                return (
                <div
                  key={char.id}
                  draggable
                  onDragStart={() => setDraggedChar(char)}
                  onDragEnd={() => setDraggedChar(null)}
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
    </div>
  );
}
