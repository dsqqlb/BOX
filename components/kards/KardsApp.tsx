'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import { KardsCatalog, KardsDeck } from '@/lib/kards/types';
import { fetchCatalog, listDecks } from '@/lib/kards/api';
import DeckBuilder from './DeckBuilder';
import BattleTable from './BattleTable';

interface Notice {
  message: string;
  kind: 'ok' | 'warn' | 'error';
}

interface BattleRequest {
  mode: 'create' | 'join';
  roomId?: string | null;
  deckCards: string[];
  key: number;
}

export default function KardsApp() {
  const [catalog, setCatalog] = useState<KardsCatalog | null>(null);
  const [decks, setDecks] = useState<KardsDeck[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<'deck' | 'table'>('deck');
  const [builderDraft, setBuilderDraft] = useState<string[]>([]);
  const [battle, setBattle] = useState<BattleRequest | null>(null);
  const [joinRoomId, setJoinRoomId] = useState('');
  const [battleDeckId, setBattleDeckId] = useState<string>('draft');
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimerRef = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string, kind: Notice['kind'] = 'ok') => {
    setNotice({ message, kind });
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const refreshDecks = useCallback(async () => {
    try {
      setDecks(await listDecks());
    } catch {
      // 列表失败不打断当前操作
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cat, deckList] = await Promise.all([fetchCatalog(), listDecks()]);
        if (cancelled) return;
        setCatalog(cat);
        setDecks(deckList);
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '加载失败');
      }
    })();
    const roomFromUrl = new URLSearchParams(window.location.search).get('room');
    if (roomFromUrl) {
      // 房间链接只预填房间号并切到对战桌页：先选好出战牌组再点「加入房间」，
      // 避免没有牌组就空手进桌（服务端允许空牌库，但桌上没有可操作的牌）。
      setJoinRoomId(roomFromUrl);
      setTab('table');
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBattleCards = useMemo(() => {
    if (battleDeckId === 'draft') return builderDraft;
    return decks.find((deck) => deck.id === battleDeckId)?.cards || [];
  }, [battleDeckId, builderDraft, decks]);

  function startBattle(mode: 'create' | 'join', roomId?: string | null, deckCards?: string[]) {
    setBattle({
      mode,
      roomId: roomId ?? null,
      deckCards: deckCards ?? selectedBattleCards,
      key: Date.now(),
    });
  }

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col bg-[#070915] text-slate-100">
        <ToolHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-zinc-400">
          <span>⚠️ {loadError}</span>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-zinc-700 px-4 py-2 transition hover:border-amber-500/60 hover:text-amber-300"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="flex min-h-screen flex-col bg-[#070915] text-slate-100">
        <ToolHeader />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-amber-500" />
          正在加载卡牌目录…
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-[#070915] text-slate-100">
      <ToolHeader />
      <div className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col gap-2 px-3 py-3">
        {/* 页签 */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-zinc-800 bg-zinc-950/60 p-1">
            <button
              onClick={() => { setTab('deck'); setBattle(null); }}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'deck' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              🗃 组卡器
            </button>
            <button
              onClick={() => setTab('table')}
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === 'table' ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              ⚔ 对战桌
            </button>
          </div>
          <span className="text-xs text-zinc-600">共 {catalog.total} 张卡 · {catalog.factions.length} 个阵营</span>
        </div>

        {tab === 'deck' && (
          <DeckBuilder
            catalog={catalog}
            decks={decks}
            refreshDecks={refreshDecks}
            draftCards={builderDraft}
            onDraftChange={setBuilderDraft}
            onStartBattle={(deckCards) => {
              setBuilderDraft(deckCards);
              startBattle('create', null, deckCards);
              setTab('table');
            }}
            notify={notify}
          />
        )}

        {tab === 'table' && !battle && (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
              <h2 className="text-lg font-bold text-zinc-100">建立对战桌</h2>
              <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                房主创建房间后，把 6 位房间号或链接发给对方。所有操作由玩家手动进行：抽牌、出牌、翻面、旋转、伤害与 kredits 都由桌面上完成，模拟器不判定规则。
              </p>

              <div className="mt-4">
                <div className="mb-1 text-xs text-zinc-500">出战牌组</div>
                <select
                  value={battleDeckId}
                  onChange={(event) => setBattleDeckId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-200 outline-none focus:border-amber-500/60"
                >
                  <option value="draft">当前草稿（{builderDraft.length} 张）</option>
                  {decks.map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}（{deck.cards.length} 张）
                    </option>
                  ))}
                </select>
                {battleDeckId === 'draft' && builderDraft.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-400/80">当前草稿为空，建议先去组卡器组一副牌</p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => startBattle('create')}
                  disabled={selectedBattleCards.length === 0}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-sm font-bold text-zinc-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🏳 创建房间
                </button>
                <button
                  onClick={() => startBattle('join', joinRoomId.trim())}
                  disabled={!/^\d{6}$/.test(joinRoomId.trim())}
                  className="h-11 rounded-xl border border-amber-500/50 bg-amber-500/10 text-sm font-bold text-amber-300 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  🔑 加入房间
                </button>
              </div>

              <div className="mt-3">
                <div className="mb-1 text-xs text-zinc-500">输入对方给你的房间号</div>
                <input
                  value={joinRoomId}
                  onChange={(event) => setJoinRoomId(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6 位数字房间号"
                  inputMode="numeric"
                  className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 font-mono text-lg tracking-[0.5em] text-zinc-100 outline-none focus:border-amber-500/60"
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'table' && battle && (
          <BattleTable
            key={battle.key}
            catalog={catalog}
            mode={battle.mode}
            initialRoomId={battle.roomId}
            deckCards={battle.deckCards}
            onExit={() => {
              setBattle(null);
              setTab('table');
            }}
          />
        )}
      </div>

      {notice && (
        <div
          className={`fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-full border px-4 py-2 text-sm shadow-xl backdrop-blur ${
            notice.kind === 'error'
              ? 'border-red-800 bg-red-950/90 text-red-200'
              : notice.kind === 'warn'
                ? 'border-amber-700 bg-amber-950/90 text-amber-200'
                : 'border-emerald-800 bg-emerald-950/90 text-emerald-200'
          }`}
        >
          {notice.message}
        </div>
      )}
    </div>
  );
}
