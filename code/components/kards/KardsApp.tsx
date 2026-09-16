'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import { KardsCatalog, KardsDeck } from '@/lib/kards/types';
import { fetchCatalog, listDecks } from '@/lib/kards/api';
import DeckBuilder from './DeckBuilder';
import BattleTable from './BattleTable';
import RoomLobby from './RoomLobby';

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

  function startBattle(mode: 'create' | 'join', roomId: string | null, deckCards: string[]) {
    setBattle({
      mode,
      roomId,
      deckCards,
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
          <RoomLobby
            catalog={catalog}
            decks={decks}
            builderDraft={builderDraft}
            initialRoomId={joinRoomId}
            onStartBattle={startBattle}
            notify={notify}
          />
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
