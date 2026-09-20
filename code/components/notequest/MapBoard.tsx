'use client';

/**
 * 地牢地图：把「地牢片段图」画成网格图。
 *
 * 原版 NoteQuest 是要玩家自己在方格纸上画图的（PNP 的本意），网页上我们自动排：
 * 片段生成时 engine 用 lib/notequest/map.ts 分配坐标（写进存档），这里只负责画：
 *   - 已经打开的门 → 片段之间连一条线；
 *   - 还没处理的门 → 挂在片段边缘的小门标记，点它就掷开门表；
 *   - 房间里的怪物 / 宝箱 / 密道都在片段上用小标记显示。
 */

import Icon from './Icon';
import type { DoorState, DungeonNode } from '@/lib/notequest/types';

const CELL = 104;
const ROOM_SCALE: Record<string, number> = { small: 0.62, medium: 0.8, wide: 1.02, large: 1.24 };

const DOOR_OFFSETS: { x: number; y: number; side: string }[] = [
  { x: 0, y: -1, side: 'top' },
  { x: 1, y: 0, side: 'right' },
  { x: 0, y: 1, side: 'bottom' },
  { x: -1, y: 0, side: 'left' },
];

interface MapBoardProps {
  nodes: DungeonNode[];
  currentId: string;
  onSelect: (node: DungeonNode) => void;
  onDoor: (node: DungeonNode, door: DoorState) => void;
}

export default function MapBoard({ nodes, currentId, onSelect, onDoor }: MapBoardProps) {
  if (!nodes.length) return null;
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  const minX = Math.min(...xs) - 1.5;
  const maxX = Math.max(...xs) + 1.5;
  const minY = Math.min(...ys) - 1.5;
  const maxY = Math.max(...ys) + 1.5;
  const width = (maxX - minX + 1) * CELL;
  const height = (maxY - minY + 1) * CELL;
  const point = (node: DungeonNode) => ({ x: (node.x - minX + 0.5) * CELL, y: (node.y - minY + 0.5) * CELL });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="nq-map">
      <svg viewBox={`0 0 ${width} ${height}`} className="nq-map-svg" preserveAspectRatio="xMidYMid meet">
        {/* 连接线：已经打开的门 */}
        {nodes.map((node) => {
          const from = point(node);
          return node.doors
            .filter((door) => door.to && (door.status === 'open' || door.status === 'broken'))
            .map((door) => {
              const target = door.to ? byId.get(door.to) : undefined;
              if (!target) return null;
              const to = point(target);
              return (
                <line
                  key={`${node.id}-${door.id}`}
                  x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                  className={`nq-map-link${door.status === 'broken' ? ' is-broken' : ''}`}
                />
              );
            });
        })}

        {nodes.map((node) => {
          const { x, y } = point(node);
          const scale = node.kind === 'room' ? ROOM_SCALE[node.size ?? 'medium'] ?? 0.8 : node.kind === 'corridor' ? 0.74 : 0.8;
          const half = (CELL / 2) * scale;
          const isCurrent = node.id === currentId;
          const unknown = !node.visited;
          const alive = node.monsters.filter((monster) => monster.hp > 0).length;
          return (
            <g key={node.id} className={`nq-map-node${isCurrent ? ' is-current' : ''}${unknown ? ' is-unknown' : ''}`}>
              {node.kind === 'room' && (
                <rect x={x - half} y={y - half * 0.82} width={half * 2} height={half * 1.64} rx={10}
                  className={`nq-map-shape nq-kind-room${node.size ? ` nq-size-${node.size}` : ''}`} />
              )}
              {node.kind === 'corridor' && (
                <rect x={x - half} y={y - half * 0.42} width={half * 2} height={half * 0.84} rx={6}
                  className="nq-map-shape nq-kind-corridor" />
              )}
              {(node.kind === 'stairs' || node.kind === 'entrance' || node.kind === 'boss') && (
                <rect x={x - half * 0.86} y={y - half * 0.86} width={half * 1.72} height={half * 1.72} rx={half * 0.5}
                  className={`nq-map-shape nq-kind-${node.kind}`} />
              )}

              <g transform={`translate(${x - 13}, ${y - 13})`} className="nq-map-glyph" onClick={() => onSelect(node)} role="button">
                <Icon
                  name={node.kind === 'room' ? 'room' : node.kind === 'corridor' ? 'corridor' : node.kind === 'boss' ? 'boss' : 'stairs'}
                  className="nq-map-icon"
                  title={node.kind === 'boss' ? '最终房间' : node.kind === 'stairs' ? '楼梯' : node.kind === 'room' ? '房间' : '走廊'}
                />
              </g>

              {alive > 0 && <circle cx={x + half * 0.7} cy={y - half * 0.7} r={11} className="nq-map-badge nq-badge-monster" />}
              {alive > 0 && <text x={x + half * 0.7} y={y - half * 0.7 + 4} className="nq-map-badge-text">{alive}</text>}
              {node.chest && !node.chest.opened && <circle cx={x - half * 0.7} cy={y - half * 0.7} r={9} className="nq-map-badge nq-badge-chest" />}
              {node.hasSecretPassage && !node.secretPassageSearched && <circle cx={x + half * 0.7} cy={y + half * 0.7} r={8} className="nq-map-badge nq-badge-secret" />}
              <text x={x} y={y + half * 1.6 + 13} className="nq-map-caption">
                {node.depth}层{node.kind === 'boss' ? ' · Boss' : node.sneaked ? ' · 已绕过' : ''}
              </text>

              {/* 还没处理的门：点它就掷开门表 */}
              {node.doors.map((door, index) => {
                if (door.to && (door.status === 'open' || door.status === 'broken')) return null;
                const offset = DOOR_OFFSETS[index % DOOR_OFFSETS.length];
                const dx = x + offset.x * (half + 15);
                const dy = y + offset.y * (half * 0.9 + 15);
                return (
                  <g
                    key={door.id}
                    transform={`translate(${dx - 11}, ${dy - 11})`}
                    className={`nq-map-door nq-door-${door.status}`}
                    onClick={() => onDoor(node, door)}
                    role="button"
                  >
                    <circle cx={11} cy={11} r={12} className="nq-map-door-bg" />
                    <Icon
                      name={door.status === 'broken' ? 'door-broken' : door.status === 'locked' ? 'door-locked' : 'door'}
                      className="nq-map-door-icon"
                      title={door.status === 'locked' ? '锁着的门' : '门'}
                    />
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}