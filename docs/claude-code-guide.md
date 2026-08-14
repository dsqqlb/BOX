# Claude Code 学习中心

路径：`/tools/claude-code-guide`
所需权限：`claude-code-guide`

这是项目内置的 Claude Code 学习参考页。页面将 `data/claude-code-guide.json` 中的内容按章节渲染为说明、命令卡片、技巧、高级主题和常见问题。

## 使用

- 在页面中顺序浏览各章节。
- 命令条目展示用途和示例，可使用复制按钮复制命令文本。
- 页面底部可返回工具箱首页。

页面内容是静态参考资料，不会调用 Claude API，也不会向服务端提交学习内容。

## 内容维护

学习资料的唯一数据源是 `data/claude-code-guide.json`。更新已有条目或新增章节时，请保持现有 `sections` 数组结构：

```json
{
  "id": "commands",
  "title": "常用命令",
  "items": [
    {
      "command": "/example",
      "description": "说明",
      "usage": "用法",
      "example": "示例"
    }
  ]
}
```

不同章节使用的字段会有所不同；修改前请对照同一章节的现有数据。内容更新后重新构建或在开发服务中刷新页面即可。
