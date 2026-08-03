# CSS 骰子模拟器

## 🎲 工具概述

纯 CSS 实现的骰子模拟器，支持 D4/D6/D8/D10/D12/D20/D100 七种常见骰子类型。

## 🎯 功能特性

- **7 种骰子类型** - 支持桌游常用的所有骰子
- **批量投掷** - 可同时投掷多个骰子（最多 20 个/类型）
- **实时动画** - CSS shake 动画模拟投掷效果
- **结果统计** - 自动计算每种骰子和总和
- **纯 CSS 实现** - 无 Three.js 等 3D 库，体积小

## 📁 文件结构

```
app/tools/dice-roller/
└── page.tsx              # 主页面组件（包含所有逻辑）

app/globals.css
└── @keyframes shake      # 摇动动画定义
```

## 🔧 技术实现

### CSS Clip-Path 形状

使用 `clip-path` 的 `polygon()` 函数定义不同骰子形状：

```typescript
const SHAPE_STYLE: Record<DieType, { clipPath: string }> = {
  D4: { clipPath: 'polygon(50% 5%, 95% 90%, 5% 90%)' },        // 三角形
  D6: { clipPath: 'none' },                                     // 正方形
  D8: { clipPath: 'polygon(50% 4%, 96% 50%, 50% 96%, 4% 50%)' }, // 菱形
  D10: { clipPath: 'polygon(50% 3%, 92% 48%, 50% 95%, 8% 48%)' }, // 拉长菱形
  D12: { clipPath: 'polygon(25% 4%, 75% 4%, 97% 50%, 75% 96%, 25% 96%, 3% 50%)' }, // 六边形
  D20: { clipPath: 'polygon(50% 2%, 78% 10%, 96% 35%, 96% 65%, 78% 90%, 50% 98%, 22% 90%, 4% 65%, 4% 35%, 22% 10%)' }, // 十边形
  D100: { clipPath: 'polygon(50% 3%, 92% 48%, 50% 95%, 8% 48%)' }, // 同 D10
};
```

### D6 点数渲染

D6 使用点数而非数字，通过绝对定位的圆点实现：

```typescript
const dots: Record<number, [number, number][]> = {
  1: [[50, 50]],                                    // 中心 1 点
  2: [[22, 78], [78, 22]],                         // 对角 2 点
  3: [[22, 78], [50, 50], [78, 22]],              // 对角 + 中心
  4: [[22, 22], [78, 22], [22, 78], [78, 78]],   // 四角
  5: [[22, 22], [78, 22], [50, 50], [22, 78], [78, 78]], // 四角 + 中心
  6: [[22, 22], [78, 22], [22, 50], [78, 50], [22, 78], [78, 78]], // 三排
};
```

### 投掷逻辑

```typescript
function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

const handleRoll = () => {
  // 1. 生成骰子结果
  const dice = [...]; // 根据选择生成骰子数组
  
  // 2. 触发动画
  setRolling(true);
  
  // 3. 800ms 后显示结果
  setTimeout(() => {
    setRolling(false);
    setResults(dice);
  }, 800);
};
```

### 摇动动画

定义在 `app/globals.css`：

```css
@keyframes shake {
  0%, 100% { transform: translate(0, 0) rotate(0deg) scale(1); }
  10% { transform: translate(-3px, -4px) rotate(-8deg) scale(1.05); }
  20% { transform: translate(4px, 2px) rotate(6deg) scale(0.95); }
  /* ... 更多关键帧 ... */
}

.animate-shake {
  animation: shake 0.6s ease-in-out;
}
```

## 🎨 骰子配置

### 骰子定义

```typescript
const DICE: DieDef[] = [
  { type: 'D4', label: 'D4', color: '#dc2626', bg: '#fef2f2', sides: 4 },
  { type: 'D6', label: 'D6', color: '#2563eb', bg: '#eff6ff', sides: 6 },
  { type: 'D8', label: 'D8', color: '#16a34a', bg: '#f0fdf4', sides: 8 },
  { type: 'D10', label: 'D10', color: '#ea580c', bg: '#fff7ed', sides: 10 },
  { type: 'D12', label: 'D12', color: '#9333ea', bg: '#faf5ff', sides: 12 },
  { type: 'D20', label: 'D20', color: '#ca8a04', bg: '#fefce8', sides: 20 },
  { type: 'D100', label: 'D100', color: '#4b5563', bg: '#f9fafb', sides: 100 },
];
```

### 修改配色

在 `DICE` 数组中修改对应骰子的 `color`（边框和文字）和 `bg`（背景色）。

## 📊 构建体积

- **原方案（Three.js + Rapier）**: 354 KB
- **当前方案（纯 CSS）**: 2.88 KB

体积缩减 **99%**。

## 🔗 相关链接

- 工具路径: `/tools/dice-roller`
- 主要文件: `app/tools/dice-roller/page.tsx`
- 动画定义: `app/globals.css`

## 📝 开发历史

- 最初使用 Three.js + @react-three/rapier 实现 3D 物理模拟
- 用户反馈"太丑了"，完全推翻重做
- 改用纯 CSS clip-path 实现，体积大幅缩减
