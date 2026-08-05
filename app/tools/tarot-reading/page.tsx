'use client';

import { useState, useMemo, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import TarotCard from '@/components/tarot/TarotCard';
import {
  TarotCard as TarotCardData,
  DrawnCard,
  Spread,
  SPREADS,
  getAllCards,
  shuffleCards,
  drawCards,
  getCardTheme,
} from '@/lib/tarot';

type Stage = 'select-spread' | 'shuffling' | 'ready-to-draw' | 'drawn';

// 背景飘动的雾气团固定参数（避免每次渲染重新随机导致动效跳动）
const MIST_LAYERS = [
  { left: '10%', top: '15%', size: 420, delay: '0s', duration: '20s' },
  { left: '60%', top: '5%', size: 500, delay: '3s', duration: '24s' },
  { left: '30%', top: '55%', size: 460, delay: '6s', duration: '22s' },
  { left: '75%', top: '60%', size: 380, delay: '2s', duration: '26s' },
];

// 星光点固定参数
const STAR_POINTS = Array.from({ length: 40 }, (_, i) => ({
  left: `${(i * 37 + 13) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  size: 1 + (i % 3),
  delay: `${(i % 10) * 0.4}s`,
}));

export default function TarotReadingPage() {
  const allCards = useMemo(() => getAllCards(), []);

  // 洗牌飞旋途中"瞥见正面"用的图片：随机挑几张大阿卡纳牌图，纯视觉效果，
  // 不代表最终抽牌结果（真正的抽牌结果在 handleDraw 时才用 drawCards 生成）
  const shufflePreviewImages = useMemo(() => {
    const majors = allCards.filter((c) => c.arcana === 'major');
    return shuffleCards(majors).slice(0, SHUFFLE_DECK_SIZE).map((c) => `/image/tarot/${c.image}`);
  }, [allCards]);

  const [stage, setStage] = useState<Stage>('select-spread');
  const [selectedSpread, setSelectedSpread] = useState<Spread | null>(null);
  const [shuffledDeck, setShuffledDeck] = useState<TarotCardData[]>([]);
  const [drawnCards, setDrawnCards] = useState<DrawnCard[]>([]);
  const [flippedIndices, setFlippedIndices] = useState<Set<number>>(new Set());
  const [detailCard, setDetailCard] = useState<DrawnCard | null>(null);
  const [isShuffling, setIsShuffling] = useState(false);
  const [shuffleRunId, setShuffleRunId] = useState(0); // 每次洗牌自增，用作key强制重播动画
  const pileRef = useRef<HTMLDivElement>(null); // 桌上牌堆的真实DOM位置，用于计算抽牌飞行轨迹
  const [pileOrigin, setPileOrigin] = useState<{ x: number; y: number } | null>(null);

  // 选择牌阵 -> 进入洗牌动画
  const handleSelectSpread = useCallback((spread: Spread) => {
    setSelectedSpread(spread);
    setStage('shuffling');
    setIsShuffling(true);
    setDrawnCards([]);
    setFlippedIndices(new Set());
    setShuffleRunId((id) => id + 1);

    // 洗牌动画持续时间（需与 CSS animate-tarot-casino-shuffle 时长匹配）
    setTimeout(() => {
      setShuffledDeck(shuffleCards(allCards));
      setIsShuffling(false);
      setStage('ready-to-draw');
    }, 2200);
  }, [allCards]);

  // 抽牌：先测量桌上牌堆的真实屏幕坐标，之后牌阵里的每张牌才能算出"从牌堆飞过去"的精确轨迹
  const handleDraw = useCallback(() => {
    if (!selectedSpread) return;
    const rect = pileRef.current?.getBoundingClientRect();
    setPileOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);

    const drawn = drawCards(shuffledDeck, selectedSpread.positions.length);
    setDrawnCards(drawn);
    setStage('drawn');

    // 逐张延迟翻开，营造依次揭示的仪式感
    drawn.forEach((_, i) => {
      setTimeout(() => {
        setFlippedIndices((prev) => new Set(prev).add(i));
      }, 900 + i * 350);
    });
  }, [selectedSpread, shuffledDeck]);

  // 重新开始
  const handleReset = useCallback(() => {
    setStage('select-spread');
    setSelectedSpread(null);
    setDrawnCards([]);
    setFlippedIndices(new Set());
    setDetailCard(null);
    setPileOrigin(null);
  }, []);

  // 换一个牌阵（回到选择界面但保留可能的状态清理）
  const handleChangeSpread = useCallback(() => {
    handleReset();
  }, [handleReset]);

  return (
    <div className="min-h-screen bg-[#0b0714] relative overflow-hidden">
      {/* ============ 背景：星空 + 雾气 + 符文光晕 ============ */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-radial from-[#241640] via-[#140b28] to-[#05030a]" />

        {/* 雾气团 */}
        {MIST_LAYERS.map((m, i) => (
          <div
            key={i}
            className="absolute rounded-full blur-3xl animate-tarot-mist"
            style={{
              left: m.left,
              top: m.top,
              width: m.size,
              height: m.size,
              background: 'radial-gradient(circle, rgba(147,51,234,0.18), transparent 70%)',
              animationDelay: m.delay,
              animationDuration: m.duration,
            }}
          />
        ))}

        {/* 星光点 */}
        {STAR_POINTS.map((s, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-amber-200 animate-tarot-twinkle"
            style={{
              left: s.left,
              top: s.top,
              width: s.size,
              height: s.size,
              animationDelay: s.delay,
            }}
          />
        ))}
      </div>

      <div className="relative z-10">
        <ToolHeader
          className="!bg-[#0b0714]/80 !backdrop-blur-lg !border-b !border-amber-500/10"
          textClassName="!text-amber-200/70 hover:!text-amber-100"
        />

        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="text-center mb-10">
            <h1 className="text-4xl sm:text-5xl font-black text-amber-100 tracking-wide mb-3"
              style={{ textShadow: '0 0 24px rgba(251,191,36,0.35)' }}>
              🔮 塔罗牌占卜
            </h1>
            <p className="text-amber-200/50 text-sm">
              静心凝神，选择一个牌阵，让塔罗为你揭示答案
            </p>
          </div>

          {stage === 'select-spread' && (
            <SpreadSelector onSelect={handleSelectSpread} />
          )}

          {(stage === 'shuffling' || stage === 'ready-to-draw') && selectedSpread && (
            <ShufflingStage
              spread={selectedSpread}
              isShuffling={isShuffling}
              shuffleRunId={shuffleRunId}
              previewImages={shufflePreviewImages}
              pileRef={pileRef}
              onDraw={handleDraw}
              onBack={handleChangeSpread}
            />
          )}

          {stage === 'drawn' && selectedSpread && (
            <ReadingResult
              spread={selectedSpread}
              drawnCards={drawnCards}
              flippedIndices={flippedIndices}
              pileOrigin={pileOrigin}
              onCardClick={(dc) => setDetailCard(dc)}
              onReset={handleReset}
              onChangeSpread={handleChangeSpread}
            />
          )}
        </div>
      </div>

      {detailCard && (
        <CardDetailModal drawnCard={detailCard} onClose={() => setDetailCard(null)} />
      )}
    </div>
  );
}

// ============ 牌阵选择 ============
function SpreadSelector({ onSelect }: { onSelect: (spread: Spread) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
      {SPREADS.map((spread) => (
        <button
          key={spread.id}
          onClick={() => onSelect(spread)}
          className="group text-left p-6 rounded-2xl border border-amber-500/20 bg-gradient-to-br from-purple-950/40 to-slate-950/60 hover:border-amber-400/50 hover:from-purple-900/50 transition-all duration-300 hover:scale-[1.02]"
        >
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-bold text-amber-100 group-hover:text-amber-300 transition-colors">
              {spread.name}
            </h3>
            <span className="text-xs font-mono text-purple-300/60 bg-purple-500/10 px-2 py-0.5 rounded">
              {spread.positions.length} 张
            </span>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">{spread.description}</p>
        </button>
      ))}
    </div>
  );
}

// 常驻卡片数量（就是最终静止扇形的牌数，洗牌过程和洗牌结束共用同一批DOM元素，首尾位置完全重合，不会跳帧）
const SHUFFLE_DECK_SIZE = 7;
// 额外的"幽灵乱牌"数量：只在洗牌进行中淡入淡出出现，增加画面密度和混乱感
const GHOST_CARD_COUNT = 12;

// 每张常驻牌的静止位置：叠成一整堆有真实厚度的牌堆（不再是扇形展开），
// 明显的纵向堆叠高度 + 细微错位倾斜，让整叠牌看起来有实体感而不是一张平面
function getRestPosition(i: number, total: number) {
  // 基于index的固定伪随机小抖动，让每张牌略微错开但幅度很小
  const jitter = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return (x - Math.floor(x)) - 0.5;
  };
  return {
    x: jitter(1) * 4,
    y: -i * 3.2, // 每张牌明显叠高一截，7张牌堆起来能看出真实的厚度
    r: jitter(2) * 2.5,
  };
}

// 每张常驻牌的洗牌轨迹（5个中间关键帧）：分堆 -> 桥式冲撞 -> 扇形高抛炸开 -> 甩尾 -> 回收，
// 基于index+seed的可复现伪随机，保证不抖动、每次洗牌又略有不同
function buildShuffleTrajectories(count: number, seed: number) {
  return Array.from({ length: count }, (_, i) => {
    const rand = (n: number) => {
      const x = Math.sin(seed * 999 + i * 57.13 + n * 13.7) * 10000;
      return x - Math.floor(x);
    };
    const side = i % 2 === 0 ? -1 : 1;
    const spread = 90 + rand(1) * 60;

    return {
      p1x: side * (90 + rand(1) * 40), p1y: -20 - rand(2) * 25, p1r: side * (14 + rand(3) * 14),
      p2x: -side * (60 + rand(4) * 70), p2y: -90 - rand(5) * 70, p2r: -side * (40 + rand(6) * 50),
      p3x: (rand(7) - 0.5) * spread * 4.2, p3y: -210 - rand(8) * 130, p3r: (rand(9) - 0.5) * 340,
      p4x: (rand(10) - 0.5) * spread * 1.6, p4y: -70 - rand(11) * 60, p4r: (rand(12) - 0.5) * 90,
      p5x: (rand(13) - 0.5) * 24, p5y: -14 - rand(14) * 10, p5r: (rand(15) - 0.5) * 10,
    };
  });
}

// 幽灵乱牌的轨迹（只需一个中段极值点即可，更简单粗暴）
function buildGhostTrajectories(count: number, seed: number) {
  return Array.from({ length: count }, (_, i) => {
    const rand = (n: number) => {
      const x = Math.sin(seed * 555 + i * 91.7 + n * 7.3) * 10000;
      return x - Math.floor(x);
    };
    const angle = rand(1) * Math.PI * 2;
    const dist = 100 + rand(2) * 140;
    return {
      gx: Math.cos(angle) * dist,
      gy: Math.sin(angle) * dist - 40,
      gr: (rand(3) - 0.5) * 300,
      delay: rand(4) * 0.5,
    };
  });
}

// ============ 洗牌 / 抽牌准备阶段 ============
function ShufflingStage({
  spread,
  isShuffling,
  shuffleRunId,
  previewImages,
  pileRef,
  onDraw,
  onBack,
}: {
  spread: Spread;
  isShuffling: boolean;
  shuffleRunId: number;
  previewImages: string[];
  pileRef: React.RefObject<HTMLDivElement | null>;
  onDraw: () => void;
  onBack: () => void;
}) {
  const deckIndices = Array.from({ length: SHUFFLE_DECK_SIZE }, (_, i) => i);
  const ghostIndices = Array.from({ length: GHOST_CARD_COUNT }, (_, i) => i);

  const trajectories = useMemo(
    () => buildShuffleTrajectories(SHUFFLE_DECK_SIZE, shuffleRunId || 1),
    [shuffleRunId]
  );
  const ghostTrajectories = useMemo(
    () => buildGhostTrajectories(GHOST_CARD_COUNT, shuffleRunId || 1),
    [shuffleRunId]
  );

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <div className="text-amber-200/70 text-sm mb-1">已选择牌阵</div>
        <div className="text-2xl font-bold text-amber-100">{spread.name}</div>
      </div>

      {/* 洗牌/牌堆视觉：tarot-flip-scene 提供 3D 透视，让 rotateY 产生真实的立体纵深感 */}
      <div className="relative h-[340px] w-[380px] flex items-center justify-center tarot-flip-scene">
        {/* 桌面质感光晕：牌堆放稳后才淡入，模拟落在桌上的投影 */}
        <div
          className="absolute w-56 h-32 rounded-full blur-2xl tarot-table-surface pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse, rgba(0,0,0,0.55), transparent 70%)',
            opacity: isShuffling ? 0 : 1,
          }}
        />

        {isShuffling && (
          <>
            {/* 金色爆闪层 */}
            <div
              key={`flash-${shuffleRunId}`}
              className="absolute inset-0 rounded-full animate-tarot-shuffle-flash pointer-events-none"
              style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.55), transparent 65%)' }}
            />
            {/* 速度线 */}
            <div
              key={`speed-l-${shuffleRunId}`}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-40 h-1 rounded-full animate-tarot-speed-line pointer-events-none"
              style={{ background: 'linear-gradient(to right, transparent, rgba(253,224,71,0.9), transparent)' }}
            />
            <div
              key={`speed-r-${shuffleRunId}`}
              className="absolute right-0 top-1/2 -translate-y-1/2 w-40 h-1 rounded-full animate-tarot-speed-line pointer-events-none"
              style={{ background: 'linear-gradient(to left, transparent, rgba(253,224,71,0.9), transparent)', animationDelay: '0.06s' }}
            />

            {/* 幽灵乱牌：纯背景装饰，只在洗牌中段淡入淡出，不影响主牌堆的首尾一致性 */}
            {ghostIndices.map((i) => {
              const g = ghostTrajectories[i];
              return (
                <div
                  key={`ghost-${shuffleRunId}-${i}`}
                  className="absolute w-16 h-[108px] rounded-md overflow-hidden shadow-lg shadow-black/50 ring-1 ring-amber-400/20 animate-tarot-ghost-fly pointer-events-none"
                  style={{
                    '--gx': `${g.gx}px`, '--gy': `${g.gy}px`, '--gr': `${g.gr}deg`,
                    animationDelay: `${g.delay}s`,
                  } as React.CSSProperties}
                >
                  <img src="/image/tarot/card-back.svg" alt="" className="w-full h-full object-cover" draggable={false} />
                </div>
              );
            })}
          </>
        )}

        {/*
          常驻牌堆：洗牌中飞舞，洗牌结束后原地悬浮。
          外层 tarot-table-tilt-wrap 负责洗牌结束瞬间"视角转桌面"的丝滑过渡（竖直朝向观众 -> rotateX 平放俯视），
          pileRef 挂在这里，用于 handleDraw 时测量牌堆的真实屏幕坐标，让抽牌动画能精确飞抵这个起点。
        */}
        <div
          ref={pileRef}
          className={`absolute inset-0 flex items-center justify-center tarot-table-tilt-wrap ${
            isShuffling ? '' : 'tarot-table-settled'
          }`}
          style={{ transformStyle: 'preserve-3d' }}
        >
        {deckIndices.map((i) => {
          const rest = getRestPosition(i, SHUFFLE_DECK_SIZE);
          const t = trajectories[i];
          const frontImg = previewImages[i] || previewImages[0];
          return (
            <div
              key={i}
              className={`absolute w-28 h-[190px] tarot-shuffle-card-3d ${
                isShuffling ? 'animate-tarot-casino-shuffle-3d' : 'animate-tarot-fan-float'
              }`}
              style={{
                '--restx': `${rest.x}px`, '--resty': `${rest.y}px`, '--restr': `${rest.r}deg`,
                '--p1x': `${t.p1x}px`, '--p1y': `${t.p1y}px`, '--p1r': `${t.p1r}deg`,
                '--p2x': `${t.p2x}px`, '--p2y': `${t.p2y}px`, '--p2r': `${t.p2r}deg`,
                '--p3x': `${t.p3x}px`, '--p3y': `${t.p3y}px`, '--p3r': `${t.p3r}deg`,
                '--p4x': `${t.p4x}px`, '--p4y': `${t.p4y}px`, '--p4r': `${t.p4r}deg`,
                '--p5x': `${t.p5x}px`, '--p5y': `${t.p5y}px`, '--p5r': `${t.p5r}deg`,
                animationDelay: isShuffling ? `${i * 0.035}s` : `${i * 0.08}s`,
                zIndex: i, // 叠成一堆：后面的牌盖在上面，符合真实牌堆的层次
              } as React.CSSProperties}
            >
              {/* 背面（牌背图案）：每层单独投影，堆叠起来能读出"一张张纸叠着"的层次感，而不是糊成一块 */}
              <div
                className="absolute inset-0 rounded-lg overflow-hidden ring-1 ring-amber-400/30"
                style={{ backfaceVisibility: 'hidden', boxShadow: '0 2px 3px rgba(0,0,0,0.45), 0 10px 20px -6px rgba(0,0,0,0.6)' }}
              >
                <img src="/image/tarot/card-back.svg" alt="塔罗牌背" className="w-full h-full object-cover" draggable={false} />
              </div>
              {/* 正面（真实塔罗牌图，飞旋途中会被瞥见） */}
              <div
                className="absolute inset-0 rounded-lg overflow-hidden shadow-2xl shadow-black/70 ring-1 ring-amber-400/30"
                style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
              >
                <img src={frontImg} alt="" className="w-full h-full object-cover" draggable={false} />
              </div>
            </div>
          );
        })}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        {isShuffling ? (
          <div className="text-amber-300/80 text-sm font-semibold tracking-wide animate-pulse">
            🎴 命运之牌正在飞旋交织，请静心默念你的问题…
          </div>
        ) : (
          <>
            <div className="text-amber-200/70 text-sm">牌已洗好，凝神静气后点击抽牌</div>
            <button
              onClick={onDraw}
              className="px-8 py-3 rounded-xl font-bold text-base bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-lg shadow-amber-500/30 hover:shadow-amber-500/50 hover:scale-105 transition-all"
            >
              🔮 抽取 {spread.positions.length} 张牌
            </button>
          </>
        )}
        <button
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors mt-1"
        >
          ← 重新选择牌阵
        </button>
      </div>
    </div>
  );
}

// 每张牌抽牌飞行动画的CSS变量：接收"牌堆真实屏幕位置 - 该牌目标槊位真实屏幕位置"算出的偏移量
type DealTrajectoryVars = React.CSSProperties & {
  '--dealx': string; '--dealy': string; '--dealr0': string;
  '--dealmidx': string; '--dealmidy': string; '--dealrm': string;
  '--deal-delay': string;
};

// 根据"牌堆坐标"和"该牌目标槊位坐标"算出单张牌的抛牌飞行轨迹（起点偏移 + 抛高弧顶点偏移）
function computeDealTrajectory(
  pileOrigin: { x: number; y: number } | null,
  targetEl: HTMLElement | null,
  index: number
): DealTrajectoryVars {
  if (!pileOrigin || !targetEl) {
    // 没测量到真实坐标时兜底：简单的从上方落下
    return {
      '--dealx': '0px', '--dealy': '-80px', '--dealr0': `${(index % 2 === 0 ? -1 : 1) * 12}deg`,
      '--dealmidx': '0px', '--dealmidy': '-40px', '--dealrm': '0deg',
      '--deal-delay': `${index * 0.16}s`,
    } as DealTrajectoryVars;
  }
  const rect = targetEl.getBoundingClientRect();
  const targetX = rect.left + rect.width / 2;
  const targetY = rect.top + rect.height / 2;
  const dx = pileOrigin.x - targetX;
  const dy = pileOrigin.y - targetY;
  // 抛高弧顶点：飞行路径中点往上再抬一截，制造"抛出后划弧落下"的立体轨迹感，而非直线飞行
  const arcLift = -Math.max(60, Math.abs(dy) * 0.35 + 40);
  const rotStart = (index % 2 === 0 ? -1 : 1) * (18 + (index % 3) * 6);

  return {
    '--dealx': `${dx}px`, '--dealy': `${dy}px`, '--dealr0': `${rotStart}deg`,
    '--dealmidx': `${dx * 0.45}px`, '--dealmidy': `${dy * 0.45 + arcLift}px`, '--dealrm': `${rotStart * 0.3}deg`,
    '--deal-delay': `${index * 0.22}s`,
  } as DealTrajectoryVars;
}

// ============ 抽牌结果展示 ============
function ReadingResult({
  spread,
  drawnCards,
  flippedIndices,
  pileOrigin,
  onCardClick,
  onReset,
  onChangeSpread,
}: {
  spread: Spread;
  drawnCards: DrawnCard[];
  flippedIndices: Set<number>;
  pileOrigin: { x: number; y: number } | null;
  onCardClick: (dc: DrawnCard) => void;
  onReset: () => void;
  onChangeSpread: () => void;
}) {
  const isCelticCross = spread.id === 'celtic-cross';
  // 每张牌目标槊位的DOM引用（挂在无transform的外层包装div上，不受内部牌本身动画影响）
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 初始用兜底轨迹立即渲染（保证布局到位、目标槊位有真实尺寸），
  // 待 useLayoutEffect 测出真实坐标后在绘制前更新为精确轨迹，不会有闪烁
  const [trajectories, setTrajectories] = useState<DealTrajectoryVars[]>(
    () => drawnCards.map((_, i) => computeDealTrajectory(null, null, i))
  );

  useLayoutEffect(() => {
    const computed = drawnCards.map((_, i) => computeDealTrajectory(pileOrigin, cardRefs.current[i], i));
    setTrajectories(computed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawnCards, pileOrigin]);

  const renderFlyingCard = (dc: DrawnCard, i: number, size: 'sm' | 'lg', label?: string) => {
    const t = trajectories[i] || computeDealTrajectory(null, null, i);
    return (
      <div key={dc.card.id} ref={(el) => { cardRefs.current[i] = el; }}>
        <TarotCard
          card={dc.card}
          isReversed={dc.isReversed}
          isFlipped={flippedIndices.has(i)}
          size={size}
          showGlow
          label={label}
          onClick={() => flippedIndices.has(i) && onCardClick(dc)}
          className="animate-tarot-deal-fly"
          style={t}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center gap-10">
      {isCelticCross ? (
        <CelticCrossLayout
          spread={spread}
          drawnCards={drawnCards}
          flippedIndices={flippedIndices}
          renderFlyingCard={renderFlyingCard}
        />
      ) : (
        <div className="flex flex-wrap justify-center gap-8">
          {drawnCards.map((dc, i) => renderFlyingCard(dc, i, 'lg', spread.positions[i]?.label))}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onChangeSpread}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-purple-500/15 text-purple-300 hover:bg-purple-500/25 transition-colors"
        >
          ↺ 更换牌阵
        </button>
        <button
          onClick={onReset}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors"
        >
          🔮 重新占卜
        </button>
      </div>
    </div>
  );
}

// 凯尔特十字专用布局：十字架四张 + 竖排四张
function CelticCrossLayout({
  spread,
  drawnCards,
  flippedIndices,
  renderFlyingCard,
}: {
  spread: Spread;
  drawnCards: DrawnCard[];
  flippedIndices: Set<number>;
  renderFlyingCard: (dc: DrawnCard, i: number, size: 'sm' | 'lg', label?: string) => React.ReactNode;
}) {
  const renderCard = (i: number, rotate?: boolean) => {
    const dc = drawnCards[i];
    if (!dc) return null;
    return (
      <div style={{ transform: rotate ? 'rotate(90deg)' : undefined }}>
        {renderFlyingCard(dc, i, 'sm', spread.positions[i]?.label)}
      </div>
    );
  };

  return (
    <div className="flex flex-col lg:flex-row items-center gap-12">
      {/* 十字区域：0现状 1挑战(横压) 2根源 3过去 4目标 5未来 */}
      <div className="relative grid grid-cols-3 grid-rows-3 gap-3" style={{ width: 340, height: 480 }}>
        <div className="col-start-2 row-start-1 flex justify-center">{renderCard(4)}</div>
        <div className="col-start-1 row-start-2 flex justify-center">{renderCard(3)}</div>
        <div className="col-start-2 row-start-2 flex justify-center items-center relative">
          {renderCard(0)}
          <div className="absolute">{renderCard(1, true)}</div>
        </div>
        <div className="col-start-3 row-start-2 flex justify-center">{renderCard(5)}</div>
        <div className="col-start-2 row-start-3 flex justify-center">{renderCard(2)}</div>
      </div>

      {/* 竖排四张：6自我认知 7外部影响 8期望与恐惧 9结果 */}
      <div className="flex flex-row lg:flex-col gap-4">
        {[9, 8, 7, 6].map((i) => (
          <div key={i}>{renderCard(i)}</div>
        ))}
      </div>
    </div>
  );
}

// ============ 单卡详情弹窗 ============
function CardDetailModal({ drawnCard, onClose }: { drawnCard: DrawnCard; onClose: () => void }) {
  const { card, isReversed } = drawnCard;
  const theme = getCardTheme(card);
  const meaning = isReversed ? card.reversed : card.upright;
  const keywords = isReversed ? card.keywordsReversed : card.keywords;

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="max-w-2xl w-full bg-gradient-to-br from-[#1a1030] to-[#0b0714] rounded-2xl border border-amber-500/20 shadow-2xl p-6 sm:p-8 flex flex-col sm:flex-row gap-6 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex justify-center">
          <TarotCard card={card} isReversed={isReversed} isFlipped size="lg" showGlow />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">{theme.icon}</span>
            <span className="text-xs font-semibold text-purple-300/70 uppercase tracking-wide">
              {theme.label}
            </span>
          </div>
          <h2 className="text-2xl font-black text-amber-100 mb-1">
            {card.name}
            {isReversed && <span className="text-red-400 text-lg ml-2">（逆位）</span>}
          </h2>
          <div className="text-sm text-slate-500 italic mb-4">{card.nameEn}</div>

          <div className="flex flex-wrap gap-2 mb-5">
            {keywords.map((kw) => (
              <span
                key={kw}
                className="px-2.5 py-1 rounded-full text-xs font-medium"
                style={{ background: `${theme.color}20`, color: theme.color, border: `1px solid ${theme.color}40` }}
              >
                {kw}
              </span>
            ))}
          </div>

          <p className="text-slate-300 leading-relaxed text-sm">{meaning}</p>

          <button
            onClick={onClose}
            className="mt-6 px-4 py-2 rounded-lg text-sm font-semibold bg-white/5 text-slate-300 hover:bg-white/10 transition-colors"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
