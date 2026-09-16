'use client';

/**
 * EDH 记血器 —— 掷骰历史弹窗。
 *
 * 优先读服务器的 SQLite（/api/edh-life/games/:id/rolls，一局一条记录），
 * 服务器不可用时回退到本机这局缓存的历史，保证离线也能看。
 */

import { useCallback, useEffect, useState } from 'react';
import { formatClock, formatDuration, type GameState, type RollRecord } from '@/lib/edh-life/types';
import { deleteGame, fetchGames, listGamesLocal, type GameSummary } from '@/lib/edh-life/storage';

interface ServerRoll {
  id: string;
  at: string;
  source: string;
  notation: string;
  total: number;
  seat: number | null;
  detail: { values?: number[]; coinFace?: 'one' | 'sun' } | null;
}

interface HistoryPanelProps {
  game: GameState;
  seat: number | null;
  onClose: () => void;
}

function serverRollToRecord(roll: ServerRoll): RollRecord {
  return {
    id: roll.id,
    at: new Date(roll.at).getTime() || Date.now(),
    source: roll.source === 'coin' ? 'coin' : 'dice',
    notation: roll.notation,
    total: roll.total,
    seat: roll.seat,
    values: roll.detail?.values ?? [],
    coinFace: roll.detail?.coinFace,
  };
}

export default function HistoryPanel({ game, seat, onClose }: HistoryPanelProps) {
  const [rolls, setRolls] = useState<RollRecord[] | null>(null);
  const [source, setSource] = useState<'server' | 'local'>('local');

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/edh-life/games/${encodeURIComponent(game.id)}/rolls`, { credentials: 'same-origin' });
      if (response.ok) {
        const data = (await response.json()) as { rolls?: ServerRoll[] };
        if (Array.isArray(data.rolls)) {
          setRolls(data.rolls.map(serverRollToRecord));
          setSource('server');
          return;
        }
      }
    } catch { /* 回退到本地 */ }
    setRolls([...game.rolls].reverse());
    setSource('local');
  }, [game.id, game.rolls]);

  useEffect(() => { void load(); }, [load]);

  const title = seat === null ? '本局掷骰历史' : `玩家 ${seat + 1} 的掷骰历史`;

  return (
    <div className="edh-modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edh-history" role="dialog" aria-label={title}>
        <div className="edh-history-head">
          <span className="edh-history-title">{title}</span>
          <span className="edh-history-source">{source === 'server' ? '已同步到数据库' : '仅本机记录'}</span>
          <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
        </div>

        <div className="edh-history-list">
          {rolls === null && <div className="edh-history-empty">读取中…</div>}
          {rolls !== null && rolls.length === 0 && <div className="edh-history-empty">本局还没有掷过骰子</div>}
          {rolls !== null && rolls.map((roll) => {
            const visible = seat === null || roll.seat === seat || roll.seat === null;
            if (!visible) return null;
            return (
              <div key={roll.id} className="edh-history-row">
                <span className="edh-history-time">{formatClock(roll.at)}</span>
                <span className="edh-history-notation">{roll.source === 'coin' ? '硬币' : roll.notation}</span>
                <span className="edh-history-dice">
                  {roll.source === 'coin'
                    ? roll.coinFace === 'one' ? '1' : '2'
                    : roll.values.map((value, index) => <b key={index}>{value}</b>)}
                </span>
                <span className="edh-history-total">
                  {roll.source === 'coin' ? `= ${roll.coinFace === 'one' ? '1' : '2'}` : `= ${roll.total}`}
                </span>
                {roll.seat !== null && <span className="edh-history-seat">P{roll.seat + 1}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 存档管理：列出已封存的存档（一局 = 一条），支持读档与删除。
 * 删除会弹确认框，并同时清掉本机与服务端的记录。
 */
export function ArchivePanel({ onLoad, onClose }: { onLoad: (id: string, fromServer: boolean) => void; onClose: () => void }) {
  const [items, setItems] = useState<GameSummary[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GameSummary | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    // 本机缓存里只把"已结束"的当存档；正在进行的对局不算存档
    const localSummaries: GameSummary[] = listGamesLocal()
      .filter((state) => state.status === 'finished')
      .map((state) => ({
        id: state.id,
        title: state.title,
        playerCount: state.playerCount,
        startingLife: state.startingLife,
        round: state.round,
        status: state.status,
        winnerSeat: state.winnerSeat,
        startedAt: new Date(state.startedAt).toISOString(),
        endedAt: state.endedAt ? new Date(state.endedAt).toISOString() : null,
        durationSeconds: state.durationSeconds,
        updatedAt: new Date(state.endedAt ?? state.startedAt).toISOString(),
        players: state.players.map((player) => ({
          seat: player.seat, name: player.name, color: player.color, life: player.life,
          poison: player.poison, energy: player.energy, treasure: player.treasure,
          clue: player.clue, food: player.food, experience: player.experience,
          eliminated: player.eliminated, eliminatedReason: player.eliminatedReason,
        })),
        fromServer: false,
      }));

    const merged = new Map<string, GameSummary>();
    for (const entry of localSummaries) merged.set(entry.id, entry);
    for (const entry of (await fetchGames({ onlyFinished: true })) ?? []) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
    setItems([...merged.values()].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const remove = useCallback(async (entry: GameSummary) => {
    await deleteGame(entry.id);
    setPendingDelete(null);
    setNotice(`已删除「${entry.title}」`);
    await refresh();
  }, [refresh]);

  return (
    <div className="edh-panel" role="dialog" aria-label="存档">
      <div className="edh-panel-head">
        <span>存档</span>
        <span className="edh-panel-sub">一局对战 = 一条存档</span>
        <button type="button" className="edh-icon-btn" onPointerDown={(e) => { e.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
      </div>

      {notice && <div className="edh-panel-note">{notice}</div>}

      <div className="edh-history-list">
        {items === null && <div className="edh-history-empty">读取中…</div>}
        {items !== null && items.length === 0 && <div className="edh-history-empty">还没有存档（结束一局后会自动封存）</div>}
        {items?.map((entry) => (
          <div className="edh-load-row" key={`${entry.fromServer ? 's' : 'l'}-${entry.id}`} data-archive-row={entry.id}>
            <div className="edh-load-main">
              <span className="edh-load-title">{entry.title}</span>
              <span className="edh-load-meta">
                {entry.playerCount} 人 · 时长 {formatDuration(entry.durationSeconds)}
                {entry.winnerSeat !== null ? ` · 胜者 P${entry.winnerSeat + 1}` : ''}
                {` · 生命 ${entry.players.map((player) => player.life).join('/')}`}
              </span>
            </div>
            <span className="edh-load-swatches">
              {entry.players.map((player) => (
                <i key={player.seat} className="edh-load-swatch" style={{ background: player.color }} />
              ))}
            </span>
            <button
              type="button"
              className="edh-load-btn"
              data-archive-load={entry.id}
              onPointerDown={(e) => { e.preventDefault(); onLoad(entry.id, Boolean(entry.fromServer)); }}
            >读档</button>
            <button
              type="button"
              className="edh-load-btn is-danger"
              data-archive-delete={entry.id}
              onPointerDown={(e) => { e.preventDefault(); setPendingDelete(entry); }}
            >删除</button>
          </div>
        ))}
      </div>

      {pendingDelete && (
        <div className="edh-confirm-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) setPendingDelete(null); }}>
          <div className="edh-confirm" role="alertdialog" aria-label="确认删除存档">
            <div className="edh-confirm-title">删除这条存档？</div>
            <div className="edh-confirm-body">
              「{pendingDelete.title}」<br />
              {pendingDelete.playerCount} 人 · 时长 {formatDuration(pendingDelete.durationSeconds)}<br />
              删除后无法恢复。
            </div>
            <div className="edh-numpad-actions">
              <button type="button" className="edh-numpad-action" data-cancel onPointerDown={(e) => { e.preventDefault(); setPendingDelete(null); }}>取消</button>
              <button type="button" className="edh-numpad-action is-danger" data-confirm-delete onPointerDown={(e) => { e.preventDefault(); void remove(pendingDelete); }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
