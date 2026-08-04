'use client';

import { useState, useMemo, useCallback, useRef, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import ToolHeader from '@/components/common/ToolHeader';
import JsonGalaxy, { jsonToGalaxy, JsonGalaxyHandle } from '@/components/json3d/JsonGalaxy';

// ====== 示例 JSON ======
const SAMPLE = `{
  "universe": "Milky Way",
  "planets": [
    {
      "name": "Earth",
      "type": "terrestrial",
      "moons": 1,
      "habitable": true,
      "diameter_km": 12742
    },
    {
      "name": "Mars",
      "type": "terrestrial",
      "moons": 2,
      "habitable": false,
      "diameter_km": 6779
    },
    {
      "name": "Jupiter",
      "type": "gas_giant",
      "moons": 95,
      "habitable": false,
      "diameter_km": 139820
    }
  ],
  "star": {
    "name": "Sun",
    "spectral_type": "G2V",
    "age_billion_years": 4.6,
    "surface_temp_k": 5778
  },
  "metadata": {
    "version": "2.0",
    "tags": ["space", "astronomy", "exploration"],
    "verified": true
  }
}`;

export default function JsonVisualizerPage() {
  // ---- 状态 ----
  const [jsonText, setJsonText] = useState(SAMPLE);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showIds, setShowIds] = useState(false);
  const [selectedNodeIndex, setSelectedNodeIndex] = useState<number | null>(null);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const galaxyRef = useRef<JsonGalaxyHandle>(null);

  // ---- 解析 JSON ----
  const parsed = useMemo(() => {
    const t = jsonText.trim();
    if (!t) return null;
    try { const p = JSON.parse(t); setError(''); return p; }
    catch (e: any) { setError(e.message || 'Invalid JSON'); return null; }
  }, [jsonText]);

  // ---- 生成星系 ----
  const galaxyNodes = useMemo(() => parsed ? jsonToGalaxy(parsed) : [], [parsed]);

  // ---- 选中节点 ----
  const selectedNode = selectedNodeIndex !== null && selectedNodeIndex < galaxyNodes.length
    ? galaxyNodes[selectedNodeIndex] : null;

  // ---- 格式化 ----
  const handleFormat = useCallback(() => {
    if (!parsed) return;
    setJsonText(JSON.stringify(parsed, null, 2));
  }, [parsed]);

  // ---- 压缩 ----
  const handleMinify = useCallback(() => {
    if (!parsed) return;
    setJsonText(JSON.stringify(parsed));
  }, [parsed]);

  // ---- 复制 ----
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [jsonText]);

  // ---- 清空 ----
  const handleClear = useCallback(() => { setJsonText(''); setError(''); }, []);

  // ---- 加载示例 ----
  const handleLoadSample = useCallback(() => setJsonText(SAMPLE), []);

  // ---- 选中星球 → 滚动源码 ----
  const handleSelectNode = useCallback((index: number) => {
    setSelectedNodeIndex(index);
    setFocusTrigger(prev => prev + 1);

    // 滚动编辑器到对应键
    const node = galaxyNodes[index];
    if (!node || !textareaRef.current) return;
    const lines = jsonText.split('\n');
    // 按 jsonPath 匹配：$.planets[0].name → 搜索 "name":
    const pathParts = node.jsonPath.replace(/^\$\.?/, '').split(/[.\[]/).filter(Boolean);
    const searchKey = pathParts[pathParts.length - 1]?.replace(/\]/g, '');
    if (!searchKey) return;
    // 找匹配行
    const pattern = new RegExp(`"${searchKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        const lineHeight = 21;
        textareaRef.current.scrollTop = Math.max(0, (i - 3) * lineHeight);
        textareaRef.current.focus();
        // 设置光标位置
        const charsBefore = lines.slice(0, i).join('\n').length + (i > 0 ? 1 : 0);
        const matchPos = charsBefore + (lines[i].indexOf(searchKey) - 1);
        textareaRef.current.setSelectionRange(matchPos, matchPos + searchKey.length + 2);
        break;
      }
    }
  }, [galaxyNodes, jsonText]);

  // ---- 跳转父节点 ----
  const handleGoParent = useCallback(() => {
    if (!selectedNode || selectedNode.parentIndex < 0) return;
    handleSelectNode(selectedNode.parentIndex);
  }, [selectedNode, handleSelectNode]);

  // ---- 编辑器点击 → 选中星球 ----
  const handleEditorClick = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const cursorPos = ta.selectionStart;
    const before = jsonText.substring(0, cursorPos);
    const lineNum = before.split('\n').length;
    const lines = jsonText.split('\n');
    const line = lines[lineNum - 1] || '';
    const m = line.match(/"([^"]+)"\s*:/);
    if (m) {
      const key = m[1];
      const idx = galaxyNodes.findIndex(n => n.key === key);
      if (idx >= 0) {
        setSelectedNodeIndex(idx);
        setFocusTrigger(prev => prev + 1);
      }
    }
  }, [jsonText, galaxyNodes]);

  // ---- 同步滚动行号 ----
  const handleTextareaScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const lineCount = jsonText.split('\n').length;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#0a0a1a]">
      {/* 顶部导航 */}
      <div className="flex-shrink-0 z-20">
        <ToolHeader
          className="!bg-[#0d0d22]/90 !backdrop-blur-xl !border-b !border-white/8"
          textClassName="text-white/70 hover:text-white"
        />
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* ====== 左侧边栏 ====== */}
        <div
          className={`flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out border-r border-white/8 ${sidebarOpen ? 'w-[400px]' : 'w-0'}`}
          style={{ background: '#12121d' }}
        >
          <div className="w-[400px] h-full flex flex-col">
            {/* 工具栏 */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/6 bg-[#0d0d1a]">
              <button onClick={handleLoadSample}
                className="px-2.5 py-1.5 text-[11px] rounded-md bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80 transition-colors">
                示例
              </button>
              <div className="flex-1" />
              <button onClick={handleFormat}
                className="px-2.5 py-1.5 text-[11px] rounded-md bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
                title="格式化 (Shift+Alt+F)">
                格式化
              </button>
              <button onClick={handleMinify}
                className="px-2.5 py-1.5 text-[11px] rounded-md bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition-colors">
                压缩
              </button>
              <button onClick={handleCopy}
                className="px-2.5 py-1.5 text-[11px] rounded-md bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80 transition-colors">
                {copied ? '✓' : '复制'}
              </button>
              <button onClick={handleClear}
                className="px-2.5 py-1.5 text-[11px] rounded-md bg-red-500/10 text-red-400/70 hover:bg-red-500/20 transition-colors">
                清空
              </button>
            </div>

            {/* 编辑器区 */}
            <div className="flex-1 flex overflow-hidden relative">
              {/* 行号 */}
              <div ref={gutterRef}
                className="w-10 flex-shrink-0 overflow-hidden select-none pt-3 pb-3 text-right pr-2 text-xs font-mono leading-[21px] text-white/18 bg-[#0d0d1a]"
                aria-hidden>
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="h-[21px]">{i + 1}</div>
                ))}
              </div>
              {/* 编辑区 */}
              <textarea
                ref={textareaRef}
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setSelectedNodeIndex(null); }}
                onClick={handleEditorClick}
                onScroll={handleTextareaScroll}
                onKeyUp={handleEditorClick}
                spellCheck={false}
                className="flex-1 bg-transparent text-sm font-mono text-[#d4d4d4] placeholder-white/15 resize-none focus:outline-none p-3 leading-[21px]"
                style={{
                  caretColor: '#569cd6',
                  tabSize: 2,
                  background: '#12121d',
                }}
                placeholder='{"key": "value", "nested": {"array": [1, 2, 3]}}'
              />
            </div>

            {/* 错误/节点数 */}
            <div className="flex-shrink-0 px-3 py-1.5 border-t border-white/6 flex items-center gap-3 text-[11px] font-mono">
              {error ? (
                <span className="text-red-400">⚠ {error}</span>
              ) : (
                <>
                  <span className="text-white/35">
                    {galaxyNodes.length > 0 ? `${galaxyNodes.length} nodes` : 'No data'}
                  </span>
                  {selectedNode && (
                    <span className="text-white/25">|</span>
                  )}
                  {selectedNode && (
                    <span style={{ color: selectedNode.color }}>
                      📍 {selectedNode.jsonPath}
                    </span>
                  )}
                </>
              )}
              <div className="flex-1" />
              {selectedNode && selectedNode.parentIndex >= 0 && (
                <button onClick={handleGoParent}
                  className="px-2 py-0.5 rounded text-[11px] bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors flex items-center gap-1"
                  title="跳转到父节点">
                  ⬆ 父节点
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ====== 侧边栏折叠按钮 ====== */}
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-30 w-6 h-16 flex items-center justify-center rounded-r-lg transition-all duration-300 hover:w-8 group"
          style={{
            background: 'rgba(18,18,29,0.95)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderLeft: 'none',
            left: sidebarOpen ? '400px' : '0px',
          }}
          title={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
        >
          <span className="text-white/50 text-xs group-hover:text-white/80 transition-colors">
            {sidebarOpen ? '◀' : '▶'}
          </span>
        </button>

        {/* ====== 3D 画布 ====== */}
        <div className="flex-1 relative" style={{ touchAction: 'none' }}>
          <Canvas
            camera={{ position: [0, 8, 20], fov: 55 }}
            gl={{ antialias: true, alpha: false }}
            style={{ background: 'radial-gradient(ellipse at center, #0a0a2e 0%, #000010 70%)' }}
          >
            <Suspense fallback={null}>
              <ambientLight intensity={0.35} />
              <pointLight position={[0, 5, 5]} intensity={2.5} color="#4a6cf7" />
              <pointLight position={[-10, -3, -5]} intensity={1.2} color="#7c3aed" />
              <pointLight position={[10, -5, 0]} intensity={1} color="#06b6d4" />
              <Stars radius={80} depth={60} count={3000} factor={5} saturation={0.3} fade speed={0.5} />
              <JsonGalaxy
                ref={galaxyRef}
                nodes={galaxyNodes}
                showIds={showIds}
                selectedNodeIndex={selectedNodeIndex}
                onSelectNode={handleSelectNode}
                focusTrigger={focusTrigger}
              />
            </Suspense>
          </Canvas>

          {/* 浮动控件 */}
          <div className="absolute top-4 right-4 z-10 flex flex-col gap-2">
            {/* 显示ID开关 */}
            <button
              onClick={() => setShowIds(o => !o)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-all duration-200 backdrop-blur-md border ${showIds ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]' : 'bg-white/5 border-white/10 text-white/45 hover:bg-white/10 hover:text-white/70'}`}
              title={showIds ? '隐藏 ID 标签' : '显示 ID 标签'}
            >
              🏷
            </button>
            {/* 重置视角 */}
            <button
              onClick={() => {
                setSelectedNodeIndex(null);
                setFocusTrigger(prev => prev + 1);
              }}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-sm bg-white/5 border border-white/10 text-white/45 hover:bg-white/10 hover:text-white/70 transition-all backdrop-blur-md"
              title="重置视角"
            >
              🎯
            </button>
          </div>

          {/* 底部提示 */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-4 text-[11px] text-white/25 font-mono">
            <span>🖱 拖拽旋转</span>
            <span>🔍 滚轮缩放</span>
            <span>✋ 右键平移</span>
            <span>👆 点击星球</span>
          </div>
        </div>
      </div>
    </div>
  );
}
