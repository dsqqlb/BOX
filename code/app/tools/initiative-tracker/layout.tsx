import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import DisableZoom from '@/components/common/DisableZoom';

// 遥控器（及同路由下的展示页）按"应用"体验处理：禁用双击缩放、双指捏合缩放。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function InitiativeTrackerLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DisableZoom />
      {children}
    </>
  );
}
