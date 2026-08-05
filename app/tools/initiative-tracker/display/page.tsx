'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWebSocket } from '@/lib/useWebSocket';

// 角色类型
interface Character {
  id: string; // combatId（战斗区中的唯一ID）
  name: string;
  initiative: number;
  token: string;
  imageUrl?: string;
  type: 'player' | 'enemy' | 'npc';
  color: string;
  ownerId: string; // 所属遥控器ID
  combatId?: string; // 战斗区中的唯一ID（与id相同）
}

interface RoomState {
  roomId: string;
  characters: Character[];
  currentTurn: number;
  roundNumber: number;
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

// 角色卡片组件（高级质感版）
const BG3CharacterCard = ({ 
  char, 
  isCurrent,
  isEntering = false,
  isLeaving = false,
}: { 
  char: Character; 
  isCurrent: boolean;
  isEntering?: boolean;
  isLeaving?: boolean;
}) => {
  return (
    <div
      className={`relative flex-shrink-0 transition-all duration-700 ease-out ${
        isEntering ? 'animate-slideInUp' : ''
      } ${isLeaving ? 'animate-slideOutDown' : ''}`}
      style={{
        transform: `scale(${isCurrent ? 1.25 : 1}) translateY(${isCurrent ? '-12px' : '0'})`,
        opacity: isLeaving ? 0 : 1,
      }}
    >
      {/* 当前回合：优雅的指示 */}
      {isCurrent && (
        <>
          {/* 顶部动态箭头指示器 */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-30">
            <div className="relative flex flex-col items-center animate-bounce-slow">
              <div className="text-4xl">🔻</div>
            </div>
          </div>
          
          {/* 底部发光 - 更强烈的光效 */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-full h-2 bg-gradient-to-r from-transparent via-amber-400 to-transparent blur-md" />
          <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-1 bg-amber-500/80 blur-sm" />
        </>
      )}
      
      {/* 卡片容器 */}
      <div className="relative">
        {/* 先攻值徽章 - 缩小 */}
        <div className="absolute -top-2 -left-2 z-20">
          <div className={`relative w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-500 ${
            isCurrent 
              ? 'bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-md shadow-amber-500/40' 
              : 'bg-slate-800/90 text-amber-400/80 border border-amber-600/20 shadow-lg'
          }`}>
            {Math.floor(char.initiative)}
            {/* 内光 */}
            {isCurrent && (
              <div className="absolute inset-0 rounded-full bg-gradient-to-t from-white/20 to-transparent" />
            )}
          </div>
        </div>
        
        {/* 类型标签 - 缩小并降低透明度 */}
        <div className="absolute -top-1 -right-1 z-20">
          <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium backdrop-blur-sm border transition-all duration-300 ${
            char.type === 'player' 
              ? 'bg-blue-500/70 text-blue-50 border-blue-400/40 shadow-sm shadow-blue-500/10' :
            char.type === 'enemy' 
              ? 'bg-red-500/70 text-red-50 border-red-400/40 shadow-sm shadow-red-500/10' :
              'bg-emerald-500/70 text-emerald-50 border-emerald-400/40 shadow-sm shadow-emerald-500/10'
          }`}>
            {char.type === 'player' ? '玩家' : char.type === 'enemy' ? '敌人' : 'NPC'}
          </div>
        </div>
        
        {/* 主卡片 */}
        <div
          className={`relative w-32 h-48 rounded-lg overflow-hidden transition-all duration-500 border-2 ${
            isCurrent 
              ? 'shadow-2xl shadow-amber-500/50 border-amber-400' 
              : 'shadow-xl shadow-black/40 border-slate-700/50'
          }`}
        >
          {/* 卡片边框 - 使用渐变和内阴影 */}
          <div className={`absolute inset-0 rounded-lg transition-all duration-500 ${
            isCurrent 
              ? 'bg-gradient-to-b from-amber-400/20 via-transparent to-amber-600/30' 
              : 'bg-gradient-to-b from-slate-600/10 via-transparent to-slate-800/20'
          }`} />
          
          <div className={`absolute inset-[2px] rounded-lg overflow-hidden border transition-all duration-500 ${
            isCurrent 
              ? 'border-amber-400/40' 
              : 'border-slate-700/60'
          }`}
          style={{
            background: 'linear-gradient(180deg, rgba(15,23,42,0.98) 0%, rgba(30,41,59,0.99) 100%)',
          }}>
            {/* 背景图片 */}
            {char.imageUrl && (
              <div className="absolute inset-0">
                <img 
                  src={char.imageUrl} 
                  alt={char.name}
                  className="absolute inset-0 w-full h-full object-cover"
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
            
            {/* Token（如果没有图片） */}
            {!char.imageUrl && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-6xl opacity-90">{char.token}</div>
              </div>
            )}
            
            {/* 当前回合：顶部微光 */}
            {isCurrent && (
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
            )}
          </div>
        </div>
        
        {/* 名字放在卡片外面下方 */}
        <div className="mt-2">
          <div className={`font-black text-center leading-tight transition-all duration-500 px-1 ${
            isCurrent 
              ? 'text-amber-400 text-lg drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]' 
              : 'text-slate-300 text-base'
          }`}>
            {char.name}
          </div>
        </div>
      </div>
    </div>
  );
};

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

  // 生成6位数字房间ID
  function generateRoomId() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  // 初始化房间ID（客户端）
  // 房间号会写入URL，这样"刷新重连"时才能连回同一个房间，而不是生成新房间
  useEffect(() => {
    if (paramRoomId) {
      setRoomId(paramRoomId);
    } else {
      const id = generateRoomId();
      setRoomId(id);
      // 把房间号写入URL，避免刷新后房间号丢失
      const url = new URL(window.location.href);
      url.searchParams.set('room', id);
      window.history.replaceState({}, '', url.toString());
    }
  }, [paramRoomId]);

  // WebSocket连接（临时硬编码用于测试）
  const wsUrl = roomId ? 'ws://localhost:9998' : null;
  
  const { isConnected, sendMessage } = useWebSocket(wsUrl, {
    onMessage: (message) => {
      console.log('📩 主屏收到消息:', message.type, message.payload);
      
      if (message.type === 'ROOM_STATE') {
        console.log('✅ 更新房间状态:', message.payload);
        setRoomState(message.payload);
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
      
      {/* 房间ID和回合数显示 */}
      {sortedCharacters.length === 0 ? (
        /* 无角色时：大显示房间号 */
        <div className="absolute top-8 left-8 z-50">
          <div className="bg-slate-900/60 backdrop-blur-xl rounded-xl px-6 py-4 border border-slate-700/50 shadow-2xl">
            <div className="text-slate-400 text-xs mb-1.5 font-medium tracking-wider uppercase">房间号</div>
            <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 tracking-wider font-mono">
              {roomId || '---'}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 有角色时：左上角小房间号 */}
          <div className="absolute top-6 left-6 z-50">
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-lg px-4 py-2.5 border border-slate-700/50 shadow-xl">
              <div className="text-slate-500 text-[10px] mb-0.5 font-medium tracking-wider uppercase">Room</div>
              <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 tracking-wider font-mono">
                {roomId}
              </div>
            </div>
          </div>
          
          {/* 回合数显示在正中间上方 */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-900/60 backdrop-blur-xl rounded-xl px-8 py-3 border border-amber-600/30 shadow-2xl">
              <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 text-center tracking-wide">
                第 {roomState.roundNumber} 回合
              </div>
            </div>
          </div>
        </>
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
            {roomId && (
              <>
                <div className="inline-block bg-slate-900/60 backdrop-blur-xl px-8 py-4 rounded-xl border border-amber-600/30 shadow-2xl">
                  <div className="text-6xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-amber-500 tracking-wider">
                    {roomId}
                  </div>
                </div>
                <div className="mt-8 text-slate-400 text-base font-medium">
                  💡 打开遥控器页面，输入房间号即可连接
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* BG3样式的横向卡片条 */}
            <div className="w-full flex items-center justify-center">
              <div className="relative max-w-[95vw]">
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
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 底部装饰 */}
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-slate-800/50 to-transparent" />
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
