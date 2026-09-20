import type { DungeonNode } from './types';

/**
 * 地牢地图布局。
 *
 * 原版是玩家自己在方格纸上画图（PNP 的本意），网页上我们自动排：
 * 新片段从父节点出发，按「右 → 上 → 左 → 下」的顺序找最近的空格子；
 * 四个方向都被占了就加大半径继续找，所以地图会自然长成一圈圈的枝状结构。
 * 坐标写进存档（node.x / node.y），读档立刻能画出来，不需要重算。
 */

const DIRS: { dx: number; dy: number }[] = [
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
];

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function occupiedCells(nodes: DungeonNode[]): Set<string> {
  return new Set(nodes.map((node) => cellKey(node.x, node.y)));
}

/** 给新节点找一个空格子（父节点坐标已知）。 */
export function placeNode(from: { x: number; y: number }, used: Set<string>): { x: number; y: number } {
  for (let radius = 1; radius <= 10; radius += 1) {
    for (const dir of DIRS) {
      const x = from.x + dir.dx * radius;
      const y = from.y + dir.dy * radius;
      if (!used.has(cellKey(x, y))) return { x, y };
    }
  }
  return { x: from.x + 11, y: from.y };
}

/** 新一层（楼梯之后）的起点：整体往下挪几格，避免和上一层重叠。 */
export function placeForNewDepth(nodes: DungeonNode[], depth: number): { x: number; y: number } {
  const used = occupiedCells(nodes);
  const sameDepth = nodes.filter((node) => node.depth === depth);
  if (!sameDepth.length) {
    const maxY = nodes.length ? Math.max(...nodes.map((node) => node.y)) : 0;
    const from = { x: 0, y: maxY + 3 };
    for (let radius = 0; radius <= 10; radius += 1) {
      const candidate = { x: from.x + radius, y: from.y };
      if (!used.has(cellKey(candidate.x, candidate.y))) return candidate;
    }
    return from;
  }
  // 该层已经有节点（密道也会开新层）：接着往旁边排
  return placeNode(sameDepth[sameDepth.length - 1], used);
}

export function gridBounds(nodes: DungeonNode[]): { minX: number; maxX: number; minY: number; maxY: number } {
  if (!nodes.length) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}