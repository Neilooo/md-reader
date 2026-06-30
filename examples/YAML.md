---
title: "YAML Front Matter 测试"
author: "MD Reader"
date: "2026-06-30"
tags: [测试, Front Matter, Markdown]
draft: false
nested:
  category: demo
  priority: high
---

# YAML Front Matter 预览测试

上方被 `---` 包裹的 YAML Front Matter 会在预览模式中显示为信息卡片，正文会正常按 Markdown 渲染。

## 验证要点

1. 预览顶部显示 `YAML Front Matter` 信息卡片。
2. 大纲只显示正文标题，不把 Front Matter 当作正文标题。
3. 预览/编辑模式切换时，正文行号同步仍然接近当前位置。
4. 导出 HTML / PDF / DOCX 时保留 Front Matter 信息卡片。

## 代码块示例

```python
print("Hello, YAML Front Matter!")
```
