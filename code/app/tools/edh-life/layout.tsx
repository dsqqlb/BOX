import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import DisableZoom from '@/components/common/DisableZoom';
import './edh-life.css';

// 记血器是"桌面应用"体验：禁用双击缩放与双指捏合，避免玩家点血量时误触放大。
// 长按是本工具的核心操作（按住 ±5），所以还要在页面 CSS 里关掉长按系统菜单与文本选择。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function EdhLifeLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DisableZoom />
      {children}
    </>
  );
}
