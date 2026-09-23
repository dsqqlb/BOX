'use client';

/**
 * 地牢地图：画在方格纸上的平面图，房间靠门紧贴在一起。
 *
 * 渲染规则：
 *   - 每个片段有自己的占地（小房间 2×2、中 3×3、宽 4×3、大 4×4，走廊 1×1，入口/楼梯 2×2）；
 *   - **门就是墙上加粗的一格门框**：关闭 = 木门板、打开 = 门框 + 开着的门扇、锁住 = 红门板 + 锁扣、
 *     砸开 = 碎裂的门板。一间房的一面墙最多一扇门；相邻两间房的门画在同一格上（重叠）；
 *   - 只有打开/砸开的门才会在墙上留出缺口，关闭与锁住的门仍然占着整面墙；
 *   - 怪物/宝箱/密道/遗体都有徽章，当前房间有金色虚线圈和小人，没进去过的房间是虚线幽灵；
 *   - 点房间走进去、点门掷开门表；地图支持鼠标拖拽平移与滚轮缩放。
 */

import { useCallback, useRef, useState } from 'react';
import Icon from './Icon';
import { DIR_ORDER, doorOpening, doorWallCell, gridBounds, rectOf } from '@/lib/notequest/map';
import type { DoorDir, DoorState, DungeonNode } from '@/lib/notequest/types';

const CELL = 44;
const PAD = 1;
const WALL = 4;
const DOOR_THICK = CELL * 0.24;
const MIN_SCALE = 0.45;
const MAX_SCALE = 4;

interface MapBoardProps {
  nodes: DungeonNode[];
  currentId: string;
  onSelect: (node: DungeonNode) => void;
  onDoor: (node: DungeonNode, door: DoorState) => void;
}

interface Connection {
  from: DungeonNode;
  to: DungeonNode;
  dir: DoorDir;
  opening: { axis: 'x' | 'y'; at: number; from: number; to: number };
  status: DoorState['status'];
}

const OPPOSITE_DIR: Record<DoorDir, DoorDir> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** 只有已经打开/砸开的门才算「连通」（墙上有洞）。 */
function collectConnections(nodes: DungeonNode[]): Connection[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const list: Connection[] = [];
  for (const node of nodes) {
    for (const door of node.doors) {
      if (!door.to || !door.dir) continue;
      if (door.status !== 'open' && door.status !== 'broken') continue;
      const target = byId.get(door.to);
      if (!target || target.id === node.id) continue;
      const key = [node.id, target.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ from: node, to: target, dir: door.dir, opening: doorOpening(node, target, door.dir), status: door.status });
    }
  }
  return list;
}

/** 某个片段每条墙上要开洞的区段（按格坐标给出 [起, 止)）。 */
function openingsFor(node: DungeonNode, connections: Connection[]): Record<DoorDir, [number, number][]> {
  const result: Record<DoorDir, [number, number][]> = { n: [], e: [], s: [], w: [] };
  for (const link of connections) {
    const isFrom = link.from.id === node.id;
    const isTo = link.to.id === node.id;
    if (!isFrom && !isTo) continue;
    const dir = isFrom ? link.dir : OPPOSITE_DIR[link.dir];
    result[dir].push([link.opening.from, link.opening.to]);
  }
  return result;
}

/** 画一条带缺口的墙线：axis 是墙的走向，fixed 是墙所在的像素坐标。 */
function wallPath(axis: 'x' | 'y', fixed: number, start: number, end: number, gaps: [number, number][]): string {
  const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
  const parts: string[] = [];
  let cursor = start;
  for (const [gapStart, gapEnd] of sorted) {
    const from = Math.max(start, Math.min(gapStart, end));
    const to = Math.max(start, Math.min(gapEnd, end));
    if (from > cursor) parts.push(axis === 'x' ? `M${cursor} ${fixed}H${from}` : `M${fixed} ${cursor}V${from}`);
    cursor = Math.max(cursor, to);
  }
  if (end > cursor) parts.push(axis === 'x' ? `M${cursor} ${fixed}H${end}` : `M${fixed} ${cursor}V${end}`);
  return parts.join(' ');
}

const KIND_LABEL: Record<string, string> = { room: '房间', corridor: '走廊', stairs: '楼梯', entrance: '入口', boss: '最终房间' };

export default function MapBoard({ nodes, currentId, onSelect, onDoor }: MapBoardProps) {
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const movedRef = useRef(false);

  const reset = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);
  const zoomBy = useCallback((factor: number) => {
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const ratio = scale / current.scale;
      return { scale, tx: current.tx * ratio, ty: current.ty * ratio };
    });
  }, []);
  if (!nodes.length) return null;
  const bounds = gridBounds(nodes);
  const minX = bounds.minX - PAD;
  const minY = bounds.minY - PAD;
  const cols = bounds.maxX - bounds.minX + PAD * 2;
  const rows = bounds.maxY - bounds.minY + PAD * 2;
  const px = (gx: number) => (gx - minX) * CELL;
  const py = (gy: number) => (gy - minY) * CELL;
  const width = cols * CELL;
  const height = rows * CELL;
  const connections = collectConnections(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const gridLines: number[] = [];
  for (let index = 0; index <= Math.max(cols, rows); index += 1) gridLines.push(index);

  /** 某扇门在墙上的位置：连通的取共享段中点，没开的取它那面墙上分到的那一格。 */
  const doorSpot = (node: DungeonNode, door: DoorState, index: number) => {
    const rect = rectOf(node);
    const dir = door.dir ?? DIR_ORDER[index % DIR_ORDER.length];
    const wall = dir === 'n' ? { line: py(rect.y), horizontal: true }
      : dir === 's' ? { line: py(rect.y + rect.h), horizontal: true }
        : dir === 'w' ? { line: px(rect.x), horizontal: false }
          : { line: px(rect.x + rect.w), horizontal: false };
    const other = door.to ? byId.get(door.to) : undefined;
    if (other && (door.status === 'open' || door.status === 'broken')) {
      const opening = doorOpening(node, other, dir);
      const center = (opening.from + opening.to) / 2;
      return { ...wall, dir, along: opening.axis === 'x' ? px(center) : py(center), connected: true };
    }
    const slot = node.doors.slice(0, index).filter((item, order) => (item.dir ?? DIR_ORDER[order % DIR_ORDER.length]) === dir).length;
    const cell = doorWallCell(node, door, slot);
    return { ...wall, dir, along: wall.horizontal ? px(cell.x + cell.w / 2) : py(cell.y + cell.h / 2), connected: false };
  };

  /* ── 拖拽平移 / 滚轮缩放 ── */
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
    movedRef.current = false;
    try { (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId); } catch { /* 忽略 */ }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) movedRef.current = true;
    setView((current) => ({ ...current, tx: drag.tx + dx, ty: drag.ty + dy }));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try { (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId); } catch { /* 忽略 */ }
  };
  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const box = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((current) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      const ratio = scale / current.scale;
      const mx = event.clientX - box.left;
      const my = event.clientY - box.top;
      return { scale, tx: mx - (mx - current.tx) * ratio, ty: my - (my - current.ty) * ratio };
    });
  };
  /** 拖过地图之后的那一下点击不算点击。 */
  const guard = (run: () => void) => () => { if (!movedRef.current) run(); };
  return (
    <div className="nq-map">
      <div className="nq-map-tools">
        <button type="button" className="nq-mini" onClick={() => zoomBy(1 / 1.2)} title="缩小">−</button>
        <span className="nq-map-zoom">{Math.round(view.scale * 100)}%</span>
        <button type="button" className="nq-mini" onClick={() => zoomBy(1.2)} title="放大">+</button>
        <button type="button" className="nq-mini" onClick={reset} title="复位">复位</button>
        <span className="nq-map-hint">拖拽平移 · 滚轮缩放</span>
      </div>
      <div
        className="nq-map-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <div className="nq-map-zoomable" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          <svg viewBox={`0 0 ${width} ${height}`} className="nq-map-svg" preserveAspectRatio="xMidYMid meet">
            {/* 方格纸底纹 */}
            <g className="nq-map-grid">
              {gridLines.filter((index) => index <= cols).map((index) => (
                <line key={`gx-${index}`} x1={index * CELL} y1={0} x2={index * CELL} y2={height} />
              ))}
              {gridLines.filter((index) => index <= rows).map((index) => (
                <line key={`gy-${index}`} x1={0} y1={index * CELL} x2={width} y2={index * CELL} />
              ))}
            </g>

            {/* 一层：地板 + 墙（打开的门在墙上留缺口） */}
            {nodes.map((node) => {
              const rect = rectOf(node);
              const openings = openingsFor(node, connections);
              const x = px(rect.x);
              const y = py(rect.y);
              const w = rect.w * CELL;
              const h = rect.h * CELL;
              const gapX = (list: [number, number][]) => list.map(([a, b]) => [px(a), px(b)] as [number, number]);
              const gapY = (list: [number, number][]) => list.map(([a, b]) => [py(a), py(b)] as [number, number]);
              return (
                <g key={`shell-${node.id}`}>
                  <rect
                    x={x} y={y} width={w} height={h} rx={5}
                    className={`nq-map-floor nq-kind-${node.kind}${node.size ? ` nq-size-${node.size}` : ''}${node.visited ? '' : ' is-unknown'}`}
                  />
                  <path d={wallPath('x', y, x, x + w, gapX(openings.n))} className="nq-map-wall" strokeWidth={WALL} fill="none" />
                  <path d={wallPath('x', y + h, x, x + w, gapX(openings.s))} className="nq-map-wall" strokeWidth={WALL} fill="none" />
                  <path d={wallPath('y', x, y, y + h, gapY(openings.w))} className="nq-map-wall" strokeWidth={WALL} fill="none" />
                  <path d={wallPath('y', x + w, y, y + h, gapY(openings.e))} className="nq-map-wall" strokeWidth={WALL} fill="none" />
                  {node.id === currentId && <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} rx={8} className="nq-map-current-ring" />}
                </g>
              );
            })}
            {/* 二层：门 —— 墙上加粗的一格门框；相邻两间房的门画在同一格上（重叠） */}
            {nodes.map((node) =>
              node.doors.map((door, index) => {
                const spot = doorSpot(node, door, index);
                const along = spot.along;
                const line = spot.line;
                const horizontal = spot.horizontal;
                const clickable = node.id === currentId && (door.status === 'closed' || door.status === 'locked');
                const inside = spot.dir === 'n' ? 1 : spot.dir === 's' ? -1 : spot.dir === 'w' ? 1 : -1;
                const hit = horizontal
                  ? { x: along - CELL / 2, y: line - DOOR_THICK, width: CELL, height: DOOR_THICK * 2 }
                  : { x: line - DOOR_THICK, y: along - CELL / 2, width: DOOR_THICK * 2, height: CELL };
                const plank = horizontal
                  ? { x: along - CELL / 2, y: line - DOOR_THICK / 2, width: CELL, height: DOOR_THICK }
                  : { x: line - DOOR_THICK / 2, y: along - CELL / 2, width: DOOR_THICK, height: CELL };
                return (
                  <g
                    key={`door-${node.id}-${door.id}`}
                    className={`nq-door nq-door-${door.status}${clickable ? ' is-clickable' : ''}${spot.connected ? ' is-linked' : ''}`}
                    onClick={clickable ? guard(() => onDoor(node, door)) : undefined}
                    role={clickable ? 'button' : undefined}
                  >
                    <rect {...hit} className="nq-door-hit" />
                    {/* 打开/砸开的门：门框（两根门柱）+ 开着的门扇 */}
                    {(door.status === 'open' || door.status === 'broken') && (
                      <>
                        <rect
                          className="nq-door-threshold"
                          {...(horizontal
                            ? { x: along - CELL / 2, y: line - WALL * 0.6, width: CELL, height: WALL * 1.2 }
                            : { x: line - WALL * 0.6, y: along - CELL / 2, width: WALL * 1.2, height: CELL })}
                        />
                        {[-1, 1].map((side) => (
                          <rect
                            key={side}
                            className="nq-door-post"
                            {...(horizontal
                              ? { x: along + (side * CELL) / 2 - WALL * 0.7, y: line - CELL * 0.22, width: WALL * 1.4, height: CELL * 0.44 }
                              : { x: line - CELL * 0.22, y: along + (side * CELL) / 2 - WALL * 0.7, width: CELL * 0.44, height: WALL * 1.4 })}
                          />
                        ))}
                        {door.status === 'open' && (
                          <rect
                            className="nq-door-leaf"
                            {...(horizontal
                              ? {
                                x: along - CELL / 2 + WALL,
                                y: inside > 0 ? line + DOOR_THICK * 0.5 : line - CELL * 0.82,
                                width: DOOR_THICK * 0.5,
                                height: CELL * 0.78,
                              }
                              : {
                                x: inside > 0 ? line + DOOR_THICK * 0.5 : line - CELL * 0.82,
                                y: along - CELL / 2 + WALL,
                                width: CELL * 0.78,
                                height: DOOR_THICK * 0.5,
                              })}
                          />
                        )}
                      </>
                    )}
                    {/* 关闭 / 锁住 / 砸开：门板本身 */}
                    {(door.status === 'closed' || door.status === 'locked' || door.status === 'broken') && (
                      <rect {...plank} className="nq-door-plank" />
                    )}
                    {door.status === 'locked' && (
                      <>
                        <rect
                          className="nq-door-band"
                          {...(horizontal
                            ? { x: along - CELL * 0.5, y: line - DOOR_THICK * 0.16, width: CELL, height: DOOR_THICK * 0.32 }
                            : { x: line - DOOR_THICK * 0.16, y: along - CELL * 0.5, width: DOOR_THICK * 0.32, height: CELL })}
                        />
                        <circle cx={horizontal ? along : line} cy={horizontal ? line : along} r={DOOR_THICK * 0.34} className="nq-door-lock" />
                      </>
                    )}
                    {door.status === 'broken' && (
                      <rect
                        className="nq-door-splinter"
                        {...(horizontal
                          ? { x: along - CELL * 0.1, y: line - DOOR_THICK * 0.9, width: CELL * 0.28, height: DOOR_THICK * 0.9 }
                          : { x: line - DOOR_THICK * 0.9, y: along - CELL * 0.1, width: DOOR_THICK * 0.9, height: CELL * 0.28 })}
                      />
                    )}
                  </g>
                );
              }),
            )}
            {/* 三层：房间标记（点击进入、怪物、宝箱、密道、遗体、当前小人、门数） */}
            {nodes.map((node) => {
              const rect = rectOf(node);
              const x = px(rect.x);
              const y = py(rect.y);
              const w = rect.w * CELL;
              const h = rect.h * CELL;
              const cx = x + w / 2;
              const cy = y + h / 2;
              const alive = node.monsters.filter((monster) => monster.hp > 0).length;
              const isCurrent = node.id === currentId;
              const grave = node.heroGrave && !node.heroGrave.looted ? node.heroGrave : null;
              const openDoors = node.doors.filter((door) => door.status === 'open' || door.status === 'broken').length;
              return (
                <g key={`marks-${node.id}`} className={`nq-map-node${isCurrent ? ' is-current' : ''}`}>
                  <rect
                    x={x} y={y} width={w} height={h} rx={5}
                    className="nq-map-hit"
                    onClick={guard(() => onSelect(node))}
                    role="button"
                    aria-label={`${KIND_LABEL[node.kind] ?? '片段'}${node.visited ? '' : '（未探索）'}`}
                  />

                  {(node.kind === 'stairs' || node.kind === 'entrance' || node.kind === 'boss') && (
                    <g transform={`translate(${cx - 11}, ${cy - 11})`} className="nq-map-glyph" pointerEvents="none">
                      <Icon
                        name={node.kind === 'boss' ? 'boss' : node.kind === 'entrance' ? 'door' : 'stairs'}
                        className="nq-map-icon"
                        size={22}
                        title={node.kind === 'boss' ? '最终房间' : node.kind === 'entrance' ? '地牢入口' : '向下的楼梯'}
                      />
                    </g>
                  )}

                  {node.chest && !node.chest.opened && (
                    <g pointerEvents="none">
                      <circle cx={x + 13} cy={y + 13} r={9} className="nq-map-badge nq-badge-chest" />
                      <text x={x + 13} y={y + 17} className="nq-map-badge-text">宝</text>
                    </g>
                  )}
                  {alive > 0 && (
                    <g pointerEvents="none">
                      <circle cx={x + w - 13} cy={y + 13} r={10} className="nq-map-badge nq-badge-monster" />
                      <text x={x + w - 13} y={y + 17} className="nq-map-badge-text">{alive}</text>
                    </g>
                  )}
                  {node.hasSecretPassage && !node.secretPassageSearched && (
                    <g pointerEvents="none">
                      <circle cx={x + w - 12} cy={y + h - 12} r={8} className="nq-map-badge nq-badge-secret" />
                      <text x={x + w - 12} y={y + h - 8} className="nq-map-badge-text">密</text>
                    </g>
                  )}
                  {grave && (
                    <g pointerEvents="none">
                      <circle cx={x + 13} cy={y + h - 13} r={10} className="nq-map-badge nq-badge-grave" />
                      <text x={x + 13} y={y + h - 9} className="nq-map-badge-text">尸</text>
                    </g>
                  )}
                  {node.sneaked && (
                    <text x={cx} y={y + h - 8} className="nq-map-flag" pointerEvents="none">已绕过</text>
                  )}

                  {isCurrent && (
                    <g pointerEvents="none" transform={`translate(${cx}, ${cy + 4})`} className="nq-map-token">
                      <circle r={11} />
                      <circle cy={-3.4} r={3.4} className="nq-map-token-head" />
                      <path d="M-5 -0.4c1.4-1.6 8.6-1.6 10 0v5.4H-5z" className="nq-map-token-body" />
                    </g>
                  )}

                  <text
                    x={cx}
                    y={y + h - 7}
                    className={`nq-map-caption${node.kind === 'room' || node.kind === 'boss' || node.kind === 'entrance' || node.kind === 'stairs' ? ' nq-map-caption-in' : ''}`}
                    pointerEvents="none"
                  >
                    {rect.w >= 2 && rect.h >= 2
                      ? (node.visited
                        ? `${KIND_LABEL[node.kind] ?? '片段'}${node.kind === 'room' ? ` ${rect.w}×${rect.h}` : ''}${node.doors.length ? ` · 门 ${openDoors}/${node.doors.length}` : ''}`
                        : '？未探索')
                      : ''}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
}