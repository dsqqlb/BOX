# DND 语言翻译器

## 🏰 工具概述

龙与地下城（DND）语言翻译器，支持中英文互译并以 DND 语言符文（字体）显示翻译结果。

## 🎯 功能特性

- **中英文互译** - 使用 MyMemory 免费翻译 API
- **多语言符文显示** - 支持同时显示多种 DND 语言
- **自定义字体系统** - 基于 `@font-face` 的语言字体映射
- **动态语言管理** - 可添加/删除语言卡片
- **中世纪羊皮纸风格** - 沉浸式主题设计

## 📁 文件结构

```
app/tools/dnd-translator/
└── page.tsx                  # 主页面组件

lib/
└── translate.ts              # MyMemory API 封装

app/globals.css
└── @font-face                # DND 语言字体声明

public/fonts/
├── Davek.otf                 # 矮人语字体
└── Magi.TTF                  # 卷轴·Magi 字体
```

## 🔧 技术实现

### 翻译 API

使用 MyMemory Translation API（免费 500 次/日）：

```typescript
// lib/translate.ts
export async function translateText(
  text: string,
  from: Language,
  to: Language
): Promise<string> {
  const langPair = `${from}|${to}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;
  
  const response = await fetch(url);
  const data = await response.json();
  return data.responseData.translatedText;
}
```

### 语言配置映射

在 `app/tools/dnd-translator/page.tsx` 中定义：

```typescript
const DND_LANGUAGES = [
  { id: 'dwarvish', name: '矮人语', nameEn: 'Dwarvish', font: 'Davek' },
  { id: 'magi', name: '卷轴·Magi', nameEn: 'Magi', font: 'Magi' },
  // 更多语言...
];
```

字段说明：
- `id`: 唯一标识符（小写英文）
- `name`: 中文名称
- `nameEn`: 英文名称
- `font`: 字体 family 名称（与 CSS 中的 `font-family` 一致）

### 字体声明

在 `app/globals.css` 中声明：

```css
@font-face {
  font-family: 'Davek';
  src: url('/fonts/Davek.otf') format('opentype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Magi';
  src: url('/fonts/Magi.TTF') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
```

## 🎨 添加新字体

### 步骤 1：准备字体文件

将字体文件放到 `public/fonts/` 目录：

```
public/fonts/
├── Davek.otf      # 矮人语
├── Magi.TTF       # 卷轴·Magi
└── YourFont.ttf   # 你的新字体
```

### 步骤 2：注册字体

在 `app/globals.css` 中添加 `@font-face` 声明：

```css
@font-face {
  font-family: 'YourFont';
  src: url('/fonts/YourFont.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
```

**格式说明：**
- `.otf` 文件使用 `format('opentype')`
- `.ttf` 文件使用 `format('truetype')`

### 步骤 3：配置语言映射

编辑 `app/tools/dnd-translator/page.tsx` 中的 `DND_LANGUAGES` 数组：

```typescript
const DND_LANGUAGES = [
  { id: 'dwarvish', name: '矮人语', nameEn: 'Dwarvish', font: 'Davek' },
  { id: 'magi', name: '卷轴·Magi', nameEn: 'Magi', font: 'Magi' },
  { id: 'yourfont', name: '你的语言', nameEn: 'YourLang', font: 'YourFont' },
];
```

### 步骤 4：测试

重启开发服务器：

```bash
npm run dev
```

访问翻译器页面，在下拉菜单中应该能看到新语言。

## 🎨 样式特点

### 羊皮纸背景

使用渐变 + repeating-linear-gradient 模拟纸张纹理：

```css
background: 
  linear-gradient(to bottom, rgba(245, 230, 211, 0.95), rgba(232, 213, 196, 0.95)),
  repeating-linear-gradient(
    0deg,
    transparent,
    transparent 1px,
    rgba(120, 53, 15, 0.03) 1px,
    rgba(120, 53, 15, 0.03) 2px
  );
```

### 配色方案

- 主色调：琥珀色系（`#78350f`, `#92400e`, `#d97706`）
- 背景：米黄到浅棕渐变（`#f5e6d3` → `#e8d5c4` → `#d4c4b0`）
- 文本框：浅黄色（`rgba(254, 252, 232, 0.8)`）
- 字体：Georgia 衬线字体（营造中世纪感）

## 📊 API 限制

MyMemory Translation API 免费额度：
- **500 次请求/天**
- 无需注册
- 支持中英文互译

超出额度后会返回错误，需等待第二天重置。

## 🔗 相关链接

- 工具路径: `/tools/dnd-translator`
- 主要文件: `app/tools/dnd-translator/page.tsx`
- API 封装: `lib/translate.ts`
- 字体声明: `app/globals.css`

## 📝 开发历史

- 初版：垂直堆叠布局（中文 → 英文 → 矮人语）
- 改版 1：横向三栏布局（中文 | 英文 | DND 语言下拉）
- 改版 2：上下分栏布局（上：中英互译 | 下：DND 语言列表，支持多语言同时显示）
