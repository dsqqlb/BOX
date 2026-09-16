'use client';

import { useState, useEffect, useRef } from 'react';

interface RuneExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (options: ExportOptions) => void;
  langName: string;
  langFont: string;
  englishText: string;
}

export interface ExportOptions {
  color: string;
  fontSize: number;
  backgroundColor: string;
  padding: number;
}

const PRESET_COLORS = [
  { name: '深棕', value: '#451a03' },
  { name: '黑色', value: '#000000' },
  { name: '深灰', value: '#374151' },
  { name: '金色', value: '#d97706' },
  { name: '深红', value: '#7f1d1d' },
  { name: '深蓝', value: '#1e3a8a' },
];

const PRESET_BG = [
  { name: '透明', value: 'transparent' },
  { name: '米黄', value: '#fefce8' },
  { name: '浅灰', value: '#f3f4f6' },
  { name: '白色', value: '#ffffff' },
];

export default function RuneExportModal({ isOpen, onClose, onExport, langName, langFont, englishText }: RuneExportModalProps) {
  const [color, setColor] = useState('#451a03');
  const [fontSize, setFontSize] = useState(24);
  const [backgroundColor, setBackgroundColor] = useState('transparent');
  const [padding, setPadding] = useState(40);
  const isInitialized = useRef(false);

  // 从 localStorage 恢复导出设置
  useEffect(() => {
    if (isOpen && !isInitialized.current) {
      const savedColor = localStorage.getItem('dnd-export-color');
      const savedFontSize = localStorage.getItem('dnd-export-fontSize');
      const savedBgColor = localStorage.getItem('dnd-export-bgColor');
      const savedPadding = localStorage.getItem('dnd-export-padding');

      if (savedColor) setColor(savedColor);
      if (savedFontSize) setFontSize(Number(savedFontSize));
      if (savedBgColor) setBackgroundColor(savedBgColor);
      if (savedPadding) setPadding(Number(savedPadding));

      isInitialized.current = true;
    }
  }, [isOpen]);

  // 保存到 localStorage
  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-export-color', color);
    }
  }, [color]);

  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-export-fontSize', String(fontSize));
    }
  }, [fontSize]);

  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-export-bgColor', backgroundColor);
    }
  }, [backgroundColor]);

  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-export-padding', String(padding));
    }
  }, [padding]);

  if (!isOpen) return null;

  const handleExport = () => {
    onExport({ color, fontSize, backgroundColor, padding });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden flex"
        style={{
          background: 'linear-gradient(to bottom, rgba(254, 252, 232, 0.98), rgba(245, 230, 211, 0.98))',
          border: '3px solid #78350f',
          maxHeight: '90vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左侧：设置面板 */}
        <div className="w-96 flex flex-col">
          {/* Header */}
          <div
            className="px-6 py-4 border-b-2"
            style={{
              background: 'linear-gradient(135deg, #f5e6d3, #e8d5c4)',
              borderColor: '#d97706',
            }}
          >
            <div className="flex items-center justify-between">
              <h3
                className="text-xl font-bold"
                style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
              >
                🎨 导出设置
              </h3>
              <button
                onClick={onClose}
                className="text-2xl leading-none transition-colors hover:opacity-70"
                style={{ color: '#78350f' }}
              >
                ×
              </button>
            </div>
            <p
              className="text-sm mt-1"
              style={{ fontFamily: 'Georgia, serif', color: '#92400e' }}
            >
              {langName} 符文导出
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* 文字颜色 */}
            <div>
              <label
                className="block text-sm font-bold mb-2"
                style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
              >
                文字颜色
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_COLORS.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setColor(preset.value)}
                    className="relative px-3 py-2 rounded-lg text-xs font-medium transition-all border-2"
                    style={{
                      backgroundColor: color === preset.value ? '#fef3c7' : 'rgba(254, 252, 232, 0.5)',
                      borderColor: color === preset.value ? '#d97706' : '#e8d5c4',
                      color: '#78350f',
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded-full mr-2 border"
                      style={{ backgroundColor: preset.value, borderColor: '#d97706' }}
                    />
                    {preset.name}
                  </button>
                ))}
              </div>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="mt-2 w-full h-10 rounded-lg border-2 cursor-pointer"
                style={{ borderColor: '#d97706' }}
              />
            </div>

            {/* 字体大小 */}
            <div>
              <label
                className="block text-sm font-bold mb-2"
                style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
              >
                字体大小: {fontSize}px
              </label>
              <input
                type="range"
                min="16"
                max="48"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: 'linear-gradient(to right, #d97706, #f59e0b)',
                }}
              />
              <div
                className="flex justify-between text-xs mt-1"
                style={{ color: '#92400e' }}
              >
                <span>16px</span>
                <span>48px</span>
              </div>
            </div>

            {/* 背景颜色 */}
            <div>
              <label
                className="block text-sm font-bold mb-2"
                style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
              >
                背景颜色
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PRESET_BG.map((preset) => (
                  <button
                    key={preset.value}
                    onClick={() => setBackgroundColor(preset.value)}
                    className="px-3 py-2 rounded-lg text-xs font-medium transition-all border-2"
                    style={{
                      backgroundColor: backgroundColor === preset.value ? '#fef3c7' : 'rgba(254, 252, 232, 0.5)',
                      borderColor: backgroundColor === preset.value ? '#d97706' : '#e8d5c4',
                      color: '#78350f',
                      fontFamily: 'Georgia, serif',
                    }}
                  >
                    <span
                      className="inline-block w-3 h-3 rounded mr-2 border"
                      style={{
                        backgroundColor: preset.value === 'transparent' ? '#ffffff' : preset.value,
                        borderColor: '#d97706',
                        backgroundImage: preset.value === 'transparent'
                          ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                          : 'none',
                        backgroundSize: '8px 8px',
                        backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
                      }}
                    />
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 内边距 */}
            <div>
              <label
                className="block text-sm font-bold mb-2"
                style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
              >
                内边距: {padding}px
              </label>
              <input
                type="range"
                min="10"
                max="80"
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: 'linear-gradient(to right, #d97706, #f59e0b)',
                }}
              />
              <div
                className="flex justify-between text-xs mt-1"
                style={{ color: '#92400e' }}
              >
                <span>紧凑</span>
                <span>宽松</span>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="px-6 py-4 border-t-2 flex justify-end gap-3"
            style={{ borderColor: '#d97706' }}
          >
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                backgroundColor: '#92400e',
                color: '#fef3c7',
                fontFamily: 'Georgia, serif',
              }}
            >
              取消
            </button>
            <button
              onClick={handleExport}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg hover:shadow-xl"
              style={{
                backgroundColor: '#16a34a',
                color: '#fef3c7',
                fontFamily: 'Georgia, serif',
              }}
            >
              💾 导出图片
            </button>
          </div>
        </div>

        {/* 右侧：预览区域 */}
        <div
          className="flex-1 p-6 flex flex-col"
          style={{
            background: 'linear-gradient(135deg, #e8d5c4, #d4c4b0)',
            borderLeft: '2px solid #d97706',
          }}
        >
          <div
            className="text-sm font-bold mb-3"
            style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
          >
            👁️ 实时预览
          </div>
          <div
            className="flex-1 rounded-xl border-2 overflow-auto flex items-center justify-center"
            style={{
              borderColor: '#d97706',
              background: backgroundColor === 'transparent'
                ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)'
                : backgroundColor,
              backgroundSize: backgroundColor === 'transparent' ? '20px 20px' : 'auto',
              backgroundPosition: backgroundColor === 'transparent' ? '0 0, 0 10px, 10px -10px, -10px 0px' : 'auto',
            }}
          >
            <div
              style={{
                padding: `${padding}px`,
                fontFamily: `'${langFont}', Georgia, serif`,
                fontSize: `${fontSize}px`,
                lineHeight: '1.8',
                color: color,
                letterSpacing: '0.02em',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
                maxWidth: '100%',
                textAlign: 'left',
              }}
            >
              {englishText || '请先输入英文文本...'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
