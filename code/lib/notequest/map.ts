import type { DoorDir, DungeonNode, RoomSize } from './types';

/**
 * 地牢地图布局：**在格子上排版**，让地图看起来像手绘在方格纸上的平面图。
 *
 * 与第一版（每个片段只占一个格子、圆圈连线）的区别：
 *   1. 每个片段有自己的**占地**：小房间 2×2、中房间 3×3、宽房间 4×3、大房间 4×4，
 *      走廊 1×1，入口与楼梯 2×2，最终房间 4×4；
 *   2. 新片段**贴在父片段那一面墙上**（与门共享一整段墙），其余片段之间最少留一格空隙，
 *      排出来就是「一间间贴墙的屋子 + 一格宽的通道」，而不是散点；
 *   3. 门在墙上的开口位置由两段的重叠段决定（见 doorOpening），地图按它把墙开洞。
 *
 * 坐标 (x, y) 是片段**左上角所在的格子**，写进存档，读档立刻能画。
 */

export const ROOM_FOOTPRINT: Record<RoomSize, { w: number; h: number }> = {
  small: { w: 2, h: 2 },
  medium: { w: 3, h: 3 },
  wide: { w: 4, h: 3 },
  large: { w: 4, h: 4 },
};

export const DIR_DELTA: Record<DoorDir, { dx: number; dy: number }> = {
  n: { dx: 0, dy: -1 },
  e: { dx: 1, dy: 0 },
  s: { dx: 0, dy: 1 },
  w: { dx: -1, dy: 0 },
};

export const OPPOSITE: Record<DoorDir, DoorDir> = { n: 's', e: 'w', s: 'n', w: 'e' };

/** 优先顺序：先往右长，其次往下、往左、往上。 */
export const DIR_ORDER: DoorDir[] = ['e', 's', 'w', 'n'];

export interface Rect { x: number; y: number; w: number; h: number }

export function footprintOf(node: { kind: string; size?: RoomSize }): { w: number; h: number } {
  if (node.kind === 'corridor') return { w: 1, h: 1 };
  if (node.kind === 'room') return ROOM_FOOTPRINT[node.size ?? 'medium'] ?? ROOM_FOOTPRINT.medium;
  if (node.kind === 'boss') return { w: 4, h: 4 };
  return { w: 2, h: 2 };
}

/** 片段的实际占地：存档里写过 w/h 就用它（保证读档与生成时一致）。 */
export function rectOf(node: DungeonNode): Rect {
  const base = footprintOf(node);
  return { x: node.x, y: node.y, w: Math.max(1, node.w ?? base.w), h: Math.max(1, node.h ?? base.h) };
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function rectCells(rect: Rect): string[] {
  const cells: string[] = [];
  for (let x = rect.x; x < rect.x + rect.w; x += 1) {
    for (let y = rect.y; y < rect.y + rect.h; y += 1) cells.push(cellKey(x, y));
  }
  return cells;
}

/** 所有片段占的格子（可选排除某个片段，用于给它的新邻居找位置）。 */
export function occupiedCells(nodes: DungeonNode[], exceptId?: string): Set<string> {
  const used = new Set<string>();
  for (const node of nodes) {
    if (node.id === exceptId) continue;
    for (const cell of rectCells(rectOf(node))) used.add(cell);
  }
  return used;
}

/** 占格向外扩一圈：新房间与其他房间之间因此至少隔一格，地图才像手绘平面图。 */
function blockedCells(nodes: DungeonNode[], exceptId: string): Set<string> {
  const blocked = new Set<string>();
  for (const node of nodes) {
    if (node.id === exceptId) continue;
    const rect = rectOf(node);
    for (let x = rect.x - 1; x <= rect.x + rect.w; x += 1) {
      for (let y = rect.y - 1; y <= rect.y + rect.h; y += 1) blocked.add(cellKey(x, y));
    }
  }
  return blocked;
}

function fits(rect: Rect, blocked: Set<string>): boolean {
  for (const cell of rectCells(rect)) if (blocked.has(cell)) return false;
  return true;
}

/** 沿墙方向的候选偏移：先居中，再每次往两边挪一格，直到能共享一整段墙。 */
function alignOffsets(span: number, size: number): number[] {
  const base = Math.round((span - size) / 2);
  const offsets: number[] = [base];
  for (let step = 1; step <= Math.max(span, size) + 2; step += 1) offsets.push(base - step, base + step);
  return offsets;
}

/**
 * 贴墙摆放的合法偏移：**必须保证新片段和父片段至少共享一格墙面**。
 * 沿墙方向的可动范围是 (1 - 自己在这条边上的长度, 父片段在这条边上的长度 - 1)：
 * 超出这个范围，两者只是岔开没贴在一起（墙没接上，门就开在空气里）。
 */
function seamOffsets(dir: DoorDir, fromRect: Rect, size: { w: number; h: number }): number[] {
  const along = dir === 'e' || dir === 'w' ? fromRect.h : fromRect.w;
  const own = dir === 'e' || dir === 'w' ? size.h : size.w;
  const base = Math.round((along - own) / 2);
  const min = 1 - own;
  const max = along - 1;
  const offsets: number[] = [];
  for (const value of alignOffsets(along, own)) {
    if (value < min || value > max) continue;
    if (!offsets.includes(value)) offsets.push(value);
  }
  // 兜底：万一父片段太小（比如 1×1 走廊对上 4×4 房间），至少保证最小重叠的那一格
  for (let value = min; value <= max; value += 1) if (!offsets.includes(value)) offsets.push(value);
  return offsets;
}

/** 只要不与别的片段重叠就行（用于「紧贴优先」的第二轮搜索）。 */
function overlapsOther(rect: Rect, nodes: DungeonNode[], exceptId: string): boolean {
  for (const node of nodes) {
    if (node.id === exceptId) continue;
    const other = rectOf(node);
    if (rect.x < other.x + other.w && other.x < rect.x + rect.w && rect.y < other.y + other.h && other.y < rect.y + rect.h) return true;
  }
  return false;
}

function candidateRect(from: Rect, dir: DoorDir, size: { w: number; h: number }, offset: number): Rect {
  if (dir === 'e') return { x: from.x + from.w, y: from.y + offset, w: size.w, h: size.h };
  if (dir === 'w') return { x: from.x - size.w, y: from.y + offset, w: size.w, h: size.h };
  if (dir === 's') return { x: from.x + offset, y: from.y + from.h, w: size.w, h: size.h };
  return { x: from.x + offset, y: from.y - size.h, w: size.w, h: size.h };
}

/** 两个矩形是否墙贴墙（共享至少一格的墙面，且不重叠）。 */
export function touchRects(a: Rect, b: Rect): boolean {
  if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return false;
  const columns = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const rows = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return ((a.y + a.h === b.y || b.y + b.h === a.y) && columns >= 1)
    || ((a.x + a.w === b.x || b.x + b.w === a.x) && rows >= 1);
}

export interface Placement { x: number; y: number; dir: DoorDir; detached: boolean }

/**
 * 把新片段贴在 from 的墙上（原书的地牢就是一间间紧贴的屋子，中间靠门相连）：
 *   1. 先按「优先方向 + 居中对齐」找能共享一整段墙的位置；
 *   2. 找不到就沿四面墙整条扫过去（仍然紧贴，只是门开在墙的别处）；
 *   3. 再找不到就放宽「与其他房间至少隔一格」的限制（只禁止重叠）再扫一遍；
 *   4. 极端情况（四周真的被围死）才外扩一格留出空隙，地图上会用虚线通道连过去。
 */
export function placeBehindDoor(
  from: DungeonNode,
  size: { w: number; h: number },
  nodes: DungeonNode[],
  preferDir: DoorDir = 'e',
  usedDirs: DoorDir[] = [],
  freshOnly = false,
): Placement | null {
  const fromRect = rectOf(from);
  const blocked = blockedCells(nodes, from.id);
  // 已经用过这面墙的门就不再往这边开（一面墙最多一个门）
  const fresh = DIR_ORDER.filter((dir) => !usedDirs.includes(dir));
  const order = [preferDir, ...DIR_ORDER.filter((dir) => dir !== preferDir)]
    .filter((dir, index, list) => list.indexOf(dir) === index)
    .sort((a, b) => Number(usedDirs.includes(a)) - Number(usedDirs.includes(b)) || 0);
  const search = freshOnly ? fresh : order;
  const spanOf = (dir: DoorDir) => (dir === 'e' || dir === 'w' ? fromRect.h : fromRect.w);
  const ownOf = (dir: DoorDir) => (dir === 'e' || dir === 'w' ? size.h : size.w);

  if (!search.length) return null;
  for (const dir of search) {
    for (const offset of seamOffsets(dir, fromRect, size)) {
      const rect = candidateRect(fromRect, dir, size, offset);
      if (fits(rect, blocked)) return { x: rect.x, y: rect.y, dir, detached: false };
    }
  }
  if (freshOnly) return null;

  // 第二轮：沿整面墙扫（仍然紧贴父房间）
  for (const dir of order) {
    for (const offset of seamOffsets(dir, fromRect, size)) {
      const rect = candidateRect(fromRect, dir, size, offset);
      if (fits(rect, blocked)) return { x: rect.x, y: rect.y, dir, detached: false };
    }
  }

  // 第三轮：允许与别的房间墙面相接（但不重叠），依旧必须紧贴父房间
  for (const dir of [...fresh, ...order.filter((item) => !fresh.includes(item))]) {
    for (const offset of seamOffsets(dir, fromRect, size)) {
      const rect = candidateRect(fromRect, dir, size, offset);
      if (!overlapsOther(rect, nodes, from.id)) return { x: rect.x, y: rect.y, dir, detached: false };
    }
  }

  // 兜底：门所在的这面墙往外挪几格再放。方向优先挑没用过的墙（免得一面墙两个门），
// 位置优先挑能和别的房间紧贴的（保证地图仍然是一整片，而不是飘在外面的孤岛）。
  const fallbackOrder = [...fresh, ...order.filter((item) => !fresh.includes(item))];
  for (const dir of fallbackOrder) {
    const span = spanOf(dir);
    const own = ownOf(dir);
    const delta = DIR_DELTA[dir];
    for (let gap = 1; gap <= 12; gap += 1) {
      const anchor = rectOf({ ...from, x: fromRect.x + delta.dx * gap, y: fromRect.y + delta.dy * gap, w: fromRect.w, h: fromRect.h });
      const touching: Rect[] = [];
      const floating: Rect[] = [];
      for (let offset = 1 - own; offset <= span - 1; offset += 1) {
        const rect = candidateRect(anchor, dir, size, offset);
        if (overlapsOther(rect, nodes, from.id)) continue;
        if (nodes.some((node) => node.id !== from.id && touchRects(rect, rectOf(node)))) touching.push(rect);
        else floating.push(rect);
      }
      const pick = touching[0] ?? floating[0];
      if (pick) return { x: pick.x, y: pick.y, dir, detached: !touching.length };
    }
  }
  const maxX = nodes.length ? Math.max(...nodes.map((node) => node.x + rectOf(node).w)) : 0;
  return { x: maxX + 2, y: fromRect.y, dir: preferDir, detached: true };
}

/** 新一层（楼梯/最终房间）的起点：整体往下挪，避开已有地图。 */
export function placeForNewDepth(nodes: DungeonNode[], size: { w: number; h: number }): { x: number; y: number } {
  const blocked = blockedCells(nodes, '');
  const maxY = nodes.length ? Math.max(...nodes.map((node) => node.y + rectOf(node).h)) : 0;
  for (let y = maxY + 2; y < maxY + 26; y += 1) {
    for (let x = -6; x < 26; x += 1) {
      if (fits({ x, y, w: size.w, h: size.h }, blocked)) return { x, y };
    }
  }
  return { x: 0, y: maxY + 3 };
}

/**
 * 给片段上的门分配朝向：**一面墙最多一个门**。
 * 生成片段时就要调用（没打开的门也要画在墙上）；开门后也要调用一次来做重整：
 *   - 已经连通的门（door.to 有值）朝向是地图算出来的，不能动；
 *   - 其余的门优先保住自己的墙，撞墙了才让位到空墙上去。
 */
export function assignDoorDirs(node: DungeonNode, preferred: DoorDir[] = DIR_ORDER): void {
  const used: DoorDir[] = [];
  const take = (dir?: DoorDir) => { if (dir && !used.includes(dir)) used.push(dir); };
  const locked = new Set<string>();
  for (const door of node.doors) {
    if (door.dir && door.to) { take(door.dir); locked.add(door.id); }
  }
  // 其余的门（还没连通的）优先保住自己的墙，撞了才让位到空墙
  for (const door of node.doors) {
    if (locked.has(door.id)) continue;
    if (door.dir && !used.includes(door.dir)) { used.push(door.dir); continue; }
    const pick = [...preferred, ...DIR_ORDER].find((dir) => !used.includes(dir))
      ?? door.dir ?? preferred[0] ?? 'e';
    door.dir = pick;
    used.push(pick);
  }
}

/**
 * 没打开的门在墙上占的那一格（长度恰好 1 格，画成加粗的门框）。
 * 同一面墙上有多个门时按顺序铺开（正常情况一面墙只有一个）。
 */
export function doorWallCell(node: DungeonNode, door: DungeonNode['doors'][number], order: number): Rect {
  const rect = rectOf(node);
  const dir = door.dir ?? 'e';
  const sameWall = node.doors.filter((item) => (item.dir ?? 'e') === dir);
  const count = Math.max(1, sameWall.length);
  const slot = Math.min(Math.max(0, order), count - 1);
  const horizontal = dir === 'n' || dir === 's';
  const span = horizontal ? rect.w : rect.h;
  const start = horizontal ? rect.x : rect.y;
  const size = Math.max(1, Math.floor(span / count));
  const pos = Math.round(start + slot * (span / count) + (span / count - size) / 2);
  if (dir === 'n') return { x: pos, y: rect.y, w: size, h: 1 };
  if (dir === 's') return { x: pos, y: rect.y + rect.h - 1, w: size, h: 1 };
  if (dir === 'w') return { x: rect.x, y: pos, w: 1, h: size };
  return { x: rect.x + rect.w - 1, y: pos, w: 1, h: size };
}

/**
 * 已连接的两段之间，门在墙上占的那一格（取共享段的中点）。
 * 两边房间各画自己那扇门，位置完全相同 → 视觉上就是「两扇门重叠在一起」。
 */
export function doorOpeningCell(parent: DungeonNode, child: DungeonNode, dir: DoorDir): Rect {
  const opening = doorOpening(parent, child, dir);
  const horizontal = opening.axis === 'y'; // 墙是横着的（n/s）→ 门沿 x 排布
  const count = Math.max(1, opening.to - opening.from);
  const slot = Math.floor((count - 1) / 2);
  const pos = opening.from + slot;
  if (horizontal) return { x: pos, y: opening.at - 1, w: 1, h: 1 };
  return { x: opening.at - 1, y: pos, w: 1, h: 1 };
}

/** 两段之间那扇门开在哪面墙上：返回墙面线与共享段（格坐标），供地图开洞。 */
export function doorOpening(parent: DungeonNode, child: DungeonNode, dir: DoorDir): { axis: 'x' | 'y'; at: number; from: number; to: number } {
  const a = rectOf(parent);
  const b = rectOf(child);
  if (dir === 'e' || dir === 'w') {
    const at = dir === 'e' ? a.x + a.w : a.x;
    const from = Math.max(a.y, b.y);
    const to = Math.min(a.y + a.h, b.y + b.h);
    return { axis: 'x', at, from, to: Math.max(from + 1, to) };
  }
  const at = dir === 's' ? a.y + a.h : a.y;
  const from = Math.max(a.x, b.x);
  const to = Math.min(a.x + a.w, b.x + b.w);
  return { axis: 'y', at, from, to: Math.max(from + 1, to) };
}

/**
 * 按门的关系重排整张地图（从入口 BFS 走一遍已连接的门）。
 * 用途：老存档（version 1 的单格坐标）读进来时升级成格子占地，不会一间压一间。
 */
export function relayoutNodes(nodes: DungeonNode[]): void {
  if (!nodes.length) return;
  const entrance = nodes.find((node) => node.kind === 'entrance') ?? nodes[0];
  for (const node of nodes) {
    const base = footprintOf(node);
    // 已经有占地的片段保持原样（例如后来升级成最终房间的房间，不要被放大成 4×4 而压到邻居）
    node.w = node.w ?? base.w;
    node.h = node.h ?? base.h;
  }
  entrance.x = 0;
  entrance.y = 0;
  const placed: DungeonNode[] = [entrance];
  const queue: DungeonNode[] = [entrance];
  const seen = new Set<string>([entrance.id]);
  while (queue.length) {
    const current = queue.shift() as DungeonNode;
    const links = current.doors.filter((door) => door.to && (door.status === 'open' || door.status === 'broken'));
    for (const door of links) {
      const child = nodes.find((node) => node.id === door.to);
      if (!child || seen.has(child.id)) continue;
      const prefer = door.dir ?? 'e';
      const spot = placeBehindDoor(current, { w: child.w ?? 1, h: child.h ?? 1 }, placed, prefer)
        ?? { x: current.x, y: current.y + (current.h ?? 1) + 1, dir: prefer, detached: true };
      child.x = spot.x;
      child.y = spot.y;
      door.dir = spot.dir;
      // 老存档里可能没有「对门」：补一扇回去，这样两边都能画门、都能走回来
      if (!child.doors.some((item) => item.to === current.id)) {
        child.doors.unshift({ id: `door-${child.id}-${current.id}`, status: 'open', to: current.id, dir: OPPOSITE[spot.dir] });
      }
      assignDoorDirs(child);
      seen.add(child.id);
      placed.push(child);
      queue.push(child);
    }
  }
  // 没连上的（理论上不会出现）单独摆到下面
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const spot = placeForNewDepth(placed, { w: node.w ?? 1, h: node.h ?? 1 });
    node.x = spot.x;
    node.y = spot.y;
    placed.push(node);
    seen.add(node.id);
  }
}

/** 地图边界（含所有片段占格，给渲染留出半个格的余量由调用方决定）。 */
export function gridBounds(nodes: DungeonNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!nodes.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const rect = rectOf(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { minX, maxX, minY, maxY };
}