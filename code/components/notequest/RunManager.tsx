'use client';

/**
 * 存档与墓地。
 *
 * 存档列表只读服务端返回的摘要列（不必解析整包快照）；
 * 墓地是原书第 24 页那张表，角色死亡或放弃时由服务端自动补记录。
 */

import Icon from './Icon';
import type { GraveSummary, RunSummary } from '@/lib/notequest/types';

interface RunManagerProps {
  runs: RunSummary[];
  graves: GraveSummary[];
  tab: 'runs' | 'graves';
  busy: boolean;
  currentId: string | null;
  onTabChange: (tab: 'runs' | 'graves') => void;
  onClose: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
}

function stamp(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusLabel(status: string): string {
  if (status === 'dead') return '已阵亡';
  if (status === 'cleared') return '已通关';
  return '进行中';
}

export default function RunManager(props: RunManagerProps) {
  const { runs, graves, tab, busy, currentId } = props;

  return (
    <div className="nq-modal" role="dialog" aria-modal="true">
      <div className="nq-modal-card">
        <header className="nq-modal-head">
          <div>
            <p className="nq-panel-title">存档与墓地</p>
            <p className="nq-panel-sub">每条存档都有完整快照：换设备、刷新浏览器都能接着玩</p>
          </div>
          <div className="nq-head-buttons">
            <button type="button" className="nq-mini" disabled={busy} onClick={props.onRefresh}>刷新</button>
            <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={props.onCreate}>新的一局</button>
            <button type="button" className="nq-mini" onClick={props.onClose}>关闭</button>
          </div>
        </header>

        <div className="nq-tabs">
          <button type="button" className={`nq-tab${tab === 'runs' ? ' is-active' : ''}`} onClick={() => props.onTabChange('runs')}>
            存档（{runs.length}）
          </button>
          <button type="button" className={`nq-tab${tab === 'graves' ? ' is-active' : ''}`} onClick={() => props.onTabChange('graves')}>
            墓地（{graves.length}）
          </button>
        </div>

        <div className="nq-modal-body">
          {tab === 'runs' && (
            <>
              {runs.length === 0 && <p className="nq-muted">还没有存档：点右上角「新的一局」掷一个角色出来。</p>}
              {runs.map((run) => (
                <div key={run.id} className={`nq-run${run.id === currentId ? ' is-current' : ''}`}>
                  <div className="nq-run-main">
                    <p className="nq-run-title">
                      <Icon name="dungeon" className="h-4 w-4" /> {run.title}
                      <span className={`nq-run-status nq-status-${run.status}`}>{statusLabel(run.status)}</span>
                    </p>
                    <p className="nq-run-sub">
                      {run.raceName}·{run.className} · {run.dungeonName}（第 {run.depth} 层） · HP {run.hp}/{run.maxHp} ·
                      火把 {run.torches} · 金币 {run.coins} · 财宝 {run.treasures} · 击杀 {run.kills} · 回合 {run.turns}
                    </p>
                    {run.outcomeText && <p className="nq-run-outcome">{run.outcomeText}</p>}
                    <p className="nq-run-time">更新于 {stamp(run.updatedAt)}</p>
                  </div>
                  <div className="nq-run-actions">
                    <button type="button" className="nq-mini nq-mini-strong" disabled={busy} onClick={() => props.onLoad(run.id)}>
                      {run.id === currentId ? '重新读取' : '读取'}
                    </button>
                    <button type="button" className="nq-mini nq-mini-ghost" disabled={busy} onClick={() => props.onDelete(run.id)}>删除</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'graves' && (
            <>
              {graves.length === 0 && <p className="nq-muted">墓地还空着——这通常是好消息。</p>}
              {graves.map((grave) => (
                <div key={grave.id} className="nq-run nq-grave">
                  <div className="nq-run-main">
                    <p className="nq-run-title"><Icon name="grave" className="h-4 w-4" /> {grave.characterName}</p>
                    <p className="nq-run-sub">
                      {grave.raceName}·{grave.className} · {grave.dungeonName}（第 {grave.depth} 层） ·
                      击杀 {grave.kills} · 财宝 {grave.treasures}
                    </p>
                    <p className="nq-run-outcome">死因：{grave.cause}</p>
                    <p className="nq-run-time">{stamp(grave.diedAt)}</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}