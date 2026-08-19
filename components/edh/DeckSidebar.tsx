'use client';

import { useState } from 'react';
import { EdhDeck } from '@/lib/edh/types';

interface DeckSidebarProps {
  decks: EdhDeck[];
  activeDeckId: string | null;
  onSelect: (deckId: string) => void;
  onCreate: (name: string) => void;
  onDelete: (deckId: string) => void;
  onRename: (deckId: string, name: string) => void;
}

export default function DeckSidebar({ decks, activeDeckId, onSelect, onCreate, onDelete, onRename }: DeckSidebarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const submitCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreating(false);
  };

  const submitRename = (deckId: string) => {
    const name = renameValue.trim();
    if (name) onRename(deckId, name);
    setRenamingId(null);
  };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-400">我的牌组</p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="grid h-6 w-6 place-items-center rounded-lg border border-white/10 text-slate-300 transition hover:border-cyan-300/40 hover:text-cyan-200"
          title="新建牌组"
          aria-label="新建牌组"
        >
          +
        </button>
      </div>

      {creating && (
        <div className="mb-2 flex items-center gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') submitCreate(); if (event.key === 'Escape') setCreating(false); }}
            placeholder="牌组名称"
            className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-300/50"
          />
          <button type="button" onClick={submitCreate} className="rounded-lg bg-cyan-500/20 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-500/30">建</button>
        </div>
      )}

      <div className="flex-1 space-y-1 overflow-y-auto">
        {decks.length === 0 && !creating && <p className="px-1 py-6 text-center text-xs text-slate-500">还没有牌组，点击 + 新建一个</p>}
        {decks.map((deck) => (
          <div
            key={deck.id}
            className={`group flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs transition ${
              deck.id === activeDeckId ? 'bg-violet-400/15 text-white' : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
            }`}
          >
            {renamingId === deck.id ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') submitRename(deck.id); if (event.key === 'Escape') setRenamingId(null); }}
                onBlur={() => submitRename(deck.id)}
                className="flex-1 rounded border border-cyan-300/40 bg-slate-950/60 px-1.5 py-0.5 text-white outline-none"
              />
            ) : (
              <button type="button" onClick={() => onSelect(deck.id)} className="flex-1 truncate text-left">
                {deck.name}
                <span className="ml-1.5 text-[10px] text-slate-500">
                  {deck.cards.reduce((sum, entry) => sum + entry.quantity, 0) + (deck.commanderOracleId ? 1 : 0)}/100
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => { setRenamingId(deck.id); setRenameValue(deck.name); }}
              className="opacity-0 transition hover:text-cyan-200 group-hover:opacity-100"
              title="重命名"
              aria-label={`重命名 ${deck.name}`}
            >
              ✎
            </button>
            <button
              type="button"
              onClick={() => { if (confirm(`确定删除牌组「${deck.name}」吗？此操作无法撤销。`)) onDelete(deck.id); }}
              className="opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
              title="删除"
              aria-label={`删除 ${deck.name}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
