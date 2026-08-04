'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useWebSocket } from '@/lib/useWebSocket';

// 角色类型
interface Character {
  id: string;
  name: string;
  initiative: number;
  token: string;
  imageUrl?: string;
  type: 'player' | 'enemy' | 'npc';
  color: string;
  ownerId: string; // 所属遥控器ID
}

interface RoomState {
  roomId: string;
  characters: Character[];
  currentTurn: number;
  roundNumber: number;
}

// 角色卡片组件（博德之门3风格）
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
  const typeColor = char.type === 'player' ? 'blue' : char.type === 'enemy' ? 'red' : 'green';
  const typeLabel = char.type === 'player' ? '玩家' : char.type === 'enemy' ? '敌人' : 'NPC';
  
  return (
    <div
      className={`relative flex-shrink-0 transition-all duration-500 ${
        isEntering ? 'animate-slideInUp' : ''
      } ${isLeaving ? 'animate-slideOutDown' : ''}`}
      style={{
        transform: `scale(${isCurrent ? 1.35 : 1})`,
        opacity: isLeaving ? 0 : 1,
        zIndex: isCurrent ? 20 : 10,
      }}
    >
      {/* 当前回合超强光效 */}
      {isCurrent && (
        <>
          <div className="absolute -inset-16 rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-amber-400 animate-pulse opacity-40 blur-3xl" />
          <div className="absolute -inset-12 rounded-full bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-300 animate-pulse opacity-50 blur-2xl" />
          <div className="absolute -inset-8 rounded-full bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-200 animate-pulse opacity-30 blur-xl" />
          
          {/* 指向箭头 */}
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-20 flex flex-col items-center justify-center gap-2">
            <div className="text-6xl animate-bounce drop-shadow-2xl filter brightness-125">👇</div>
          </div>
          
          {/* 旋转光环 */}
          <div className="absolute -inset-6 border-4 border-amber-400/50 rounded-2xl animate-spin-slow" />
        </>
      )}
      
      {/* 先攻值（卡片上方） */}
      <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-20">
        <div className={`px-5 py-2 rounded-xl font-black text-3xl shadow-2xl transition-all duration-300 ${
          isCurrent 
            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white scale-110 animate-pulse' 
            : 'bg-slate-900/95 text-amber-300 border-2 border-amber-500/30'
        }`}>
          {char.initiative}
        </div>
      </div>
      
      {/* 类型标签（卡片上方） */}
      <div className="absolute -top-6 left-1/2 -translate-x-1/2 z-20">
        <div className={`text-xs px-3 py-1 rounded-full font-bold ${
          char.type === 'player' ? 'bg-blue-500/80 text-blue-100' :
          char.type === 'enemy' ? 'bg-red-500/80 text-red-100' :
          'bg-green-500/80 text-green-100'
        }`}>
          {typeLabel}
        </div>
      </div>
      
      {/* 卡片主体 */}
      <div
        className={`relative w-36 h-52 rounded-2xl shadow-2xl overflow-hidden border-4 transition-all duration-300 ${
          isCurrent 
            ? 'border-amber-400 shadow-amber-400/80 shadow-2xl ring-4 ring-amber-300/50' 
            : 'border-slate-700/80 hover:border-slate-600'
        }`}
        style={{
          background: 'linear-gradient(180deg, rgba(15,23,42,0.95) 0%, rgba(30,41,59,0.98) 100%)',
        }}
      >
        {/* 背景图片 */}
        {char.imageUrl && (
          <div className="absolute inset-0 overflow-hidden">
            <img 
              src={char.imageUrl} 
              alt={char.name}
              className="absolute inset-0 w-full h-full object-cover opacity-90"
              style={{ 
                imageRendering: 'pixelated',
                filter: isCurrent ? 'brightness(1.2) contrast(1.1)' : 'brightness(0.95)',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent" />
          </div>
        )}
        
        {/* Token（如果没有图片） */}
        {!char.imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className={`text-8xl transition-all duration-300 ${
              isCurrent ? 'scale-110 drop-shadow-2xl' : ''
            }`}>
              {char.token}
            </div>
          </div>
        )}
        
        {/* 角色名称（底部，在图片内） */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/95 via-slate-900/90 to-transparent p-3 pt-8">
          <div className={`font-black text-center leading-tight transition-all duration-300 ${
            isCurrent ? 'text-amber-300 text-lg' : 'text-white text-base'
          }`}>
            {char.name}
          </div>
        </div>
        
        {/* 当前回合外发光边框 */}
        {isCurrent && (
          <>
            <div className="absolute inset-0 border-2 border-amber-300/50 rounded-2xl animate-pulse" />
            <div className="absolute -inset-px bg-gradient-to-r from-amber-400/20 via-orange-400/20 to-amber-400/20 rounded-2xl blur-sm" />
          </>
        )}
      </div>
    </div>
  );
};

export default function InitiativeDisplayPage() {
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
  useEffect(() => {
    const id = paramRoomId || generateRoomId();
    setRoomId(id);
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex flex-col overflow-hidden relative">
      {/* 背景装饰 */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-0 w-96 h-96 bg-purple-500 rounded-full filter blur-3xl animate-pulse" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-500 rounded-full filter blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-500 rounded-full filter blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
      </div>

      {/* 网格背景 */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: 'linear-gradient(rgba(139, 92, 246, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.3) 1px, transparent 1px)',
        backgroundSize: '50px 50px',
      }} />
      
      {/* WebSocket连接状态 */}
      {!isConnected && (
        <div className="absolute top-4 right-4 z-50">
          <div className="bg-red-500/20 backdrop-blur-md rounded-lg px-4 py-2 border border-red-500/50">
            <div className="text-red-400 text-sm font-bold flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              WebSocket未连接
            </div>
          </div>
        </div>
      )}
      
      {/* 房间ID和回合数显示 */}
      {sortedCharacters.length === 0 ? (
        /* 无角色时：大显示房间号 */
        <div className="absolute top-8 left-8 z-50">
          <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl px-8 py-4 border-2 border-purple-500/50 shadow-2xl">
            <div className="text-purple-400 text-sm mb-1 font-bold">房间号</div>
            <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 tracking-wider font-mono drop-shadow-lg">
              {roomId || '加载中...'}
            </div>
            <div className="mt-2 text-purple-300 text-xs">
              玩家数: {sortedCharacters.length}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* 有角色时：左上角小房间号 */}
          <div className="absolute top-6 left-6 z-50">
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-purple-500/50 shadow-lg">
              <div className="text-purple-400 text-xs mb-0.5 font-bold">房间号</div>
              <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400 tracking-wider font-mono">
                {roomId}
              </div>
            </div>
          </div>
          
          {/* 回合数显示在正中间上方 */}
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50">
            <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl px-8 py-4 border-2 border-amber-500/50 shadow-2xl">
              <div className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-400 to-amber-400 drop-shadow-lg text-center">
                第 {roomState.roundNumber} 回合
              </div>
            </div>
          </div>
        </>
      )}

      {/* 主战斗区域 */}
      <div className="flex-1 flex items-center justify-center p-12 relative z-10">
        {sortedCharacters.length === 0 ? (
          <div className="text-center animate-pulse">
            <div className="text-9xl mb-8 animate-bounce">⚔️</div>
            <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-amber-400 to-purple-400 mb-6">
              等待玩家加入战斗...
            </div>
            <div className="text-2xl text-purple-400 mb-4">
              请使用遥控器连接房间号
            </div>
            {roomId && (
              <>
                <div className="inline-block bg-slate-900/80 backdrop-blur-sm px-8 py-4 rounded-2xl border-2 border-amber-500/50">
                  <div className="text-7xl font-mono font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-400">
                    {roomId}
                  </div>
                </div>
                <div className="mt-8 text-purple-500 text-lg">
                  💡 提示：打开遥控器页面，输入上方房间号即可连接
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="w-full max-w-[95%] flex items-center justify-center gap-12 flex-wrap">
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
        )}
      </div>

      {/* 底部装饰线 - 更炫酷 */}
      <div className="absolute bottom-0 left-0 right-0 h-3 bg-gradient-to-r from-purple-600 via-amber-500 to-purple-600 shadow-lg" />
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-50" />
    </div>
  );
}
