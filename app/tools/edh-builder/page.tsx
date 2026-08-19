'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import SearchPanel, { EMPTY_SEARCH_STATE, SearchPanelState } from '@/components/edh/SearchPanel';
import CardTile from '@/components/edh/CardTile';
import CardPreview from '@/components/edh/CardPreview';
import DeckBoard from '@/components/edh/DeckBoard';
import DeckSidebar from '@/components/edh/DeckSidebar';
import * as edhApi from '@/lib/edh/api';
import { EdhCard, EdhCardsMeta, EdhDeck, EdhSearchFilters } from '@/lib/edh/types';

function toFilters(state: SearchPanelState): EdhSearchFilters {
  return {
    q: state.q,
    colors: state.colors,
    colorMode: state.colorMode,
    types: state.types,
    cmcMin: state.cmcMin.trim() ? Number(state.cmcMin) : null,
    cmcMax: state.cmcMax.trim() ? Number(state.cmcMax) : null,
    commanderOnly: state.commanderOnly,
  };
}

export default function EdhBuilderPage() {
  const [authResolved, setAuthResolved] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  const [meta, setMeta] = useState<EdhCardsMeta | null>(null);
  const [searchState, setSearchState] = useState<SearchPanelState>(EMPTY_SEARCH_STATE);
  const [searchResults, setSearchResults] = useState<EdhCard[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [decks, setDecks] = useState<EdhDeck[]>([]);
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [cardCache, setCardCache] = useState<Map<string, EdhCard>>(new Map());
  const [previewCard, setPreviewCard] = useState<EdhCard | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // 首页也是这个模式：客户端只负责展示，真正的登录态和工具权限由 server/index.js 强制校验。
  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      .then((response) => {
        if (!response.ok) throw new Error('未登录');
        return response.json() as Promise<{ allowedTools: string[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setAuthorized(data.allowedTools.includes('edh-builder'));
      })
      .catch(() => {
        if (!cancelled) window.location.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setAuthResolved(true);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authorized) return;
    edhApi.getCardsMeta().then(setMeta).catch(() => setMeta({ synced: false }));
    edhApi.listDecks().then((list) => {
      setDecks(list);
      if (list.length > 0) setActiveDeckId(list[0].id);
    }).catch((error) => setDeckError(error.message));
  }, [authorized]);

  // 搜索防抖：输入/筛选变化后 350ms 才真正发请求，避免每敲一个字都打后端。
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!authorized) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      edhApi.searchCards(toFilters(searchState))
        .then((result) => { setSearchResults(result.cards); setSearchTotal(result.total); })
        .catch((error) => setSearchError(error.message))
        .finally(() => setSearching(false));
    }, 350);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchState, authorized]);

  const activeDeck = useMemo(() => decks.find((deck) => deck.id === activeDeckId) || null, [decks, activeDeckId]);

  // 把当前牌组涉及到的 oracleId 换成完整卡牌信息，缺哪些就只请求缺的那些。
  useEffect(() => {
    if (!activeDeck) return;
    const ids = [...activeDeck.cards.map((c) => c.oracleId), ...(activeDeck.commanderOracleId ? [activeDeck.commanderOracleId] : [])];
    const missing = ids.filter((id) => !cardCache.has(id));
    if (missing.length === 0) return;
    edhApi.lookupCards(missing).then((cards) => {
      setCardCache((prev) => {
        const next = new Map(prev);
        cards.forEach((card) => next.set(card.oracleId, card));
        return next;
      });
    }).catch(() => { /* 查询失败时保留已缓存部分，不阻塞其它操作 */ });
  }, [activeDeck, cardCache]);

  // 搜索结果里的卡也顺手放进缓存，拖进牌组后不需要再等一次网络请求。
  useEffect(() => {
    if (searchResults.length === 0) return;
    setCardCache((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const card of searchResults) {
        if (!next.has(card.oracleId)) { next.set(card.oracleId, card); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [searchResults]);

  const cardOf = useCallback((oracleId: string) => cardCache.get(oracleId), [cardCache]);

  const persistDeck = useCallback(async (deckId: string, patch: { commanderOracleId?: string | null; cards?: { oracleId: string; quantity: number }[] }) => {
    try {
      const updated = await edhApi.updateDeck(deckId, patch);
      setDecks((prev) => prev.map((deck) => (deck.id === deckId ? updated : deck)));
      setDeckError(null);
    } catch (error) {
      setDeckError(error instanceof Error ? error.message : '更新牌组失败');
    }
  }, []);

  const addCardToDeck = useCallback((card: EdhCard) => {
    if (!activeDeck) { setDeckError('请先在左侧新建或选择一个牌组'); return; }
    if (activeDeck.commanderOracleId === card.oracleId) return; // 已是指挥官，不重复加入卡组列表
    const existing = activeDeck.cards.find((entry) => entry.oracleId === card.oracleId);
    const isBasicLand = card.typeLine.toLowerCase().includes('basic land');
    const nextQuantity = existing ? existing.quantity + 1 : 1;
    if (!isBasicLand && nextQuantity > 1) return; // EDH 单卡限制（基本地不受限）
    const cards = existing
      ? activeDeck.cards.map((entry) => (entry.oracleId === card.oracleId ? { ...entry, quantity: nextQuantity } : entry))
      : [...activeDeck.cards, { oracleId: card.oracleId, quantity: 1 }];
    persistDeck(activeDeck.id, { cards });
  }, [activeDeck, persistDeck]);

  const removeOneFromDeck = useCallback((card: EdhCard) => {
    if (!activeDeck) return;
    const cards = activeDeck.cards
      .map((entry) => (entry.oracleId === card.oracleId ? { ...entry, quantity: entry.quantity - 1 } : entry))
      .filter((entry) => entry.quantity > 0);
    persistDeck(activeDeck.id, { cards });
  }, [activeDeck, persistDeck]);

  const setCommander = useCallback((card: EdhCard) => {
    if (!activeDeck) return;
    if (!card.isCommanderEligible) { setDeckError(`「${card.nameZh || card.name}」不具备担任指挥官的资格`); return; }
    const cards = activeDeck.cards.filter((entry) => entry.oracleId !== card.oracleId);
    persistDeck(activeDeck.id, { commanderOracleId: card.oracleId, cards });
  }, [activeDeck, persistDeck]);

  const handleDropByOracleId = useCallback((oracleId: string) => {
    const card = cardOf(oracleId);
    if (card) addCardToDeck(card);
  }, [cardOf, addCardToDeck]);

  const createDeck = useCallback((name: string) => {
    edhApi.createDeck(name).then((deck) => { setDecks((prev) => [...prev, deck]); setActiveDeckId(deck.id); }).catch((error) => setDeckError(error.message));
  }, []);

  const renameDeck = useCallback((deckId: string, name: string) => {
    edhApi.updateDeck(deckId, { name })
      .then((updated) => setDecks((prev) => prev.map((deck) => (deck.id === deckId ? updated : deck))))
      .catch((error) => setDeckError(error.message));
  }, []);

  const removeDeck = useCallback((deckId: string) => {
    edhApi.deleteDeck(deckId).then(() => {
      setDecks((prev) => prev.filter((deck) => deck.id !== deckId));
      setActiveDeckId((current) => (current === deckId ? null : current));
    }).catch((error) => setDeckError(error.message));
  }, []);

  if (!authResolved) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#070915] text-slate-300">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm backdrop-blur-xl">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
          正在验证访问权限…
        </div>
      </div>
    );
  }
  if (!authorized) return null; // 未授权：/api/auth/me 已经把用户送回登录页

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#070915] text-slate-100">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(91,77,211,.24),transparent_30%),radial-gradient(circle_at_88%_16%,rgba(8,145,178,.14),transparent_27%),linear-gradient(180deg,#10132d_0%,#080a18_46%,#070915_100%)]" />
      </div>

      <ToolHeader className="!border-white/10 !bg-[#080a18]/70" textClassName="!text-slate-400 hover:!text-white" />

      <div className="mx-auto max-w-[1600px] px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-violet-300">EDH DECK FORGE</p>
            <h1 className="text-xl font-semibold text-white">指挥官组卡台</h1>
          </div>
          {meta && (
            <p className="text-xs text-slate-500">
              {meta.synced
                ? `卡库共 ${meta.cardCount} 张，中文覆盖 ${meta.chineseCoverage}（${meta.cardCount ? ((meta.chineseCoverage! / meta.cardCount) * 100).toFixed(1) : 0}%）`
                : '卡牌数据库尚未同步，请在服务器执行 npm run sync:edh-cards'}
            </p>
          )}
        </div>

        {deckError && (
          <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{deckError}</div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1.7fr_0.9fr]">
          {/* 左：搜索 + 卡池 + 预览 */}
          <div className="flex flex-col gap-4">
            <SearchPanel state={searchState} onChange={setSearchState} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>卡池结果</span>
                  {!searching && <span>{searchTotal} 张</span>}
                </div>
                {searchError && <p className="text-xs text-rose-300">{searchError}</p>}
                <div className="grid max-h-[560px] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                  {searching && searchResults.length === 0 && <p className="col-span-full py-8 text-center text-xs text-slate-500">搜索中…</p>}
                  {!searching && searchResults.length === 0 && !searchError && (
                    <p className="col-span-full py-8 text-center text-xs text-slate-500">没有找到匹配的卡牌</p>
                  )}
                  {searchResults.map((card) => (
                    <CardTile key={card.oracleId} card={card} onAdd={addCardToDeck} onSetCommander={setCommander} onPreview={setPreviewCard} />
                  ))}
                </div>
              </div>
              <div className="hidden sm:block">
                <CardPreview card={previewCard} />
              </div>
            </div>
          </div>

          {/* 中：牌组编辑区 */}
          <div
            onDragEnter={() => setDragActive(true)}
            onDragLeave={() => setDragActive(false)}
            onDrop={() => setDragActive(false)}
            className={`min-h-[640px] rounded-2xl border border-white/10 bg-white/[0.02] p-4 transition ${dragActive ? 'ring-2 ring-cyan-300/40' : ''}`}
          >
            {activeDeck ? (
              <DeckBoard
                entries={activeDeck.cards}
                commanderOracleId={activeDeck.commanderOracleId}
                cardOf={cardOf}
                onDropCard={handleDropByOracleId}
                onRemoveOne={removeOneFromDeck}
                onSetCommander={setCommander}
                onPreview={setPreviewCard}
              />
            ) : (
              <div className="grid h-full min-h-[500px] place-items-center text-center text-sm text-slate-500">
                在右侧新建一个牌组开始组卡
              </div>
            )}
          </div>

          {/* 右：牌组管理 */}
          <div className="min-h-[300px]">
            <DeckSidebar
              decks={decks}
              activeDeckId={activeDeckId}
              onSelect={setActiveDeckId}
              onCreate={createDeck}
              onDelete={removeDeck}
              onRename={renameDeck}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
