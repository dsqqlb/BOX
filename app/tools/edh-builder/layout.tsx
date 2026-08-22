import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import DisableZoom from '@/components/common/DisableZoom';

// 组牌页面按"应用"体验处理：禁用双击缩放、双指捏合缩放，避免误操作放大。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function EdhBuilderLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DisableZoom />
      {children}
    </>
  );
}
