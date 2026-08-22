'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import SearchPanel, { EMPTY_SEARCH_STATE, SearchPanelState } from '@/components/edh/SearchPanel';
import CardTile from '@/components/edh/CardTile';
import CardDetailModal from '@/components/edh/CardDetailModal';
import DeckBoard from '@/components/edh/DeckBoard';
import DeckSidebar from '@/components/edh/DeckSidebar';
import * as api from '@/lib/edh/api';
import { DeckViewMode, EdhCard, EdhDeck, EdhDeckLayout, EdhSearchFilters } from '@/lib/edh/types';

const baseLayout: EdhDeckLayout = { viewMode: 'free', positions: {} };

function filters(s: SearchPanelState): EdhSearchFilters {
  return {
    q: s.q, searchField: s.searchField, colors: s.colors, colorMode: s.colorMode,
    types: s.types, rarities: s.rarities, cmcMin: s.cmcMin,
    cmcMax: s.cmcMax >= 16 ? null : s.cmcMax,
    powerMin: s.powerMin === '' ? null : Number(s.powerMin),
    powerMax: s.powerMax === '' ? null : Number(s.powerMax),
    toughnessMin: s.toughnessMin === '' ? null : Number(s.toughnessMin),
    toughnessMax: s.toughnessMax === '' ? null : Number(s.toughnessMax),
    format: s.format, nonReprint: s.nonReprint, commanderOnly: s.commanderOnly,
  };
}

/** 来自卡池的指针拖拽会话。抓取点（offsetX/offsetY）全程不变，卡牌在指针下方保持原位。 */
interface DragSession {
  card: EdhCard;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  moved: boolean;
}

export default function EdhBuilderPage() {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(EMPTY_SEARCH_STATE);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<EdhCard[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [decks, setDecks] = useState<EdhDeck[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cache, setCache] = useState<Map<string, EdhCard>>(new Map());
  const [detail, setDetail] = useState<EdhCard | null>(null);

  // ---- 拖拽状态（卡池 → 桌面/指挥官槽位） ----
  const [drag, setDrag] = useState<DragSession | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const suppressClickRef = useRef(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    Promise.all([api.listDecks(), api.getCardsMeta()])
      .then(([ds]) => { setDecks(ds); setActiveId(ds[0]?.id || null); setReady(true); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => () => { dragCleanupRef.current?.(); }, []);

  const active = useMemo(() => decks.find((d) => d.id === activeId) || null, [decks, activeId]);

  useEffect(() => {
    if (!active) return;
    const ids = [...active.cards.map((c) => c.oracleId), ...(active.commanderOracleId ? [active.commanderOracleId] : [])]
      .filter((i) => !cache.has(i));
    if (ids.length) api.lookupCards(ids).then((cs) => setCache((p) => { const n = new Map(p); cs.forEach((c) => n.set(c.oracleId, c)); return n; }));
  }, [active, cache]);

  const save = useCallback((id: string, patch: Partial<EdhDeck>) =>
    api.updateDeck(id, patch).then((d) => setDecks((p) => p.map((x) => x.id === id ? d : x))).catch((e) => setError(e.message)), []);
  const cardOf = useCallback((id: string) => cache.get(id), [cache]);

  const search = () => {
    setSearched(true);
    setError('');
    api.searchCards(filters(state))
      .then((r) => {
        setResults(r.cards);
        setTotal(r.total);
        setCache((p) => { const n = new Map(p); r.cards.forEach((c) => n.set(c.oracleId, c)); return n; });
      })
      .catch((e) => setError(e.message));
  };

  const add = (card: EdhCard, point?: { x: number; y: number }) => {
    if (!active) return setError('请先新建一个牌组');
    if (active.commanderOracleId === card.oracleId) return;
    const ex = active.cards.find((x) => x.oracleId === card.oracleId);
    if (ex && !card.typeLine.toLowerCase().includes('basic land')) return;
    const cards = ex
      ? active.cards.map((x) => x.oracleId === card.oracleId ? { ...x, quantity: x.quantity + 1 } : x)
      : [...active.cards, { oracleId: card.oracleId, quantity: 1 }];
    const layout = {
      ...(active.layout || baseLayout),
      positions: { ...(active.layout?.positions || {}), ...(point ? { [card.oracleId]: point } : {}) },
    };
    save(active.id, { cards, layout });
  };

  const setCommander = (card: EdhCard) => {
    if (!active) return;
    if (!card.isCommanderEligible) return setError('这张牌不能担任指挥官');
    save(active.id, { commanderOracleId: card.oracleId, cards: active.cards.filter((x) => x.oracleId !== card.oracleId) });
  };

  const updateLayout = (patch: Partial<EdhDeckLayout>) => active && save(active.id, { layout: { ...(active.layout || baseLayout), ...patch } });
  const remove = (card: EdhCard) => active && save(active.id, { cards: active.cards.map((x) => x.oracleId === card.oracleId ? { ...x, quantity: x.quantity - 1 } : x).filter((x) => x.quantity > 0) });

  // ---- 卡池拖拽：指针按下记录抓取偏移，移动超过阈值后进入拖拽，松手时按投放区落牌 ----
  const beginPoolDrag = (e: React.PointerEvent<HTMLDivElement>, card: EdhCard) => {
    if (e.button !== 0) return; // 只响应主键（左键/触摸）
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const session: DragSession = {
      card,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    };
    dragRef.current = session;
    setDrag(session);

    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      const next = { ...cur, x: ev.clientX, y: ev.clientY };
      if (!cur.moved && Math.hypot(ev.clientX - cur.startX, ev.clientY - cur.startY) > 6) {
        next.moved = true;
        suppressClickRef.current = true; // 拖拽结束后抑制本轮的 click
      }
      dragRef.current = next;
      setDrag(next);
    };

    const resolveDrop = (clientX: number, clientY: number) => {
      const el = document.elementFromPoint(clientX, clientY);
      const zoneEl = el && (el.closest('[data-drop-zone]') as HTMLElement | null);
      if (!zoneEl) return;
      const zone = zoneEl.dataset.dropZone;
      if (zone === 'commander') {
        setCommander(session.card);
      } else if (zone === 'board-free') {
        const rect = zoneEl.getBoundingClientRect();
        add(session.card, { x: Math.max(0, clientX - rect.left), y: Math.max(0, clientY - rect.top) });
      } else if (zone === 'board') {
        add(session.card);
      }
    };

    const onUp = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur || ev.pointerId !== cur.pointerId) return;
      if (dragCleanupRef.current) dragCleanupRef.current();
      if (cur.moved) resolveDrop(ev.clientX, ev.clientY);
      dragRef.current = null;
      setDrag(null);
      setTimeout(() => { suppressClickRef.current = false; }, 0);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragCleanupRef.current = null;
    };
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const guardPoolDetails = (card: EdhCard) => {
    if (suppressClickRef.current) return; // 刚拖拽完，忽略随之而来的 click
    setDetail(card);
  };

  const ghost = drag?.moved ? drag : null;
  const ghostImage = ghost ? (ghost.card.image?.normal || ghost.card.faces?.[0]?.image?.normal) : null;

  if (!ready) {
    return <div className="grid min-h-screen place-items-center bg-[#070915] text-slate-400">载入指挥官工作台…</div>;
  }

  return (
    <div className="min-h-screen bg-[#070915] text-slate-100">
      <ToolHeader className="!border-white/10 !bg-[#080a18]/70" textClassName="!text-slate-400 hover:!text-white" />
      <main className="mx-auto max-w-[1700px] p-4 sm:p-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs tracking-[.18em] text-cyan-300">EDH DECK FORGE</p>
            <h1 className="text-2xl font-semibold">指挥官组卡台</h1>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-white/[.03] p-1">
            {(['free', 'type', 'cmc'] as DeckViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => updateLayout({ viewMode: v })}
                className={`rounded-lg px-3 py-2 text-xs ${active?.layout?.viewMode === v || (v === 'free' && !active?.layout) ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}
              >
                {v === 'free' ? '自由桌面' : v === 'type' ? '按类别归拢' : '按法力值归拢'}
              </button>
            ))}
          </div>
        </header>

        {error && <p className="mb-3 rounded-xl bg-rose-500/15 p-3 text-sm text-rose-200">{error}</p>}

        <div className="grid gap-4 xl:grid-cols-[430px_1fr_220px]">
          <aside>
            <SearchPanel state={state} onChange={setState} onSearch={search} />
            <section className="mt-4 rounded-2xl border border-white/10 bg-white/[.03] p-3">
              <div className="flex justify-between text-xs text-slate-500">
                <span>卡池结果</span>
                {searched && <span>{total} 张</span>}
              </div>
              {!searched ? (
                <p className="grid min-h-64 place-items-center text-center text-sm text-slate-500">输入条件后点击搜索<br />卡池不会自动展示热门牌</p>
              ) : (
                // 移动端：横向滚动一行（不占纵向空间）；sm 及以上：三列网格纵向滚动
                <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-2 sm:grid sm:max-h-[680px] sm:grid-cols-3 sm:gap-2 sm:overflow-y-auto sm:overflow-x-hidden">
                  {results.map((c) => (
                    <div key={c.oracleId} className="w-24 shrink-0 snap-start sm:w-auto">
                      <CardTile
                        card={c}
                        onDetails={guardPoolDetails}
                        onAdd={add}
                        onPointerDragStart={beginPoolDrag}
                        dragClassName="touch-pan-x sm:touch-auto"
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>

          <section className="min-h-[520px] rounded-2xl border border-white/10 bg-white/[.02] p-4 sm:min-h-[760px]">
            {active ? (
              <DeckBoard
                entries={active.cards}
                commanderOracleId={active.commanderOracleId}
                cardOf={cardOf}
                layout={active.layout || baseLayout}
                dragActive={!!(drag && drag.moved)}
                onMoveCard={(id, p) => updateLayout({ positions: { ...(active.layout?.positions || {}), [id]: p } })}
                onRemoveOne={remove}
                onSetCommander={setCommander}
                onClearCommander={() => save(active.id, { commanderOracleId: null })}
                onDetails={setDetail}
              />
            ) : (
              <p className="grid h-full place-items-center text-slate-500">先在右侧新建一个牌组</p>
            )}
          </section>

          <DeckSidebar
            decks={decks}
            activeDeckId={activeId}
            onSelect={setActiveId}
            onCreate={(n) => api.createDeck(n).then((d) => { setDecks((p) => [...p, d]); setActiveId(d.id); })}
            onDelete={(id) => api.deleteDeck(id).then(() => { setDecks((p) => p.filter((d) => d.id !== id)); setActiveId(null); })}
            onRename={(id, n) => save(id, { name: n })}
          />
        </div>
      </main>

      {/* 拖拽中的卡牌幽灵：固定在指针下方，抓取点保持原位 */}
      {ghost && (
        <div
          className="pointer-events-none fixed left-0 top-0 z-[80]"
          style={{ transform: `translate3d(${ghost.x - ghost.offsetX}px, ${ghost.y - ghost.offsetY}px, 0)` }}
        >
          <div className="w-24 rotate-3 rounded-lg shadow-[0_20px_50px_rgba(0,0,0,.6)] ring-2 ring-cyan-300/70">
            {ghostImage ? (
              <img src={ghostImage} alt="" draggable={false} className="aspect-[5/7] w-full rounded-lg object-cover" />
            ) : (
              <div className="grid aspect-[5/7] w-full place-items-center rounded-lg bg-[#12142a] text-3xl">🃏</div>
            )}
          </div>
        </div>
      )}

      <CardDetailModal card={detail} onClose={() => setDetail(null)} onAdd={add} onCommander={setCommander} />
    </div>
  );
}
