import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import DisableZoom from '@/components/common/DisableZoom';
import './notequest.css';

// 地牢探索也要"桌面应用"的手感：骰盘是全屏遮罩，点门/点片段是主要操作，
// 所以关掉双击缩放与双指捏合，避免误触把页面放大。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function NoteQuestLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DisableZoom />
      {children}
    </>
  );
}