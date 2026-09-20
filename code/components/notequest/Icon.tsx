'use client';

/**
 * NoteQuest 的图标：全部是内联 SVG（不引入外部图片，随代码一起走，服务器上不用再单独上传素材）。
 *
 * - 地牢类型图标由规则数据里的 `icon` 字段指定（宫殿 crown、地穴 skull、陵墓 pillar、
 *   庇护所 angel、神庙 temple、牢狱 chains），加新地牢时在 dungeons.json 里写自己的图标名即可，
 *   不认识的名字会自动回退成通用地牢图标。
 * - 想换成自己的美术：把这里的 <path> 换成 <image href="…"> 或改成引用 resources/public 下的图片都行，
 *   组件对外只暴露 name / className，替换不会影响调用方。
 */

export type IconName =
  | 'dungeon' | 'corridor' | 'room' | 'stairs' | 'door' | 'door-locked' | 'door-broken'
  | 'chest' | 'torch' | 'coin' | 'heart' | 'skull' | 'key' | 'shield' | 'sword'
  | 'potion' | 'scroll' | 'monster' | 'boss' | 'grave' | 'town' | 'die' | 'book' | 'map'
  | 'crown' | 'pillar' | 'angel' | 'temple' | 'chains' | 'spark' | 'eye' | 'bag';

const PATHS: Record<string, string> = {
  dungeon: 'M4 20V10l8-6 8 6v10M4 20h16M9 20v-6h6v6',
  corridor: 'M3 8h18M3 16h18M7 8v8M17 8v8',
  room: 'M4 5h16v14H4zM10 12h4v7h-4z',
  stairs: 'M3 19h4v-4h4v-4h4V7h5',
  door: 'M6 3h12v18H6zM14 12h.01',
  'door-locked': 'M6 3h12v18H6zM14 12h.01M9 3V1M15 3V1',
  'door-broken': 'M6 3h6l6 18h-6zM12 12h6',
  chest: 'M3 10h18v10H3zM3 10V7a3 3 0 013-3h12a3 3 0 013 3v3M11 10h2v4h-2z',
  torch: 'M12 3c2 3 3 4 3 6a3 3 0 01-6 0c0-2 1-3 3-6zM10 12h4l-1 9h-2z',
  coin: 'M12 3a9 9 0 100 18 9 9 0 000-18zm0 4.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z',
  heart: 'M12 20S4 15 4 9.5A4.5 4.5 0 0112 6a4.5 4.5 0 018 3.5C20 15 12 20 12 20z',
  skull: 'M12 3a7 7 0 00-7 7v4l2 2v3h10v-3l2-2v-4a7 7 0 00-7-7zM9.5 10h.01M14.5 10h.01M10 16h4',
  key: 'M14 7a4 4 0 108 0 4 4 0 00-8 0zM14 7L3 18v3h3l1-1v-2h2v-2h2l3-3',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  sword: 'M14 3l7 7-3 3-7-7zM11 10l-8 8v3h3l8-8',
  potion: 'M9 3h6M10 3v5l-4 7a3 3 0 003 5h6a3 3 0 003-5l-4-7V3M7 15h10',
  scroll: 'M5 4h11a3 3 0 013 3v10a3 3 0 003 3H8a3 3 0 01-3-3zM8 8h8M8 12h8',
  monster: 'M5 9l-3-2 3 6v6h14v-6l3-6-3 2M8 13h.01M16 13h.01M9 18h6',
  boss: 'M4 19V8l4 3 4-6 4 6 4-3v11zM8 19h8',
  grave: 'M6 21V10a6 6 0 1112 0v11M9 10h6M12 7v6',
  town: 'M3 20h18M5 20V9l7-5 7 5v11M10 20v-5h4v5',
  die: 'M6 3h12a3 3 0 013 3v12a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01',
  book: 'M4 5a2 2 0 012-2h12v18H6a2 2 0 01-2-2zM8 7h8M8 11h8',
  map: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
  crown: 'M3 18l2-9 4 4 3-7 3 7 4-4 2 9zM3 18h18',
  pillar: 'M5 21h14M7 21V7M17 21V7M4 7h16l-2-3H6zM10 21v-8h4v8',
  angel: 'M12 4a3 3 0 100 6 3 3 0 000-6zM6 10l-3 6 4-2M18 10l3 6-4-2M10 21l1-5h2l1 5',
  temple: 'M3 21h18M6 21l-2-9h16l-2 9M4 12l8-9 8 9M10 21v-5h4v5',
  chains: 'M9 15a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M15 9a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1',
  spark: 'M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3',
  eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  bag: 'M5 8h14l1 13H4zM9 8V6a3 3 0 016 0v2',
};

export default function Icon({ name, className = 'h-4 w-4', title }: { name: string; className?: string; title?: string }) {
  const path = PATHS[name] ?? PATHS.dungeon;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <path d={path} />
    </svg>
  );
}