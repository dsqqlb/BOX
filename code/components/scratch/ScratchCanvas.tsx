'use client';

/**
 * 刮开层：贴在票面游戏区上的一层 canvas，按住拖动就把涂层擦掉，像真票一样。
 *
 * 实现要点：
 *   1. 涂层 = canvas 上的渐变 + 斜纹 + 提示文字；擦除用 globalCompositeOperation = 'destination-out'；
 *   2. 笔刷把上一帧的点与当前点连成圆头线段，所以快划不会断成一串圆点；
 *   3. 进度按固定间隔抽样读 alpha 通道（不是每帧），够快也不辣手机；
 *   4. 尺寸变化（手机地址栏伸缩、旋屏）时把整张旧位图缩放搬过去，已刮掉的部分不会白刮；
 *   5. 达标只回调一次。本组件不判定输赢——答案永远由服务端在下发时给出。
 */

import { useCallback, useEffect, useRef } from 'react';

interface ScratchCanvasProps {
  /** 笔刷直径，占游戏区宽度的百分比（升级「刮刀」时把它调大即可）。 */
  brushPercent: number;
  /** 刮开比例达到它就算刮完（与 tickets.json 的 scratch.threshold 一致）。 */
  threshold: number;
  /** 涂层主色（票的 foil 色）。 */
  coatingColor: string;
  /** 达标回调，只会触发一次。 */
  onRevealed: () => void;
  /** 进度回调（0~1），按节流后的频率触发。 */
  onProgress?: (ratio: number) => void;
  /** 格子行列：给了就会顺便统计每格已刮开比例。 */
  cellGrid?: { rows: number; cols: number };
  /** 每格已刮开比例（0~1，长度 = rows × cols），用于让刮到的那一格亮起来。 */
  onCells?: (ratios: number[]) => void;
  /** 自动刮机器：每秒自动擦掉的点数（0 = 关闭）。升级了「自动刮机器」才会传非 0。 */
  autoPointsPerSecond?: number;
  className?: string;
}

const PROGRESS_INTERVAL_MS = 160;
const ALPHA_THRESHOLD = 24;
const SAMPLE_STEP = 4;

export default function ScratchCanvas({
  brushPercent, threshold, coatingColor, onRevealed, onProgress, cellGrid, onCells,
  autoPointsPerSecond = 0, className = '',
}: ScratchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastCheckRef = useRef(0);
  const doneRef = useRef(false);
  // 回调放进 ref：指针事件与尺寸回调里读到的永远是最新 props，不必重建 canvas。
  const propsRef = useRef({ brushPercent, threshold, coatingColor, onRevealed, onProgress, cellGrid, onCells });
  propsRef.current = { brushPercent, threshold, coatingColor, onRevealed, onProgress, cellGrid, onCells };

  /** 画一层新涂层。 */
  const paintCoating = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, propsRef.current.coatingColor);
    gradient.addColorStop(0.45, '#eef1f5');
    gradient.addColorStop(1, propsRef.current.coatingColor);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = Math.max(1, height * 0.012);
    for (let x = -height; x < width; x += Math.max(10, height * 0.16)) {
      ctx.beginPath();
      ctx.moveTo(x, height);
      ctx.lineTo(x + height, 0);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(70, 75, 85, 0.75)';
    ctx.font = `700 ${Math.max(11, height * 0.14)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('用手指刮开涂层', width / 2, height / 2);
    ctx.restore();
  }, []);

  /** 按当前 CSS 尺寸重建画布；preserve=true 时把旧位图缩放贴回去，保留已经刮掉的部分。 */
  const setup = useCallback((preserve: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));

    let previous: HTMLCanvasElement | null = null;
    if (preserve && canvas.width > 1 && canvas.height > 1) {
      previous = document.createElement('canvas');
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext('2d')?.drawImage(canvas, 0, 0);
    }

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    contextRef.current = ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (previous) {
      ctx.drawImage(previous, 0, 0, width, height);
      return;
    }
    paintCoating(ctx, width, height);
  }, [paintCoating]);

  useEffect(() => {
    setup(false);
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let lastWidth = canvas.clientWidth;
    let lastHeight = canvas.clientHeight;
    const observer = new ResizeObserver(() => {
      if (Math.abs(canvas.clientWidth - lastWidth) < 1 && Math.abs(canvas.clientHeight - lastHeight) < 1) return;
      lastWidth = canvas.clientWidth;
      lastHeight = canvas.clientHeight;
      setup(true);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [setup]);

  /** 抽样估算已刮开比例（含逐格比例）；达标时只回调一次。 */
  const measure = useCallback((force: boolean) => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx || doneRef.current) return;
    const now = performance.now();
    if (!force && now - lastCheckRef.current < PROGRESS_INTERVAL_MS) return;
    lastCheckRef.current = now;

    const { width, height } = canvas;
    if (width < 2 || height < 2) return;
    const grid = propsRef.current.cellGrid;
    const cols = grid?.cols || 0;
    const rows = grid?.rows || 0;
    const cellCount = cols * rows;
    const cellTotal = cellCount > 0 ? new Array<number>(cellCount).fill(0) : null;
    const cellCleared = cellCount > 0 ? new Array<number>(cellCount).fill(0) : null;

    let total = 0;
    let cleared = 0;
    try {
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let y = 0; y < height; y += SAMPLE_STEP) {
        for (let x = 0; x < width; x += SAMPLE_STEP) {
          const empty = data[(y * width + x) * 4 + 3] < ALPHA_THRESHOLD;
          total += 1;
          if (empty) cleared += 1;
          if (cellTotal && cellCleared) {
            const cellIndex = Math.min(rows - 1, Math.floor((y / height) * rows)) * cols
              + Math.min(cols - 1, Math.floor((x / width) * cols));
            cellTotal[cellIndex] += 1;
            if (empty) cellCleared[cellIndex] += 1;
          }
        }
      }
    } catch {
      return;
    }

    if (cellTotal && cellCleared) {
      propsRef.current.onCells?.(cellTotal.map((count, index) => (count ? cellCleared[index] / count : 0)));
    }
    const ratio = total ? cleared / total : 0;
    propsRef.current.onProgress?.(ratio);
    if (ratio >= propsRef.current.threshold) {
      doneRef.current = true;
      propsRef.current.onRevealed();
    }
  }, []);

  const pointFrom = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  /** 用圆头线段把两次指针位置连起来擦除；第一次落笔时就是一个圆点。 */
  const scratchTo = useCallback((point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (!canvas || !ctx) return;
    const brush = Math.max(8, (propsRef.current.brushPercent / 100) * canvas.clientWidth);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brush;
    const last = lastPointRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(point.x, point.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    lastPointRef.current = point;
  }, []);

  // 自动刮机器：按等级每秒擦掉若干个点（每 100ms 擦一小撮），刮到达标自动停；机器是「跳跃式」擦，不连成线。
  useEffect(() => {
    if (!autoPointsPerSecond || autoPointsPerSecond <= 0) return undefined;
    const timer = window.setInterval(() => {
      const canvas = canvasRef.current;
      if (!canvas || doneRef.current) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 2 || height < 2) return;
      const points = Math.max(1, Math.round(autoPointsPerSecond / 10));
      for (let index = 0; index < points; index += 1) {
        lastPointRef.current = null;
        scratchTo({ x: Math.random() * width, y: Math.random() * height });
      }
      measure(true);
    }, 100);
    return () => window.clearInterval(timer);
  }, [autoPointsPerSecond, measure, scratchTo]);

  return (
    <canvas
      ref={canvasRef}
      className={`scr-coating ${className}`.trim()}
      onPointerDown={(event) => {
        event.preventDefault();
        if (doneRef.current) return;
        drawingRef.current = true;
        lastPointRef.current = null;
        event.currentTarget.setPointerCapture(event.pointerId);
        scratchTo(pointFrom(event));
        measure(true);
      }}
      onPointerMove={(event) => {
        if (!drawingRef.current) return;
        scratchTo(pointFrom(event));
        measure(false);
      }}
      onPointerUp={() => {
        drawingRef.current = false;
        lastPointRef.current = null;
        measure(true);
      }}
      onPointerCancel={() => {
        drawingRef.current = false;
        lastPointRef.current = null;
        measure(true);
      }}
    />
  );
}