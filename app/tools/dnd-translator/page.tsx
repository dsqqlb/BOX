'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import ToolHeader from '@/components/common/ToolHeader';
import { translateText } from '@/lib/translate';
import html2canvas from 'html2canvas';
import RuneExportModal, { ExportOptions } from '@/components/dnd/RuneExportModal';
import LanguageSelectModal from '@/components/dnd/LanguageSelectModal';

// ====== DND 语言配置映射 ======
// 在此添加/删除/修改 DND 语言，字体文件需放在 public/fonts/ 目录下
// 并在 app/globals.css 中添加对应的 @font-face 声明
const DND_LANGUAGES = [
  { id: 'dwarvish', name: '矮人语', nameEn: 'Dwarvish', font: 'Davek' },
  { id: 'magi', name: '卷轴', nameEn: 'Magi', font: 'Magi' },
  { id: 'elvish', name: '精灵语', nameEn: 'Elvish', font: 'Elvish' },
  // 添加更多语言示例：
  // { id: 'elvish', name: '精灵语', nameEn: 'Elvish', font: 'Elvish' },
  // { id: 'draconic', name: '龙语', nameEn: 'Draconic', font: 'Draconic' },
];

export default function DNDTranslatorPage() {
  const [chineseText, setChineseText] = useState('');
  const [englishText, setEnglishText] = useState('');
  const [selectedLangId, setSelectedLangId] = useState(DND_LANGUAGES[0].id);
  const [addedLangs, setAddedLangs] = useState<string[]>([]);
  const [translating, setTranslating] = useState<'zh-en' | 'en-zh' | null>(null);
  const [error, setError] = useState('');
  const runeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [langSelectModalOpen, setLangSelectModalOpen] = useState(false);
  const [exportingLang, setExportingLang] = useState<{ id: string; name: string; nameEn: string; font: string } | null>(null);
  const isInitialized = useRef(false);

  // 从 localStorage 恢复状态
  useEffect(() => {
    const savedChinese = localStorage.getItem('dnd-translator-chinese');
    const savedEnglish = localStorage.getItem('dnd-translator-english');
    const savedLangs = localStorage.getItem('dnd-translator-langs');

    if (savedChinese) setChineseText(savedChinese);
    if (savedEnglish) setEnglishText(savedEnglish);
    if (savedLangs) {
      try {
        const langs = JSON.parse(savedLangs);
        if (Array.isArray(langs) && langs.length > 0) {
          setAddedLangs(langs);
        } else {
          // 空数组，使用默认值
          setAddedLangs([DND_LANGUAGES[0].id]);
        }
      } catch (e) {
        console.error('Failed to parse saved languages', e);
        setAddedLangs([DND_LANGUAGES[0].id]);
      }
    } else {
      // 第一次使用，使用默认值
      setAddedLangs([DND_LANGUAGES[0].id]);
    }

    // 延迟标记初始化完成，确保 state 设置完毕
    setTimeout(() => {
      isInitialized.current = true;
    }, 0);
  }, []);

  // 保存到 localStorage（只有初始化后才保存）
  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-translator-chinese', chineseText);
    }
  }, [chineseText]);

  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-translator-english', englishText);
    }
  }, [englishText]);

  useEffect(() => {
    if (isInitialized.current) {
      localStorage.setItem('dnd-translator-langs', JSON.stringify(addedLangs));
    }
  }, [addedLangs]);

  // 中文 → 英文
  const handleZhToEn = useCallback(async () => {
    if (!chineseText.trim()) return;
    setTranslating('zh-en');
    setError('');
    try {
      const result = await translateText(chineseText, 'zh', 'en');
      setEnglishText(result);
    } catch (err) {
      setError('翻译失败，请稍后重试');
      console.error(err);
    } finally {
      setTranslating(null);
    }
  }, [chineseText]);

  // 英文 → 中文
  const handleEnToZh = useCallback(async () => {
    if (!englishText.trim()) return;
    setTranslating('en-zh');
    setError('');
    try {
      const result = await translateText(englishText, 'en', 'zh');
      setChineseText(result);
    } catch (err) {
      setError('翻译失败，请稍后重试');
      console.error(err);
    } finally {
      setTranslating(null);
    }
  }, [englishText]);

  // 添加 DND 语言
  const handleAddLang = useCallback((langId: string) => {
    if (!addedLangs.includes(langId)) {
      setAddedLangs([...addedLangs, langId]);
    }
  }, [addedLangs]);

  // 删除 DND 语言
  const handleRemoveLang = useCallback((langId: string) => {
    setAddedLangs(addedLangs.filter(id => id !== langId));
  }, [addedLangs]);

  // 打开导出弹窗
  const handleOpenExportModal = useCallback((langId: string) => {
    const lang = DND_LANGUAGES.find(l => l.id === langId);
    if (lang && englishText.trim()) {
      setExportingLang(lang);
      setExportModalOpen(true);
    }
  }, [englishText]);

  // 下载符文图片
  const handleDownloadRune = useCallback(async (options: ExportOptions) => {
    if (!exportingLang || !englishText.trim()) return;

    try {
      // 创建临时容器，应用用户选择的样式
      const tempContainer = document.createElement('div');
      tempContainer.style.cssText = `
        position: fixed;
        left: -9999px;
        padding: ${options.padding}px;
        font-family: '${exportingLang.font}', Georgia, serif;
        font-size: ${options.fontSize}px;
        line-height: 1.8;
        color: ${options.color};
        letter-spacing: 0.02em;
        white-space: pre-wrap;
        word-wrap: break-word;
        max-width: 800px;
        background-color: ${options.backgroundColor === 'transparent' ? 'transparent' : options.backgroundColor};
      `;
      tempContainer.textContent = englishText;
      document.body.appendChild(tempContainer);

      const canvas = await html2canvas(tempContainer, {
        backgroundColor: options.backgroundColor === 'transparent' ? null : options.backgroundColor,
        scale: 3, // 提高分辨率
        useCORS: true,
      });

      document.body.removeChild(tempContainer);

      // 生成文件名：语言英文名_日期时间.png
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
      const filename = `${exportingLang.nameEn}_${dateStr}_${timeStr}.png`;

      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Failed to download rune image', err);
      setError('图片下载失败');
    }
  }, [exportingLang, englishText]);

  // 清空
  const handleClear = useCallback(() => {
    setChineseText('');
    setEnglishText('');
    setError('');
  }, []);

  return (
    <div
      className="min-h-screen"
      style={{
        background: 'linear-gradient(135deg, #f5e6d3 0%, #e8d5c4 50%, #d4c4b0 100%)',
        backgroundAttachment: 'fixed',
      }}
    >
      {/* Header */}
      <ToolHeader
        className="backdrop-blur-sm !bg-amber-900/10 !border-b-2 !border-amber-800/30"
        textClassName="text-amber-900 hover:text-amber-700"
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* 标题 */}
        <div className="text-center mb-8">
          <h1
            className="text-4xl sm:text-5xl font-bold mb-3"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              color: '#78350f',
              textShadow: '2px 2px 4px rgba(0,0,0,0.1)',
              letterSpacing: '0.05em',
            }}
          >
            🏰 DND 语言翻译器
          </h1>
          <p
            className="text-sm sm:text-base"
            style={{
              fontFamily: 'Georgia, serif',
              color: '#92400e',
            }}
          >
            龙与地下城 · 跨越位面的语言之桥
          </p>
        </div>

        {/* 上半部分：中英文翻译区 - 两栏布局 */}
        <div
          className="rounded-xl shadow-2xl overflow-hidden border-4"
          style={{
            borderColor: '#78350f',
            background: `
              linear-gradient(to bottom, rgba(245, 230, 211, 0.95), rgba(232, 213, 196, 0.95)),
              repeating-linear-gradient(
                0deg,
                transparent,
                transparent 1px,
                rgba(120, 53, 15, 0.03) 1px,
                rgba(120, 53, 15, 0.03) 2px
              )
            `,
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x-2 divide-amber-800/20">
            {/* 左栏：中文 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3
                  className="text-lg font-bold"
                  style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
                >
                  中文
                </h3>
                <button
                  onClick={handleZhToEn}
                  disabled={translating !== null || !chineseText.trim()}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: '#78350f',
                    color: '#fef3c7',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                >
                  {translating === 'zh-en' ? '翻译中...' : '→ 英文'}
                </button>
              </div>
              <textarea
                value={chineseText}
                onChange={(e) => setChineseText(e.target.value)}
                placeholder="输入中文文本..."
                className="w-full h-64 p-4 rounded-lg resize-none focus:outline-none focus:ring-2 transition-shadow"
                style={{
                  backgroundColor: 'rgba(254, 252, 232, 0.8)',
                  border: '2px solid #d97706',
                  color: '#292524',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontSize: '15px',
                  lineHeight: '1.6',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
                }}
              />
            </div>

            {/* 右栏：英文 */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3">
                <h3
                  className="text-lg font-bold"
                  style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
                >
                  English
                </h3>
                <button
                  onClick={handleEnToZh}
                  disabled={translating !== null || !englishText.trim()}
                  className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: '#78350f',
                    color: '#fef3c7',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  }}
                >
                  {translating === 'en-zh' ? 'Translating...' : '→ 中文'}
                </button>
              </div>
              <textarea
                value={englishText}
                onChange={(e) => setEnglishText(e.target.value)}
                placeholder="Enter English text..."
                className="w-full h-64 p-4 rounded-lg resize-none focus:outline-none focus:ring-2 transition-shadow"
                style={{
                  backgroundColor: 'rgba(254, 252, 232, 0.8)',
                  border: '2px solid #d97706',
                  color: '#292524',
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: '15px',
                  lineHeight: '1.6',
                  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.06)',
                }}
              />
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div
            className="mt-4 p-3 rounded-lg text-sm text-center"
            style={{
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              border: '2px solid #dc2626',
              color: '#7f1d1d',
            }}
          >
            {error}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={handleClear}
            className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-lg hover:shadow-xl"
            style={{
              backgroundColor: '#92400e',
              color: '#fef3c7',
              fontFamily: 'Georgia, serif',
            }}
          >
            清空全部
          </button>
        </div>

        {/* 下半部分：DND 语言列表区 */}
        <div className="mt-8">
          <div
            className="rounded-xl shadow-2xl overflow-hidden border-4"
            style={{
              borderColor: '#78350f',
              background: `
                linear-gradient(to bottom, rgba(245, 230, 211, 0.95), rgba(232, 213, 196, 0.95)),
                repeating-linear-gradient(
                  0deg,
                  transparent,
                  transparent 1px,
                  rgba(120, 53, 15, 0.03) 1px,
                  rgba(120, 53, 15, 0.03) 2px
                )
              `,
            }}
          >
            {/* 添加语言区 */}
            <div className="p-6 border-b-2 border-amber-800/20">
              <div className="flex items-center gap-3">
                <h3
                  className="text-lg font-bold"
                  style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
                >
                  DND 语言翻译
                </h3>
                <button
                  onClick={() => setLangSelectModalOpen(true)}
                  className="ml-auto px-4 py-1.5 rounded-md text-sm font-semibold transition-all"
                  style={{
                    backgroundColor: '#78350f',
                    color: '#fef3c7',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    fontFamily: 'Georgia, serif',
                  }}
                >
                  + 添加语言
                </button>
              </div>
            </div>

            {/* 已添加的语言列表 */}
            <div className="p-6 space-y-4">
              {addedLangs.length === 0 ? (
                <p
                  className="text-center py-8 text-sm opacity-60"
                  style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
                >
                  暂无添加的语言，请在上方选择后点击"添加"
                </p>
              ) : (
                addedLangs.map(langId => {
                  const lang = DND_LANGUAGES.find(l => l.id === langId);
                  if (!lang) return null;
                  return (
                    <div
                      key={langId}
                      className="rounded-lg p-4 border-2"
                      style={{
                        backgroundColor: 'rgba(254, 243, 199, 0.6)',
                        borderColor: '#b45309',
                      }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <h4
                          className="text-base font-bold"
                          style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
                        >
                          {lang.name} · {lang.nameEn}
                        </h4>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleOpenExportModal(langId)}
                            disabled={!englishText.trim()}
                            className="px-3 py-1 rounded-md text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-green-700"
                            style={{
                              backgroundColor: '#16a34a',
                              color: '#fef3c7',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            }}
                            title="下载 PNG 图片"
                          >
                            💾 下载
                          </button>
                          <button
                            onClick={() => handleRemoveLang(langId)}
                            className="px-3 py-1 rounded-md text-xs font-semibold transition-all hover:bg-red-600"
                            style={{
                              backgroundColor: '#dc2626',
                              color: '#fef3c7',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div
                        ref={(el) => {
                          if (el) runeRefs.current.set(langId, el);
                        }}
                        className="min-h-[100px] p-4 rounded-lg"
                        style={{
                          backgroundColor: 'rgba(254, 252, 232, 0.5)',
                          border: '2px solid #d97706',
                          fontFamily: `'${lang.font}', Georgia, serif`,
                          fontSize: '18px',
                          lineHeight: '1.8',
                          color: '#451a03',
                          textShadow: '0 1px 2px rgba(0,0,0,0.1)',
                          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.1)',
                          letterSpacing: '0.02em',
                        }}
                      >
                        {englishText || (
                          <span
                            className="opacity-40 text-sm"
                            style={{ fontFamily: 'Georgia, serif' }}
                          >
                            英文文本将以 {lang.name} 符文显示...
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* 说明卡片 */}
        <div
          className="mt-8 p-5 rounded-xl border-2"
          style={{
            backgroundColor: 'rgba(254, 252, 232, 0.7)',
            borderColor: '#d97706',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          }}
        >
          <h3
            className="text-base font-bold mb-3"
            style={{ fontFamily: 'Georgia, serif', color: '#78350f' }}
          >
            📜 使用说明
          </h3>
          <ul
            className="space-y-2 text-sm leading-relaxed"
            style={{ fontFamily: 'Georgia, serif', color: '#92400e' }}
          >
            <li>• 在左侧输入<strong>中文</strong>，点击"→ 英文"翻译到右栏</li>
            <li>• 在右侧输入<strong>英文</strong>，点击"→ 中文"翻译到左栏</li>
            <li>• 在下方选择 <strong>DND 语言</strong> 后点击"添加"，可同时显示多种语言的符文</li>
            <li>• 每个语言卡片右上角可点击"删除"移除该语言</li>
            <li>• 翻译服务由 MyMemory API 提供，每日免费额度 500 次</li>
          </ul>
        </div>
      </div>

      {/* 导出弹窗 */}
      <RuneExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        onExport={handleDownloadRune}
        langName={exportingLang ? `${exportingLang.name} · ${exportingLang.nameEn}` : ''}
        langFont={exportingLang?.font || ''}
        englishText={englishText}
      />

      {/* 语言选择弹窗 */}
      <LanguageSelectModal
        isOpen={langSelectModalOpen}
        onClose={() => setLangSelectModalOpen(false)}
        onSelect={handleAddLang}
        availableLanguages={DND_LANGUAGES}
        addedLangIds={addedLangs}
      />
    </div>
  );
}
