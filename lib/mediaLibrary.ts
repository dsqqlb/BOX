import { useEffect, useState } from 'react';
import { getWsUrl } from './useWebSocket';
import { EnemyEntry } from './enemies';

// 玩家立绘条目：由 server/websocket-server.js 的 /player-images 接口实时扫描
// public/image/player/<种族>_<英文>/<职业>.png 目录返回
export interface PlayerImageEntry {
  key: string;       // raceEn__className，保证跨种族不重名
  name: string;       // "种族 · 职业" 中文显示名
  race: string;
  raceEn: string;
  className: string;
  file: string;       // 相对 public/image/player 的路径，如 "矮人_Dwarf/战士.png"
}

// 统一媒体库条目：把怪物图和玩家立绘合并成同一种形状，
// 供"自定义生物"创建器等需要跨来源搜索/选择图片的场景使用
export interface MediaItem {
  key: string;         // 全局唯一标识（怪物用原key，玩家立绘加前缀避免和怪物key碰撞）
  name: string;         // 中文显示名
  url: string;           // 可直接用于 <img src> 的公开路径
  source: 'enemy' | 'player';
}

function getPlayerImagesApiUrl(): string {
  return getWsUrl().replace(/^ws/, 'http') + '/player-images';
}

// 实时获取玩家立绘清单
export function usePlayerImageList() {
  const [images, setImages] = useState<PlayerImageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(getPlayerImagesApiUrl(), { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`加载玩家立绘列表失败: ${res.status}`);
        return res.json();
      })
      .then((data: PlayerImageEntry[]) => {
        if (!cancelled) {
          setImages(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('❌ 获取玩家立绘列表失败:', err);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { images, loading, error };
}

// 把怪物清单 + 玩家立绘清单合并成统一的 MediaItem 数组
export function buildMediaLibrary(enemies: EnemyEntry[], playerImages: PlayerImageEntry[]): MediaItem[] {
  const enemyItems: MediaItem[] = enemies.map((e) => ({
    key: `enemy:${e.key}`,
    name: e.name,
    url: `/image/enemies/${e.file}`,
    source: 'enemy' as const,
  }));

  const playerItems: MediaItem[] = playerImages.map((p) => ({
    key: `player:${p.key}`,
    name: p.name,
    url: `/image/player/${p.file}`,
    source: 'player' as const,
  }));

  return [...enemyItems, ...playerItems];
}

// 按关键词（中文名）过滤统一媒体库，用于"自定义生物"图片选择器的搜索框
export function filterMediaLibrary(items: MediaItem[], search: string): MediaItem[] {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return items;
  return items.filter((item) => item.name.toLowerCase().includes(trimmed));
}

// 从统一媒体库的 name 字段提取"快捷角色名"：
// - 怪物/NPC来源的 name 形如 "哥布林弓手"（已经是纯中文名，直接用）
// - 玩家立绘来源的 name 形如 "矮人 · 战士"，取"·"后面的职业部分更适合当角色名，
//   同时也保留种族信息可用，这里选择保留完整的"种族 · 职业"作为默认名更明确
// 需求里举的例子是"狼_wolf" -> 自动填成"狼"，也就是取中文名部分（下划线前）；
// 对已经处理过的 MediaItem.name 而言，它已经是纯中文名，直接返回即可。
export function getQuickNameFromMedia(item: MediaItem): string {
  return item.name;
}
