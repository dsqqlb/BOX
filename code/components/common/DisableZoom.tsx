'use client';

import { useEffect } from 'react';

/**
 * 阻止移动端双指捏合缩放（pinch zoom）与 iOS 的原生手势缩放。
 * 说明：
 * - 双击缩放已由 globals.css 的 `html { touch-action: manipulation }` 禁用；
 * - Android Chrome 尊重 viewport 的 user-scalable=no，但 iOS Safari 会忽略它，
 *   所以这里用 touchmove/gesturestart 事件兜底，只拦截多指手势，单指滚动不受影响。
 */
export default function DisableZoom() {
  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const onGesture = (e: Event) => e.preventDefault();
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('gesturestart', onGesture);
    return () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('gesturestart', onGesture);
    };
  }, []);
  return null;
}
