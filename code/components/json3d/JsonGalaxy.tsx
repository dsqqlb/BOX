'use client';

import { useRef, useMemo, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line, Html, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// ====== 向量工具 ======
function v3(x: number, y: number, z: number): [number, number, number] { return [x, y, z]; }
function vAdd(a: [number, number, number], b: [number, number, number]): [number, number, number] { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function vScale(v: [number, number, number], s: number): [number, number, number] { return [v[0] * s, v[1] * s, v[2] * s]; }
function vLen(v: [number, number, number]): number { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
function vNorm(v: [number, number, number]): [number, number, number] { const l = vLen(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function vCross(a: [number, number, number], b: [number, number, number]): [number, number, number] { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function vDot(a: [number, number, number], b: [number, number, number]): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// ====== 类型定义 ======
export interface JsonNode3D {
  key: string;
  valuePreview: string;
  type: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  depth: number;
  position: [number, number, number];
  color: string;
  emissive: string;
  size: number;
  parentIndex: number;
  parentPos: [number, number, number] | null;
  jsonPath: string;
  hasChildren: boolean; // 是否展开了子星球（纯基础类型数组即使是array类型也不展开，直接完整显示内容）
}

// ====== 颜色与材质 ======
const TYPE_CFG: Record<string, { color: string; emissive: string; roughness: number; metalness: number }> = {
  object: { color: '#f59e0b', emissive: '#78350f', roughness: 0.2, metalness: 0.45 },
  array: { color: '#a78bfa', emissive: '#4c1d95', roughness: 0.25, metalness: 0.4 },
  string: { color: '#3b82f6', emissive: '#1e3a8a', roughness: 0.18, metalness: 0.15 },
  number: { color: '#10b981', emissive: '#064e3b', roughness: 0.12, metalness: 0.35 },
  boolean: { color: '#f472b6', emissive: '#831843', roughness: 0.18, metalness: 0.2 },
  null: { color: '#6b7280', emissive: '#1f2937', roughness: 0.5, metalness: 0.08 },
};

function getType(v: any): JsonNode3D['type'] {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonNode3D['type'];
}

// 数组里的元素是否全是基础类型（string/number/boolean/null，不含对象和嵌套数组）
// 这类数组（如手机号列表、标签列表、端口列表）不值得拆成一堆只有 [0][1][2] 标签的子星球，
// 直接把完整内容当成叶子节点的值显示更清晰、也更省星球数量
function isPrimitiveArray(v: any[]): boolean {
  return v.every((item: any) => item === null || (typeof item !== 'object'));
}

function preview(v: any, t: JsonNode3D['type']): string {
  if (t === 'string') return `"${v.length > 30 ? v.slice(0, 30) + '\u2026' : v}"`;
  if (t === 'null') return 'null';
  if (t === 'boolean') return String(v);
  if (t === 'number') return String(v);
  if (t === 'array') {
    if (isPrimitiveArray(v)) {
      // 完整展示，只有真的很长时才截断（避免极端超长数组把标签撑爆）
      const full = `[${v.map((item: any) => typeof item === 'string' ? `"${item}"` : String(item)).join(', ')}]`;
      return full.length > 80 ? full.slice(0, 80) + '\u2026]' : full;
    }
    return `Array(${v.length})`;
  }
  return `{\u2026${Object.keys(v).length} keys}`;
}

function nodeSize(t: JsonNode3D['type'], isLeafArray = false): number {
  if (t === 'array' && isLeafArray) return 0.3; // 叶子数组（纯基础类型）当成值展示，尺寸接近 string
  return t === 'object' ? 0.7 : t === 'array' ? 0.55 : t === 'string' ? 0.28 : t === 'number' ? 0.24 : 0.18;
}

// ====== JSON → 星系节点（球形布局） ======
export function jsonToGalaxy(obj: any): JsonNode3D[] {
  const nodes: JsonNode3D[] = [];

  function flatten(
    value: any, key: string, depth: number,
    parentIndex: number, parentPos: [number, number, number], path: string
  ): number {
    const type = getType(value);
    // 纯基础类型数组不展开子星球，直接把完整内容当叶子节点显示
    const isLeafArray = type === 'array' && isPrimitiveArray(value);
    const cfg = TYPE_CFG[type];
    const idx = nodes.length;
    nodes.push({
      key, valuePreview: preview(value, type), type, depth,
      position: v3(0, 0, 0), color: cfg.color, emissive: cfg.emissive,
      size: nodeSize(type, isLeafArray), parentIndex,
      parentPos: parentIndex >= 0 ? parentPos : null, jsonPath: path,
      hasChildren: type === 'object'
        ? Object.keys(value).length > 0
        : (type === 'array' && !isLeafArray ? value.length > 0 : false),
    });
    const myIdx = idx;
    if (type === 'object')
      Object.entries(value as Record<string, any>).forEach(([k, v]) =>
        flatten(v, k, depth + 1, myIdx, v3(0, 0, 0), `${path}.${k}`));
    else if (type === 'array' && !isLeafArray)
      (value as any[]).forEach((item, i) =>
        flatten(item, `[${i}]`, depth + 1, myIdx, v3(0, 0, 0), `${path}[${i}]`));
    return myIdx;
  }

  flatten(obj, 'root', 0, -1, v3(0, 0, 0), '$');

  // ---- 球形布局 ----
  // 按 parentIndex 分组子节点
  const childrenMap = new Map<number, number[]>();
  nodes.forEach((_n, i) => {
    const p = nodes[i].parentIndex;
    if (!childrenMap.has(p)) childrenMap.set(p, []);
    childrenMap.get(p)!.push(i);
  });

  // 递归计算位置
  function placeChildren(parentIdx: number) {
    const kids = childrenMap.get(parentIdx);
    if (!kids || kids.length === 0) return;

    const parent = parentIdx >= 0 ? nodes[parentIdx] : null;
    const depth = parent ? parent.depth + 1 : (parentIdx < 0 ? 0 : 1);
    const radius = depth === 0 ? 0 : 2 + depth * 3.5;

    // 根节点本身就在原点
    if (depth === 0) {
      nodes[kids[0]].position = v3(0, 0, 0);
      placeChildren(kids[0]);
      return;
    }

    const parentPos: [number, number, number] = parent ? parent.position : v3(0, 0, 0);
    const isAtOrigin = vLen(parentPos) < 0.01;

    kids.forEach((nodeIdx, i) => {
      const node = nodes[nodeIdx];

      if (isAtOrigin) {
        // 父节点在原点 → Fibonacci 球面分布
        const phi = Math.acos(1 - 2 * (i + 0.5) / kids.length);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        node.position = v3(
          radius * Math.sin(phi) * Math.cos(theta),
          radius * Math.cos(phi),
          radius * Math.sin(phi) * Math.sin(theta)
        );
      } else {
        // 非原点父节点 → 锥形散布
        const parentDir = vNorm(parentPos);
        const worldUp: [number, number, number] = [0, 1, 0];
        const refUp = Math.abs(vDot(parentDir, worldUp)) > 0.95 ? v3(1, 0, 0) : worldUp;
        const right = vNorm(vCross(refUp, parentDir));
        const up = vCross(parentDir, right);

        const spreadAngle = Math.min(0.55, 0.18 + kids.length * 0.07);
        const azAngle = (i / Math.max(kids.length, 1)) * Math.PI * 2;
        const cosA = Math.cos(spreadAngle), sinA = Math.sin(spreadAngle);
        const cosAz = Math.cos(azAngle), sinAz = Math.sin(azAngle);

        const dir = vNorm([
          parentDir[0] * cosA + (right[0] * cosAz + up[0] * sinAz) * sinA,
          parentDir[1] * cosA + (right[1] * cosAz + up[1] * sinAz) * sinA,
          parentDir[2] * cosA + (right[2] * cosAz + up[2] * sinAz) * sinA,
        ]);
        node.position = vScale(dir, radius);
      }

      node.parentPos = parent ? parent.position : null;
      placeChildren(nodeIdx); // 递归
    });
  }

  placeChildren(-1); // 从根开始
  return nodes;
}

// ====== 单个星球 ======
function JsonPlanet({ node, index, isHovered, isSelected, showId, onHover, onUnhover, onClick }: {
  node: JsonNode3D; index: number; isHovered: boolean; isSelected: boolean;
  showId: boolean; onHover: () => void; onUnhover: () => void; onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const cfg = TYPE_CFG[node.type];

  useFrame((state) => {
    if (meshRef.current) { meshRef.current.rotation.y += 0.004; meshRef.current.rotation.x += 0.001; }
    if (glowRef.current) glowRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2.5 + node.position[0]) * 0.06);
    if (groupRef.current && isSelected) groupRef.current.rotation.y += 0.01;
  });

  const active = isHovered || isSelected;
  const showLabel = showId || active;
  const s = isSelected ? node.size * 1.4 : node.size;

  return (
    <group ref={groupRef} position={node.position}>
      {isSelected && (
        <mesh rotation={[Math.PI / 2.2, 0, 0]}>
          <torusGeometry args={[s * 2.0, 0.04, 16, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} depthWrite={false} />
        </mesh>
      )}
      <mesh ref={glowRef}
        onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
        onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <sphereGeometry args={[s * 2.0, 32, 32]} />
        <meshBasicMaterial color={node.color} transparent opacity={active ? 0.4 : 0.12} depthWrite={false} />
      </mesh>
      <mesh ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
        onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        <sphereGeometry args={[s, 48, 48]} />
        <meshStandardMaterial color={node.color} emissive={cfg.emissive}
          emissiveIntensity={active ? 1.3 : 0.5} roughness={cfg.roughness} metalness={cfg.metalness} />
      </mesh>
      {node.hasChildren && node.depth > 0 && (
        <group rotation={[Math.PI / 2.5, 0.3, 0]}>
          <mesh>
            <torusGeometry args={[s * 1.8, 0.018, 16, 64]} />
            <meshBasicMaterial color={node.color} transparent opacity={active ? 0.4 : 0.18} depthWrite={false} />
          </mesh>
        </group>
      )}
      {showLabel && (
        <Html center style={{ pointerEvents: 'none' }}>
          <div className={`text-xs font-mono whitespace-nowrap px-2 py-0.5 rounded-md ${active ? 'opacity-100' : 'opacity-70'}`}
            style={{
              background: 'rgba(10,10,25,0.92)', color: node.color,
              border: `1px solid ${node.color}55`, backdropFilter: 'blur(6px)',
              fontSize: isSelected ? '13px' : '11px',
            }}>
            <span className="font-bold">{node.key}</span>
            {showId && <span className="text-white/40 ml-1.5" style={{ fontSize: '10px' }}>L{node.depth}#{index}</span>}
            {!showId && !node.hasChildren && node.type !== 'object' && (
              <span className="text-white/70 ml-1.5">{node.valuePreview}</span>
            )}
            {!showId && node.type === 'object' && !node.hasChildren && (
              <span className="text-white/40 ml-1.5">{'{}'}</span>
            )}
          </div>
        </Html>
      )}
    </group>
  );
}

// ====== 连线 ======
function ConnectionLines({ nodes, lineWidth }: { nodes: JsonNode3D[]; lineWidth: number }) {
  const lines = useMemo(() => {
    const r: { start: [number, number, number]; end: [number, number, number]; color: string }[] = [];
    nodes.forEach(n => { if (n.parentPos && n.depth > 0) r.push({ start: n.parentPos, end: n.position, color: n.color }); });
    return r;
  }, [nodes]);
  // 线宽趋近于0时线本身几乎不可见，透明度跟着线宽走一点，视觉上更像"丝滑变细"而不是瞬间消失
  const opacity = Math.min(0.65, 0.15 + lineWidth * 0.25);
  return (
    <group>
      {lines.map((l, i) => (
        <Line key={i} points={[l.start, l.end]} color={l.color} lineWidth={lineWidth} transparent opacity={opacity} depthWrite={false} />
      ))}
    </group>
  );
}

// ====== 中心恒星 ======
function CentralStar({ node, index, active, showId, onHover, onUnhover, onClick }: {
  node: JsonNode3D; index: number; active: boolean; showId: boolean;
  onHover: () => void; onUnhover: () => void; onClick: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (groupRef.current) groupRef.current.rotation.y += 0.003;
    if (outerRef.current) outerRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.5) * 0.05);
  });
  return (
    <group ref={groupRef} position={node.position}
      onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
      onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <mesh ref={outerRef}>
        <sphereGeometry args={[1.6, 32, 32]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={active ? 0.15 : 0.06} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.15, 32, 32]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={active ? 0.3 : 0.15} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.65, 64, 64]} />
        <meshStandardMaterial color="#fef3c7" emissive="#f59e0b" emissiveIntensity={active ? 3 : 1.5}
          roughness={0.08} metalness={0.2} />
      </mesh>
      <mesh rotation={[Math.PI / 2.5, 0.2, 0]}>
        <torusGeometry args={[1.2, 0.015, 16, 100]} />
        <meshBasicMaterial color="#fbbf24" transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh rotation={[Math.PI / 3, -0.3, 0.1]}>
        <torusGeometry args={[1.3, 0.01, 16, 80]} />
        <meshBasicMaterial color="#fcd34d" transparent opacity={0.3} depthWrite={false} />
      </mesh>
      {active && (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.55, 0.05, 16, 64]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.6} depthWrite={false} />
        </mesh>
      )}
      {(showId || active) && (
        <Html center style={{ pointerEvents: 'none' }}>
          <div className="text-xs font-mono whitespace-nowrap px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(10,10,25,0.92)', color: '#fbbf24', border: '1px solid #f59e0b55', backdropFilter: 'blur(6px)' }}>
            <span className="font-bold">{node.key}</span>
            {showId && <span className="text-white/40 ml-1.5" style={{ fontSize: '10px' }}>L0#{index}</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

// ====== 主星系 ======
export interface JsonGalaxyHandle {
  focusOn: (position: [number, number, number], size: number) => void;
}

const JsonGalaxy = forwardRef<JsonGalaxyHandle, {
  nodes: JsonNode3D[]; showIds: boolean; selectedNodeIndex: number | null;
  onSelectNode: (index: number) => void; focusTrigger: number; lineWidth?: number;
}>(function JsonGalaxy({ nodes, showIds, selectedNodeIndex, onSelectNode, focusTrigger, lineWidth = 0 }, ref) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const controlsRef = useRef<any>(null);
  const focusPos = useRef<THREE.Vector3 | null>(null);
  const focusSz = useRef(0);
  const focusDistOverride = useRef<number | null>(null); // 重置视角用：直接指定目标距离，跳过按size计算
  const prevTrigger = useRef(0);
  const { camera } = useThree();
  // 记录相机初始位置，用于"重置视角"还原到最初的整体俯瞰视角
  const initialCamPos = useRef(camera.position.clone());
  const initialCamDist = useRef(camera.position.length());

  useImperativeHandle(ref, () => ({
    focusOn: (pos: [number, number, number], size: number) => {
      focusPos.current = new THREE.Vector3(...pos);
      focusSz.current = size;
      focusDistOverride.current = null;
    },
  }));

  useEffect(() => {
    if (focusTrigger > prevTrigger.current) {
      if (selectedNodeIndex !== null && selectedNodeIndex < nodes.length) {
        const n = nodes[selectedNodeIndex];
        focusPos.current = new THREE.Vector3(...n.position);
        focusSz.current = n.size;
        focusDistOverride.current = null;
      } else {
        // selectedNodeIndex 为 null（点击"重置视角"）：回到原点，并还原到初始相机距离
        // （按 size 换算的 desiredDist 上限只有12，达不到初始视角的距离，所以这里直接指定距离）
        focusPos.current = new THREE.Vector3(0, 0, 0);
        focusDistOverride.current = initialCamDist.current;
      }
    }
    prevTrigger.current = focusTrigger;
  }, [focusTrigger, selectedNodeIndex, nodes]);

  // 平滑相机：目标 + 距离
  useFrame((_, delta) => {
    if (!focusPos.current || !controlsRef.current) return;
    const t = focusPos.current;
    const cs = camera.position;
    const ct = controlsRef.current.target;

    // 平滑移动目标
    ct.lerp(t, 4 * delta);

    // 计算合适距离：小节点近，大节点远；重置视角时用初始相机距离覆盖
    const desiredDist = focusDistOverride.current !== null
      ? focusDistOverride.current
      : Math.max(2, Math.min(12, focusSz.current * 11 + 2));
    const currentDist = cs.distanceTo(ct);
    const dir = cs.clone().sub(ct).normalize();
    const newDist = currentDist + (desiredDist - currentDist) * 3 * delta;
    camera.position.copy(ct.clone().add(dir.multiplyScalar(newDist)));

    controlsRef.current.update();

    if (ct.distanceTo(t) < 0.03 && Math.abs(currentDist - desiredDist) < 0.1) {
      focusPos.current = null;
    }
  });

  const rootNode = nodes.find(n => n.depth === 0);
  if (!rootNode || nodes.length === 0) return null;
  const rootIdx = nodes.indexOf(rootNode);

  return (
    <group>
      <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08}
        minDistance={1.5} maxDistance={60} maxPolarAngle={Math.PI * 0.8}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      <CentralStar node={rootNode} index={rootIdx} active={selectedNodeIndex === rootIdx || hoveredIndex === rootIdx}
        showId={showIds} onHover={() => setHoveredIndex(rootIdx)} onUnhover={() => setHoveredIndex(null)}
        onClick={() => onSelectNode(rootIdx)} />
      <ConnectionLines nodes={nodes} lineWidth={lineWidth} />
      {nodes.filter(n => n.depth > 0).map((node) => {
        const ri = nodes.indexOf(node);
        return (
          <JsonPlanet key={node.jsonPath} node={node} index={ri}
            isHovered={hoveredIndex === ri} isSelected={selectedNodeIndex === ri} showId={showIds}
            onHover={() => setHoveredIndex(ri)} onUnhover={() => setHoveredIndex(null)}
            onClick={() => onSelectNode(ri)} />
        );
      })}
    </group>
  );
});

export default JsonGalaxy;
