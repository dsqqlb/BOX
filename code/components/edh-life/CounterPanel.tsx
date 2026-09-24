'use client';

import { COUNTERS, type CounterKey, type PlayerState } from '@/lib/edh-life/types';
import RotatableModal from '@/components/edh-life/RotatableModal';

interface CounterPanelProps {
  player: PlayerState;
  initialRotation: number;
  onChange: (key: CounterKey, delta: number) => void;
  onOpenInput: (key: CounterKey) => void;
  onClose: () => void;
}

export default function CounterPanel({
  player,
  initialRotation,
  onChange,
  onOpenInput,
  onClose,
}: CounterPanelProps) {
  const active = COUNTERS.filter((meta) => player[meta.key] > 0);
  const available = COUNTERS.filter((meta) => player[meta.key] <= 0);

  return (
    <RotatableModal
      label={`${player.name} · 记录项目`}
      panelClassName="edh-panel edh-counter-panel"
      width={540}
      initialRotation={initialRotation}
      persistKey={`counter-${player.seat}`}
      onBackdrop={onClose}
    >
      <div className="edh-panel-head">
        <span>{player.name} · 记录项目</span>
        <span className="edh-panel-sub">{active.length ? `已记录 ${active.length} 项` : '尚未记录'}</span>
        <button type="button" className="edh-icon-btn" onPointerDown={(event) => { event.preventDefault(); onClose(); }} aria-label="关闭">✕</button>
      </div>

      <div className="edh-counter-panel-body">
        <section className="edh-counter-panel-section">
          <div className="edh-settings-label">当前记录</div>
          {active.length === 0 ? (
            <div className="edh-counter-empty">还没有记录项目，从下方选择一项开始。</div>
          ) : (
            <div className="edh-counter-active-grid">
              {active.map((meta, index) => {
                const value = player[meta.key];
                const lethal = meta.lethalAt !== null && value >= meta.lethalAt;
                return (
                  <div
                    key={meta.key}
                    className={`edh-counter-tile${lethal ? ' is-lethal' : ''}`}
                    style={{ '--counter-index': index } as React.CSSProperties}
                    data-counter-panel={meta.key}
                  >
                    <img src={meta.icon} alt="" aria-hidden="true" />
                    <div className="edh-counter-tile-main">
                      <span className="edh-counter-tile-label">{meta.label}</span>
                      <button
                        type="button"
                        className="edh-counter-tile-value"
                        title="点击输入任意值"
                        onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                        onClick={() => onOpenInput(meta.key)}
                      >{value}</button>
                    </div>
                    <div className="edh-counter-steps">
                      <button
                        type="button"
                        data-counter-minus={meta.key}
                        aria-label={`${meta.label} 减 1`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onChange(meta.key, -1);
                        }}
                      >−</button>
                      <button
                        type="button"
                        data-counter-plus={meta.key}
                        aria-label={`${meta.label} 加 1`}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          onChange(meta.key, 1);
                        }}
                      >＋</button>
                    </div>
                    {lethal && <span className="edh-counter-tile-lethal">致命</span>}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {available.length > 0 && (
          <section className="edh-counter-panel-section">
            <div className="edh-settings-label">添加记录</div>
            <div className="edh-counter-add-grid">
              {available.map((meta) => (
                <button
                  key={meta.key}
                  type="button"
                  className="edh-counter-add"
                  data-counter-add={meta.key}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(meta.key, 1);
                  }}
                >
                  <img src={meta.icon} alt="" aria-hidden="true" />
                  <span>{meta.label}</span>
                  <b>＋</b>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </RotatableModal>
  );
}
