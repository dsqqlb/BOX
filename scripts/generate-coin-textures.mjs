#!/usr/bin/env node
/**
 * 生成 EDH 记血器的硬币两面贴图（纯 Node，无第三方依赖）。
 *
 * 为什么要生成真实文件而不是运行时现画：
 *   骰子引擎加载贴图时会无条件在 source 前面拼上 assetPath（'/dice-assets/'，
 *   见 DiceColors.loadImage），所以运行时塞 data URL 会被拼成无效地址；
 *   而 DicePreset 的 labels 分支（不走 DiceColors）又只认带图片扩展名的路径。
 *   两相权衡，最省事、最不"魔法"的做法就是把两张 512×512 的 PNG 放进
 *   public/dice-assets/textures/silvercoin/，与上游库默认找的路径一致——
 *   于是引擎自带的硬币骰（DICE.dc）不改一行代码就能用。
 *
 * 用法：node scripts/generate-coin-textures.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = path.join(projectRoot, 'public', 'dice-assets', 'textures', 'silvercoin');

/* ── 极简 PNG 编码（truecolor + alpha，每行 filter 0） ── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;     // bit depth
  ihdr[9] = 6;     // color type: truecolor + alpha
  ihdr[10] = 0;    // compression
  ihdr[11] = 0;    // filter
  ihdr[12] = 0;    // interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ── 画硬币 ── */

const SIZE = 512;
const CENTER = SIZE / 2;
const RADIUS = CENTER - 4;

function rgba(r, g, b, a = 255) {
  return [Math.max(0, Math.min(255, Math.round(r))), Math.max(0, Math.min(255, Math.round(g))), Math.max(0, Math.min(255, Math.round(b))), Math.round(Math.max(0, Math.min(255, a)))];
}

function mix(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return rgba(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k);
}

function blend(base, over, alpha) {
  const a = Math.max(0, Math.min(1, alpha)) * (over[3] / 255);
  return rgba(
    base[0] + (over[0] - base[0]) * a,
    base[1] + (over[1] - base[1]) * a,
    base[2] + (over[2] - base[2]) * a,
    255,
  );
}

/** 金属底盘：金黄色，中间偏亮、边缘发暗的径向渐变 + 一道斜向高光。 */
function coinBase() {
  const highlightX = CENTER * 0.78;
  const highlightY = CENTER * 0.7;
  const light = rgba(255, 246, 196);
  const mid = rgba(232, 180, 56);
  const dark = rgba(158, 106, 20);
  const edge = rgba(96, 60, 10);

  const out = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - CENTER;
      const dy = y - CENTER;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let color;
      if (distance <= RADIUS) {
        const t = Math.min(1, distance / RADIUS);
        color = t < 0.55 ? mix(light, mid, t / 0.55) : mix(mid, dark, (t - 0.55) / 0.3);
        if (t > 0.85) color = mix(color, edge, (t - 0.85) / 0.15);
        // 打光：以 (highlightX, highlightY) 为中心的柔和高光
        const hx = x - highlightX;
        const hy = y - highlightY;
        const hd = Math.sqrt(hx * hx + hy * hy) / (SIZE * 0.62);
        color = blend(color, rgba(255, 252, 235), Math.max(0, 0.4 * (1 - hd)));
        // 斜向压暗，让圆片有立体感
        const sheen = ((x + y) / (SIZE * 2) - 0.5) * 0.5;
        color = blend(color, rgba(20, 12, 0), Math.max(0, sheen));
      } else {
        color = rgba(0, 0, 0, 0);
      }
      const offset = (y * SIZE + x) * 4;
      out[offset] = color[0];
      out[offset + 1] = color[1];
      out[offset + 2] = color[2];
      out[offset + 3] = color[3];
    }
  }
  return out;
}

function inCircle(x, y, radius) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  return Math.sqrt(dx * dx + dy * dy) <= radius;
}

/** 圆环：返回该像素距离环中心线的远近，用于抗锯齿。 */
function ringDistance(x, y, radius) {
  const dx = x - CENTER;
  const dy = y - CENTER;
  return Math.abs(Math.sqrt(dx * dx + dy * dy) - radius);
}

function fillTriangle(buffer, p0, p1, p2, color) {
  const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
  const maxX = Math.min(SIZE - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
  const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
  const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
  const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // 重心坐标：三个权重都 ≥ 0 即在三角形内
      const w0 = ((p1[1] - p2[1]) * (x - p2[0]) + (p2[0] - p1[0]) * (y - p2[1])) / area;
      const w1 = ((p2[1] - p0[1]) * (x - p2[0]) + (p0[0] - p2[0]) * (y - p2[1])) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.002 && w1 >= -0.002 && w2 >= -0.002) {
        const offset = (y * SIZE + x) * 4;
        if (buffer[offset + 3] === 0) continue;
        const base = [buffer[offset], buffer[offset + 1], buffer[offset + 2], 255];
        const merged = blend(base, color, 0.94);
        buffer[offset] = merged[0];
        buffer[offset + 1] = merged[1];
        buffer[offset + 2] = merged[2];
      }
    }
  }
}

function applyRing(buffer, radius, width, color, alpha) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const offset = (y * SIZE + x) * 4;
      if (buffer[offset + 3] === 0) continue;
      const distance = ringDistance(x, y, radius);
      if (distance > width) continue;
      const strength = (1 - distance / width) * alpha;
      const base = [buffer[offset], buffer[offset + 1], buffer[offset + 2], 255];
      const merged = blend(base, color, strength);
      buffer[offset] = merged[0];
      buffer[offset + 1] = merged[1];
      buffer[offset + 2] = merged[2];
    }
  }
}

function applyDisc(buffer, radius, color, alpha) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const offset = (y * SIZE + x) * 4;
      if (buffer[offset + 3] === 0) continue;
      const dx = x - CENTER;
      const dy = y - CENTER;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius) continue;
      const strength = Math.min(1, (radius - distance) / 2) * alpha;
      const base = [buffer[offset], buffer[offset + 1], buffer[offset + 2], 255];
      const merged = blend(base, color, strength);
      buffer[offset] = merged[0];
      buffer[offset + 1] = merged[1];
      buffer[offset + 2] = merged[2];
    }
  }
}

/** 边缘齿纹：一圈小梯形，让硬币看起来是压出来的而不是切出来的。 */
function applyTeeth(buffer, color) {
  const teeth = 48;
  for (let i = 0; i < teeth; i++) {
    const angle = (i / teeth) * Math.PI * 2;
    const half = 0.055;
    const inner = RADIUS - 22;
    const outer = RADIUS - 6;
    fillTriangle(buffer, [
      CENTER + Math.cos(angle - half) * inner, CENTER + Math.sin(angle - half) * inner,
    ], [
      CENTER + Math.cos(angle) * outer, CENTER + Math.sin(angle) * outer,
    ], [
      CENTER + Math.cos(angle + half) * inner, CENTER + Math.sin(angle + half) * inner,
    ], color);
  }
}

/* 硬币两面是数字「1」和「2」（EDH 桌上用来掷先手/二选一）。
   不依赖任何字体——用矩形/三角形把笔画拼出来：
     1 = 顶部斜起笔 + 竖笔 + 底座
     2 = 顶部弧形（用两条斜笔拼）+ 中间斜笔 + 底横 */
const INK = rgba(92, 54, 8);
const HIGHLIGHT = rgba(255, 244, 208);
const STROKE = 30;

function drawOne(buffer) {
  fillRect(buffer, CENTER - 16, CENTER - 172, STROKE, 344, INK);      // 竖笔
  fillTri(buffer, [-150, -96], [-16, -172], [14, -112], INK);        // 顶部斜起笔
  fillRect(buffer, CENTER - 104, CENTER + 142, 208, STROKE, INK);    // 底座横
  applyRing(buffer, 196, 3, HIGHLIGHT, 0.5);
}

function drawTwo(buffer) {
  // 顶弧：左竖 + 上横 + 右竖，拼成一个方肩圆头的「二」字头
  fillRect(buffer, CENTER - 120, CENTER - 172, STROKE, 96, INK);     // 顶弧左竖
  fillRect(buffer, CENTER - 120, CENTER - 172, 240, STROKE, INK);    // 顶横
  fillRect(buffer, CENTER + 90, CENTER - 172, STROKE, 130, INK);     // 顶弧右竖
  fillTri(buffer, [120, -60], [90, -172], [130, -70], INK);         // 右肩过渡
  // 中间斜笔：从右上斜到左下
  fillTri(buffer, [104, -30], [130, -60], [-118, 100], INK);
  fillTri(buffer, [104, -30], [-118, 100], [-128, 130], INK);
  // 底横
  fillRect(buffer, CENTER - 120, CENTER + 96, 240, STROKE, INK);
  applyRing(buffer, 196, 3, HIGHLIGHT, 0.5);
}

function renderFace(kind) {
  const buffer = coinBase();
  applyTeeth(buffer, rgba(255, 236, 170));
  applyRing(buffer, RADIUS - 44, 6, rgba(120, 72, 10), 0.8);
  applyRing(buffer, RADIUS - 58, 3, HIGHLIGHT, 0.5);
  if (kind === 'one') drawOne(buffer);
  else drawTwo(buffer);
  return encodePng(SIZE, SIZE, buffer);
}

/** 以硬币中心为原点的三角形便捷封装（笔画用相对坐标写起来更直观）。 */
function fillTri(buffer, p0, p1, p2, color) {
  fillTriangle(
    buffer,
    [CENTER + p0[0], CENTER + p0[1]],
    [CENTER + p1[0], CENTER + p1[1]],
    [CENTER + p2[0], CENTER + p2[1]],
    color,
  );
}

function fillRect(buffer, x0, y0, width, height, color) {
  const minX = Math.max(0, Math.round(x0));
  const maxX = Math.min(SIZE - 1, Math.round(x0 + width));
  const minY = Math.max(0, Math.round(y0));
  const maxY = Math.min(SIZE - 1, Math.round(y0 + height));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const offset = (y * SIZE + x) * 4;
      if (buffer[offset + 3] === 0) continue;
      const base = [buffer[offset], buffer[offset + 1], buffer[offset + 2], 255];
      const merged = blend(base, color, 0.94);
      buffer[offset] = merged[0];
      buffer[offset + 1] = merged[1];
      buffer[offset + 2] = merged[2];
    }
  }
}

/* ── 输出 ── */

fs.mkdirSync(targetDir, { recursive: true });

// 与上游 dice-box-threejs 的 DICE.dc 定义完全一致的四个文件名，
// 因此引擎自带硬币骰无需任何改动即可加载。
// 两面：heads = 数字「1」，tail = 数字「2」。
const outputs = [
  ['heads.png', renderFace('one')],
  ['tail.png', renderFace('two')],
  ['heads_bump.png', renderFace('one')],
  ['tail_bump.png', renderFace('two')],
];

for (const [name, buffer] of outputs) {
  const file = path.join(targetDir, name);
  fs.writeFileSync(file, buffer);
  console.log(`✔ ${path.relative(projectRoot, file)}  ${(buffer.length / 1024).toFixed(1)} KB`);
}

console.log(`\n完成：硬币贴图已生成到 ${path.relative(projectRoot, targetDir)}`);
console.log('引擎自带硬币骰 DICE.dc 会直接引用这四个文件（heads / tail 及各自的 bump）。');
