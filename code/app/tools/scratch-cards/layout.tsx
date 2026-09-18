import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import DisableZoom from '@/components/common/DisableZoom';
import './scratch-cards.css';

// 刮刮乐是「桌面 + 机器」型工具：一屏不滚动、手指当刮刀，所以和记血器一样钉死视口缩放。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function ScratchCardsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DisableZoom />
      {children}
    </>
  );
}