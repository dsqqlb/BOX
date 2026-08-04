'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import { useWebSocket } from '@/lib/useWebSocket';

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

// 获取所有敌人图片
const ENEMY_IMAGES = [
  'beast_bat', 'beast_spider', 'beast_spider_cave', 'beast_wolf', 'beast_wolfking', 'beast_worm',
  'Bugbear_warrior', 'demon', 'demon_butcher', 'demon_imp', 'demon_imp_archer',
  'goblin_archer', 'goblin_blade_shield', 'goblin_mage', 'goblin_rogue', 'goblin_spear',
  'mummy', 'ratman_archer', 'ratman_crossbowman', 'ratman_heary_warrior', 'ratman_king',
  'ratman_mage', 'ratman_spearman', 'ratman_warrior', 'skelton_archer', 'skelton_axe',
  'skelton_heavy_armor', 'skelton_king', 'skelton_mage', 'skelton_shield', 'skelton_spear',
  'zombie', 'zombie_soldier'
];

const ENEMY_NAMES = {
  'beast_bat': '蝙蝠',
  'beast_spider': '蜘蛛',
  'beast_spider_cave': '洞穴蜘蛛',
  'beast_wolf': '狼',
  'beast_wolfking': '狼王',
  'beast_worm': '虫子',
  'Bugbear_warrior': '熊地精战士',
  'demon': '恶魔',
  'demon_butcher': '屠夫恶魔',
  'demon_imp': '小恶魔',
  'demon_imp_archer': '小恶魔弓手',
  'goblin_archer': '哥布林弓手',
  'goblin_blade_shield': '哥布林剑盾',
  'goblin_mage': '哥布林法师',
  'goblin_rogue': '哥布林游荡者',
  'goblin_spear': '哥布林长矛',
  'mummy': '木乃伊',
  'ratman_archer': '鼠人弓手',
  'ratman_crossbowman': '鼠人弩手',
  'ratman_heary_warrior': '鼠人重装战士',
  'ratman_king': '鼠人之王',
  'ratman_mage': '鼠人法师',
  'ratman_spearman': '鼠人矛兵',
  'ratman_warrior': '鼠人战士',
  'skelton_archer': '骷髅弓手',
  'skelton_axe': '骷髅斧兵',
  'skelton_heavy_armor': '骷髅重甲',
  'skelton_king': '骷髅王',
  'skelton_mage': '骷髅法师',
  'skelton_shield': '骷髅盾兵',
  'skelton_spear': '骷髅矛兵',
  'zombie': '僵尸',
  'zombie_soldier': '僵尸士兵'
};

// 角色类型
interface Character {
  id: string;
  name: string;
  initiative: number;
  token: string;
  imageUrl?: string; // 可选的图片URL（像素风GIF）
  type: 'player' | 'enemy' | 'npc';
  color: string;
  inCombat: boolean; // 是否在战斗区
  ownerId?: string; // 所属遥控器ID
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
  
  // 边框颜色：自己的角色金色，其他人灰色，当前回合高亮
  const borderColor = isCurrent 
    ? 'border-amber-400 shadow-amber-400/50' 
    : isOwned 
      ? 'border-amber-500/70' 
      : 'border-slate-500/50';
  
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
  const [showOverlapModal, setShowOverlapModal] = useState(false); // 显示重叠弹窗
  const [overlapCharacters, setOverlapCharacters] = useState<Character[]>([]); // 重叠的角色
  const combatZoneRef = useRef<HTMLDivElement>(null);

  // 从 localStorage 加载本地备选池
  useEffect(() => {
    const saved = localStorage.getItem('dnd-initiative-reserve-pool');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // 加载备选池，并标记为不在战斗中
        const reservePool = data.map((c: Character) => ({ ...c, inCombat: false, ownerId: controllerId }));
        setCharacters(prev => {
          // 合并备选池和当前战斗角色
          const combat = prev.filter(p => p.inCombat);
          return [...reservePool, ...combat];
        });
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
        
        // 合并策略：保留我的备选区角色 + 房间里所有战斗中的角色
        setCharacters(prev => {
          // 从localStorage读取我的备选池
          const reserveSaved = localStorage.getItem('dnd-initiative-reserve-pool');
          let myReserve: Character[] = [];
          if (reserveSaved) {
            try {
              myReserve = JSON.parse(reserveSaved).map((c: Character) => ({
                ...c,
                inCombat: false,
                ownerId: controllerId
              }));
            } catch (e) {
              console.error('Failed to parse reserve pool:', e);
            }
          }
          
          const allCombat = roomData.characters || []; // 房间里所有战斗角色
          
          return [...myReserve, ...allCombat];
        });
        
        setCurrentTurn(roomData.currentTurn || 0);
        setRoundNumber(roomData.roundNumber || 1);
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
  });

  // 连接到房间
  const handleConnectRoom = useCallback(() => {
    if (inputRoomId.length === 6 && /^\d+$/.test(inputRoomId)) {
      setRoomId(inputRoomId);
      setIsConnected(true);
      // WebSocket会在连接后自动验证房间是否存在
    } else {
      alert('请输入6位数字房间号');
    }
  }, [inputRoomId]);

  // 断开房间
  const handleDisconnect = useCallback(() => {
    setIsConnected(false);
    setRoomId('');
  }, []);

  // 更新房间数据（通过WebSocket）
  const updateRoom = useCallback((updates: Partial<RoomState>) => {
    if (!isConnected || !roomId) return;

    sendMessage({
      type: 'UPDATE_ROOM',
      payload: { roomId, updates },
    });
  }, [isConnected, roomId, sendMessage]);

  // 保存备选池到 localStorage（独立存储，跨房间保持）
  useEffect(() => {
    const reservePool = characters.filter(c => !c.inCombat && c.ownerId === controllerId);
    if (reservePool.length >= 0) {
      localStorage.setItem('dnd-initiative-reserve-pool', JSON.stringify(reservePool));
    }
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
      imageUrl = `/image/enemies/${selectedEnemy}.png`;
    } else if (addingType === 'npc') {
      // NPC：使用选中的图片
      if (npcImageType === 'player') {
        imageUrl = `/image/player/${npcSelectedRace.name}_${npcSelectedRace.en}/${npcSelectedClass}.png`;
      } else if (selectedNpcImage) {
        imageUrl = `/image/enemies/${selectedNpcImage}.png`;
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
  }, [newCharName, newCharToken, addingType, selectedRace, selectedClass, selectedEnemy, npcImageType, npcSelectedRace, npcSelectedClass, selectedNpcImage, controllerId]);

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
      return `/image/enemies/${selectedEnemy}.png`;
    } else if (addingType === 'npc') {
      if (npcImageType === 'player') {
        return `/image/player/${npcSelectedRace.name}_${npcSelectedRace.en}/${npcSelectedClass}.png`;
      } else if (selectedNpcImage) {
        return `/image/enemies/${selectedNpcImage}.png`;
      }
    }
    return '';
  }, [addingType, selectedRace, selectedClass, selectedEnemy, npcImageType, npcSelectedRace, npcSelectedClass, selectedNpcImage]);

  // 切换到种族的其他图片
  const switchToRaceAlternative = useCallback(() => {
    const alternatives = [`其他1.png`, `其他2.png`];
    const randomClass = CLASSES[Math.floor(Math.random() * CLASSES.length)];
    alternatives.push(`${randomClass}.png`);
    
    setRaceImageIndex((prev) => (prev + 1) % alternatives.length);
  }, []);

  // 过滤敌人列表
  const filteredEnemies = useMemo(() => {
    if (!enemySearch.trim()) return ENEMY_IMAGES;
    const search = enemySearch.toLowerCase();
    return ENEMY_IMAGES.filter(enemy => {
      const enName = enemy.toLowerCase();
      const cnName = ENEMY_NAMES[enemy as keyof typeof ENEMY_NAMES]?.toLowerCase() || '';
      return enName.includes(search) || cnName.includes(search);
    });
  }, [enemySearch]);

  // 过滤NPC敌人列表
  const filteredNpcEnemies = useMemo(() => {
    if (!npcSearch.trim()) return ENEMY_IMAGES;
    const search = npcSearch.toLowerCase();
    return ENEMY_IMAGES.filter(enemy => {
      const enName = enemy.toLowerCase();
      const cnName = ENEMY_NAMES[enemy as keyof typeof ENEMY_NAMES]?.toLowerCase() || '';
      return enName.includes(search) || cnName.includes(search);
    });
  }, [npcSearch]);

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

  // 拖拽到战斗区
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

    const updatedChar = { ...draggedChar, initiative: newInit, inCombat: true, ownerId: controllerId };

    // 检查是否有重叠
    const charsAtSameInit = characters.filter(
      c => c.inCombat && c.id !== draggedChar.id && c.initiative === newInit
    );

    if (charsAtSameInit.length > 0) {
      setOverlapCharacters([...charsAtSameInit, updatedChar]);
      setShowOverlapModal(true);
      setCharacters(prev =>
        prev.map(c => c.id === draggedChar.id ? updatedChar : c)
      );
    } else {
      setCharacters(prev => {
        const newChars = prev.map(c => c.id === draggedChar.id ? updatedChar : c);
        
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

  // 拖拽到备选区（移出战斗区）
  const handleDropToReserve = (e: React.DragEvent) => {
    e.preventDefault();
    if (!draggedChar) return;

    setCharacters(prev => {
      const newChars = prev.map(c => c.id === draggedChar.id ? { ...c, inCombat: false } : c);
      
      // 同步到房间 - 从房间移除这个角色（通过WebSocket）
      if (isConnected && roomId) {
        const combatChars = newChars.filter(c => c.inCombat);
        updateRoom({ characters: combatChars });
      }
      
      return newChars;
    });
    
    setDraggedChar(null);
    setDragPreviewInit(null);
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
              </div>
              <button
                onClick={handleDisconnect}
                className="px-4 py-2 rounded-lg font-bold text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                断开连接
              </button>
            </div>
          )}

          {/* ========== 1. 战斗主显示区（房间模式下只读显示） ========== */}
          <div
            ref={combatZoneRef}
            onDragOver={handleDragOver}
            onDrop={handleDropToCombat}
            className="relative h-[40vh] bg-slate-900/50 rounded-2xl mx-4 mt-4 border-2 border-purple-500/30 shadow-2xl overflow-hidden"
          >
            {/* 区域标题 */}
            <div className="absolute top-3 left-4 text-purple-300 font-bold text-sm z-20">
              战斗区域
            </div>

            <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent" />
        
            {/* 战斗区角色立牌 */}
            <div className="absolute top-8 left-8 right-8 bottom-24 flex items-center justify-center">
              {combatCharacters.length === 0 ? (
                <div className="text-center text-purple-400">
                  <div className="text-4xl mb-2">⚔️</div>
                  <p className="text-lg">从下方拖拽角色到这里</p>
                </div>
              ) : (
                <div className="relative w-full h-full">
                  {combatCharacters.map((char, index) => {
                    const position = ((30 - char.initiative) / 30) * 100;
                    const isOwned = char.ownerId === controllerId;
                    const isCurrent = index === currentTurn;
                    
                    return (
                      <div
                        key={char.id}
                        draggable={isOwned} // 只有自己的角色可拖拽
                        onDragStart={() => handleDragStart(char)}
                        className={`absolute ${isOwned ? 'cursor-move hover:z-20' : 'cursor-not-allowed'}`}
                        style={{
                          left: `${position}%`,
                          bottom: '0',
                          transform: `translateX(-50%)`,
                          transition: 'all 0.3s ease-out',
                          zIndex: 5,
                        }}
                      >
                        {/* 先攻值（在卡片上方） */}
                        <div className="absolute -top-10 left-1/2 -translate-x-1/2">
                          <div className="text-xl font-black px-2 py-0.5 rounded text-amber-400 bg-slate-900/80">
                            {char.initiative}
                          </div>
                        </div>
                        
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
            onDragOver={handleDragOver}
            onDrop={handleDropToReserve}
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
                      key={enemy}
                      onClick={() => setSelectedEnemy(enemy)}
                      className={`relative p-2 rounded-lg transition-all ${
                        selectedEnemy === enemy
                          ? 'bg-red-500/30 border-2 border-red-500 scale-105'
                          : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      <img
                        src={`/image/enemies/${enemy}.png`}
                        alt={enemy}
                        className="w-full h-20 object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <p className="text-xs text-white mt-1 truncate">
                        {ENEMY_NAMES[enemy as keyof typeof ENEMY_NAMES] || enemy}
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
                          key={enemy}
                          onClick={() => setSelectedNpcImage(enemy)}
                          className={`relative p-2 rounded-lg transition-all ${
                            selectedNpcImage === enemy
                              ? 'bg-green-500/30 border-2 border-green-500 scale-105'
                              : 'bg-slate-800 border border-slate-700 hover:bg-slate-700'
                          }`}
                        >
                          <img
                            src={`/image/enemies/${enemy}.png`}
                            alt={enemy}
                            className="w-full h-20 object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                          <p className="text-xs text-white mt-1 truncate">
                            {ENEMY_NAMES[enemy as keyof typeof ENEMY_NAMES] || enemy}
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
          <div className="bg-slate-900 rounded-2xl p-6 max-w-2xl w-full border-2 border-purple-500/50 shadow-2xl">
            <h3 className="text-2xl font-black text-amber-400 mb-4 text-center">
              先攻值重叠 - 调整顺序
            </h3>
            <p className="text-purple-300 text-center mb-6">
              拖动卡片左右排序，左边先行动
            </p>
            
            <div className="flex gap-4 justify-center mb-6 overflow-x-auto p-4">
              {overlapCharacters.map((char, index) => (
                <div
                  key={char.id}
                  draggable
                  onDragStart={() => setDraggedChar(char)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!draggedChar) return;
                    
                    const newOrder = [...overlapCharacters];
                    const dragIndex = newOrder.findIndex(c => c.id === draggedChar.id);
                    const dropIndex = index;
                    
                    // 交换位置
                    [newOrder[dragIndex], newOrder[dropIndex]] = [newOrder[dropIndex], newOrder[dragIndex]];
                    setOverlapCharacters(newOrder);
                  }}
                  className="relative cursor-move hover:scale-110 transition-all flex-shrink-0"
                >
                  <CharacterCard char={char} isCombat={false} isCurrent={false} />
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-amber-400 font-black text-xl">
                    {char.initiative}
                  </div>
                  <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 text-purple-300 text-xs">
                    顺序 {index + 1}
                  </div>
                </div>
              ))}
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
