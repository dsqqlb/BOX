'use client';

import { useEffect, useMemo, useState } from 'react';
import { KardsCard, KardsCatalog, KardsDeck } from '@/lib/kards/types';
import { buildCardMap, cardCounts, dominantFaction, filterCards } from '@/lib/kards/catalog';
import CardImage from './CardImage';

const MAX_COPIES = 3;
const MAX_TOTAL = 100;

interface DeckBuilderProps {
  catalog: KardsCatalog;
  decks: KardsDeck[];
  refreshDecks: () => void;
  draftCards: string[];
  onDraftChange: (cards: string[]) => void;
  onStartBattle: (deckCards: string[]) => void;
  notify: (message: string, kind?: 'ok' | 'warn' | 'error') => void;
}

export default function DeckBuilder({ catalog, decks, refreshDecks, draftCards, onDraftChange, onStartBattle, notify }: DeckBuilderProps) {
  const cardMap = useMemo(() => buildCardMap(catalog.cards), [catalog]);
  const [query, setQuery] = useState('');
  const [faction, setFaction] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [deckName, setDeckName] = useState('');
  const [savedDeckId, setSavedDeckId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => filterCards(catalog.cards, { q: query, faction, cost }),
    [catalog.cards, query, faction, cost],
  );

  const counts = useMemo(() => cardCounts(draftCards), [draftCards]);
  const mainFaction = useMemo(() => dominantFaction(draftCards, cardMap), [draftCards, cardMap]);

  useEffect(() => {
    if (deckName) return;
    if (mainFaction) setDeckName(mainFaction);
  }, [mainFaction, deckName]);

  function addCard(card: KardsCard) {
    if ((counts.get(card.id) || 0) >= MAX_COPIES) {
      notify(`「${card.name}」最多带 ${MAX_COPIES} 张`, 'warn');
      return;
    }
    if (draftCards.length >= MAX_TOTAL) {
      notify(`牌组最多 ${MAX_TOTAL} 张`, 'warn');
      return;
    }
    onDraftChange([...draftCards, card.id]);
  }

  function removeCard(cardId: string) {
    const index = draftCards.lastIndexOf(cardId);
    if (index < 0) return;
    onDraftChange(draftCards.filter((_, i) => i !== index));
  }

  function resetDeck() {
    onDraftChange([]);
    setDeckName('');
    setSavedDeckId(null);
  }

  function loadDeck(deck: KardsDeck) {
    onDraftChange([...deck.cards]);
    setDeckName(deck.name);
    setSavedDeckId(deck.id);
  }

  async function saveDeck() {
    const name = deckName.trim();
    if (!name) {
      notify('先给牌组起个名字', 'warn');
      return;
    }
    setSaving(true);
    try {
      if (savedDeckId) {
        await import('@/lib/kards/api').then((api) => api.updateDeck(savedDeckId, { name, cards: draftCards }));
      } else {
        await import('@/lib/kards/api').then((api) => api.createDeck(name, draftCards));
      }
      refreshDecks();
      notify('牌组已保存');
    } catch (error) {
      notify(error instanceof Error ? error.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function removeSavedDeck(deckId: string) {
    if (!window.confirm('确定删除这副牌组吗？')) return;
    try {
      await import('@/lib/kards/api').then((api) => api.deleteDeck(deckId));
      if (savedDeckId === deckId) resetDeck();
      refreshDecks();
      notify('牌组已删除');
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败', 'error');
    }
  }

  const uniqueDeckCards = useMemo(
    () => [...counts.keys()].map((id) => cardMap.get(id)).filter((card): card is KardsCard => !!card)
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh-Hans-CN')),
    [counts, cardMap],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 过滤器 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索卡名…"
          className="h-9 w-48 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/60"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setFaction(null)}
            className={`h-7 rounded-full px-3 text-xs transition ${faction === null ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}
          >
            全部阵营
          </button>
          {catalog.factions.map((f) => (
            <button
              key={f}
              onClick={() => setFaction(faction === f ? null : f)}
              className={`h-7 rounded-full px-3 text-xs transition ${faction === f ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setCost(null)}
            className={`h-7 rounded-lg px-2.5 text-xs transition ${cost === null ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}
          >
            全部费用
          </button>
          {catalog.costs.map((c) => (
            <button
              key={c}
              onClick={() => setCost(cost === c ? null : c)}
              className={`h-7 rounded-lg px-2.5 text-xs transition ${cost === c ? 'bg-amber-500 text-zinc-950' : 'border border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500'}`}
            >
              {c}k
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">
          显示 {filtered.length} / {catalog.total} 张
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* 卡池 */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,1fr))] gap-2.5">
            {filtered.map((card) => {
              const count = counts.get(card.id) || 0;
              const maxed = count >= MAX_COPIES;
              return (
                <button
                  key={card.id}
                  onClick={() => addCard(card)}
                  title={`${card.name}（${card.faction} ${card.cost}k）`}
                  className={`group relative text-left transition ${maxed ? 'cursor-not-allowed opacity-40' : 'hover:-translate-y-0.5 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-amber-500/60'}`}
                >
                  <CardImage path={card.path} name={card.name} />
                  {count > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-950 bg-amber-500 px-1 text-[11px] font-bold text-zinc-950 shadow">
                      ×{count}
                    </span>
                  )}
                  <div className="mt-1 truncate text-[11px] leading-tight text-zinc-400">
                    <span className="mr-1 rounded bg-zinc-800 px-1 text-[10px] font-semibold text-amber-400/90">{card.cost}k</span>
                    {card.name}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full py-12 text-center text-sm text-zinc-500">没有符合条件的卡牌</div>
            )}
          </div>
        </div>

        {/* 牌组面板 */}
        <aside className="flex w-80 shrink-0 flex-col rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 max-lg:w-64">
          <div className="flex items-center gap-2">
            <input
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
              placeholder="牌组名称"
              className="h-9 flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-amber-500/60"
            />
            <button
              onClick={saveDeck}
              disabled={saving}
              className="h-9 rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {saving ? '保存中…' : savedDeckId ? '更新' : '保存'}
            </button>
            <button
              onClick={resetDeck}
              title="清空当前组牌"
              className="h-9 rounded-lg border border-zinc-700 px-2.5 text-sm text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-200"
            >
              清空
            </button>
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
            <span className={`rounded-full px-2 py-0.5 ${draftCards.length >= 40 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'}`}>
              {draftCards.length} 张{draftCards.length < 40 ? '（不足 40）' : ''}
            </span>
            {mainFaction && <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">{mainFaction}</span>}
            <span className="ml-auto">每张最多 ×{MAX_COPIES}</span>
          </div>

          {decks.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-zinc-600">已保存的牌组</div>
              <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                {decks.map((deck) => (
                  <div key={deck.id} className="group flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-1.5">
                    <button
                      onClick={() => loadDeck(deck)}
                      className={`min-w-0 flex-1 truncate text-left text-xs ${savedDeckId === deck.id ? 'text-amber-400' : 'text-zinc-300 hover:text-zinc-100'}`}
                      title={deck.name}
                    >
                      {deck.name}
                      <span className="ml-1.5 text-[10px] text-zinc-600">{deck.cards.length} 张</span>
                    </button>
                    <button
                      onClick={() => removeSavedDeck(deck.id)}
                      className="text-xs text-zinc-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                      title="删除"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-600">
            <span>当前牌组</span>
            <span>{uniqueDeckCards.length} 种 / {draftCards.length} 张</span>
          </div>
          <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {uniqueDeckCards.map((card) => (
              <div key={card.id} className="flex items-center gap-2 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-1.5 py-1">
                <div className="w-7 shrink-0">
                  <CardImage path={card.path} name={card.name} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-zinc-200">{card.name}</div>
                  <div className="text-[10px] text-zinc-500">{card.faction} · {card.cost}k</div>
                </div>
                <span className="text-xs font-semibold text-amber-400/90">×{counts.get(card.id)}</span>
                <button
                  onClick={() => removeCard(card.id)}
                  className="rounded p-0.5 text-xs text-zinc-600 transition hover:text-red-400"
                  title="移出一张"
                >
                  −
                </button>
              </div>
            ))}
            {uniqueDeckCards.length === 0 && (
              <div className="py-8 text-center text-xs text-zinc-600">点左侧卡牌加入牌组</div>
            )}
          </div>

          <button
            onClick={() => onStartBattle(draftCards)}
            disabled={draftCards.length === 0}
            className="mt-3 h-11 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-sm font-bold text-zinc-950 shadow-lg shadow-orange-900/30 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            ⚔ 用这副牌开局
          </button>
        </aside>
      </div>
    </div>
  );
}
