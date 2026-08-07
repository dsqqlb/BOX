import { useEffect, useState } from 'react';

// 怪物清单条目：由 server/index.js 的 /api/enemies 接口实时扫描
// public/image/enemies 目录返回，无需生成文件、无需重启服务
export interface EnemyEntry {
  key: string;   // 英文标识，代码里用它来引用怪物、拼接图片路径
  name: string;  // 中文显示名（图片命名为"中文名_英文标识.png"时自动生效）
  file: string;  // 图片文件名（含后缀）
}

// 接口和页面由同一个进程、同一个端口提供，所以直接用同源相对路径即可，
// 不需要推断主机名/端口，也不需要任何环境变量
const ENEMIES_API_URL = '/api/enemies';

// 获取怪物图片的公开访问路径
export function getEnemyImageUrl(key: string, list: EnemyEntry[]): string {
  const enemy = list.find((e) => e.key === key);
  return enemy ? `/image/enemies/${enemy.file}` : '';
}

// 按关键词（中文名或英文key）过滤怪物清单，用于搜索框
export function filterEnemies(list: EnemyEntry[], search: string): EnemyEntry[] {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return list;

  return list.filter((enemy) => {
    return (
      enemy.key.toLowerCase().includes(trimmed) ||
      enemy.name.toLowerCase().includes(trimmed)
    );
  });
}

// 实时获取怪物清单的Hook：每次组件挂载都会向服务器请求最新目录内容，
// 新增/改名图片后只需刷新页面，不需要重启开发服务器或重新生成任何文件
export function useEnemyList() {
  const [enemies, setEnemies] = useState<EnemyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(ENEMIES_API_URL, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`加载怪物列表失败: ${res.status}`);
        return res.json();
      })
      .then((data: EnemyEntry[]) => {
        if (!cancelled) {
          setEnemies(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('❌ 获取怪物列表失败:', err);
          setError(err.message);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { enemies, loading, error };
}
