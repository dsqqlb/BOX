# Claude Code 学习中心

## 📚 工具概述

Claude Code 学习中心是一个交互式文档工具，提供 Claude Code 的完整使用指南。

## 🎯 功能特性

- **核心指令说明** - 常用指令及使用场景
- **实用技巧分享** - 提升效率的使用技巧
- **高级用法介绍** - 进阶功能和最佳实践
- **常见问题解答** - 常见问题及解决方案

## 📁 文件结构

```
app/tools/claude-code-guide/
└── page.tsx                  # 主页面组件

data/
└── claude-code-guide.json    # 学习内容数据
```

## 🔧 技术实现

### 数据结构

内容存储在 `data/claude-code-guide.json`：

```json
{
  "sections": [
    {
      "id": "basics",
      "title": "基础指令",
      "items": [
        {
          "title": "指令名称",
          "description": "指令说明",
          "example": "使用示例"
        }
      ]
    }
  ]
}
```

### 组件实现

页面使用标签页切换不同章节，支持搜索过滤和代码高亮。

## 📝 内容维护

### 添加新章节

编辑 `data/claude-code-guide.json`，添加新的 section：

```json
{
  "id": "new-section",
  "title": "新章节标题",
  "items": [
    // 章节内容
  ]
}
```

### 更新内容

直接修改 JSON 文件中对应条目即可，无需修改代码。

## 🎨 样式特点

- 响应式布局，适配移动端
- 暗色主题支持
- 代码块语法高亮
- 平滑的标签页切换动画

## 🔗 相关链接

- 工具路径: `/tools/claude-code-guide`
- 数据文件: `data/claude-code-guide.json`
