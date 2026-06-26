# MD Reader

[English](README.en.md) | **简体中文**

[![Release](https://img.shields.io/github/v/release/Neilooo/md-reader?include_prereleases&color=blue)](https://github.com/Neilooo/md-reader/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Neilooo/md-reader/total)](https://github.com/Neilooo/md-reader/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux%20(experimental)-lightgrey)]()

一个轻量、快速、所见即所得的 Markdown 桌面阅读器与编辑器，基于 Tauri 2 + Vue 3 + Rust 构建。

体积小（约 5 MB），启动快，支持多标签页、源码编辑、公式、图表、代码高亮、文件树、全文搜索、PDF/HTML/DOCX 导出。

📦 **[下载最新版本](https://github.com/Neilooo/md-reader/releases/latest)**

---

## 主要特性

### 多标签页
- 同时打开多个 Markdown 文件，工具栏下方水平标签栏切换
- 点击切换、中键关闭，再次打开已打开的文件会聚焦到对应标签而非重复打开
- 每个标签独立保留内容、未保存草稿、编辑/预览模式、大纲和滚动位置，切换即恢复现场
- 应用重启后自动恢复上次打开的标签列表与激活项

### 阅读
- CommonMark + GitHub Flavored Markdown
- 代码语法高亮（highlight.js，30+ 语言）
- 数学公式（KaTeX，按需加载）
- 流程图 / 时序图 / 思维导图（Mermaid，按需加载）
- 任务列表 / 脚注 / Emoji / 标题锚点
- 亮 / 暗主题切换，记忆主题偏好

### 编辑
- CodeMirror 源码编辑模式，支持 Markdown 高亮、行号、折叠、括号匹配、查找/替换、跳转行
- 预览 / 编辑一键切换，未保存内容可直接切回预览查看效果
- 手动保存 / 另存为，切换文件、关闭标签、关闭窗口和外部变更时保护未保存修改

### 导航
- 左侧文件树，递归扫描文件夹
- 右侧 TOC 大纲，滚动同步高亮
- 三栏可拖拽分隔条，独立显隐
- 内部链接 `[文本](./other.md#锚点)` 跳转
- 图片相对路径自动解析

### 查找
- `Ctrl+F` 当前文档查找（高亮、上一/下一）
- `Ctrl+Shift+F` 跨文件全文搜索（Rust 后端高速）

### 导出
- **PDF**（Edge headless，1-3 秒，所见即所得，无 LaTeX）
- **HTML**（自包含单文件，图片/CSS 全部内嵌）
- **DOCX**（pandoc 路线，需安装 pandoc）

### 体验
- 阅读设置：字号、行高、宽度、字体可调
- 文件变更监听，自动刷新
- 最近文件 + 滚动位置记忆
- 文件关联：`.md / .markdown / .mdx` 双击直接打开
- 单例运行：从资源管理器多次打开会复用窗口
- 拖拽文件到窗口直接打开
- 界面语言切换：简体中文 / English

## 快捷键

| 键 | 动作 |
|---|---|
| `Ctrl+F` | 当前文档查找；编辑模式下打开编辑器查找 |
| `Ctrl+H` | 编辑模式下替换 |
| `Ctrl+G` | 编辑模式下跳转行 |
| `Ctrl+Shift+F` | 全文搜索 |
| `Ctrl+,` | 阅读设置 |
| `Ctrl+S` | 保存当前文件 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+P` | 系统打印 / 另存为 PDF |
| `Esc` | 关闭查找 / 设置 / 弹窗 |

## 安装

### Windows（正式版）

从 [Releases 页面](https://github.com/Neilooo/md-reader/releases/latest) 下载：

| 文件 | 说明 |
|---|---|
| `MD-Reader-*-windows-x64-setup.msi` | 安装版：双击安装，自动注册 `.md / .markdown / .mdx` 文件关联 |
| `MD-Reader-*-windows-x64-portable.exe` | 绿色版：解压即用，不写注册表 |

> Windows 10 / 11 自带 WebView2 Runtime，无需额外安装。旧版 Windows 10 可能需要从 [Microsoft 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 单独安装 WebView2 Runtime。

### macOS / Linux（实验版）

macOS 和 Linux 构建目前为**实验性**，通过 GitHub Actions 生成，未做代码签名：

1. 进入仓库的 **Actions** 标签页 → 选择 **Experimental builds (macOS / Linux)** 工作流 → **Run workflow**
2. 运行结束后在该次运行页面底部的 **Artifacts** 下载对应产物（macOS `.dmg`/`.app`，Linux `.deb`/`.rpm`/`.AppImage`）

> 实验版未签名：macOS 首次打开需右键 → 打开，或执行 `xattr -dr com.apple.quarantine "MD Reader.app"`；Linux AppImage 需先 `chmod +x`。

## 使用前需要安装的外部工具

**核心阅读和编辑功能完全不需要安装任何东西**。可选功能按需安装：

| 功能 | 依赖 | Win10/11 默认 | 安装方法 |
|---|---|:-:|---|
| 阅读 / 编辑 / 多标签 / 文件树 / 全文搜索 / 公式 / 图表 / HTML 导出 | 无 | — | 无需安装 |
| **PDF 导出**（所见即所得） | Microsoft Edge（Chromium）/ Chrome | ✅ 自带 | 通常已自带；如缺失从 [microsoft.com/edge](https://www.microsoft.com/edge) 下载 |
| **DOCX 导出** | [pandoc](https://pandoc.org/) ≥ 2.x | ❌ | 见下方 |
| 打印 | 系统打印 | ✅ 自带 | 无需安装 |

### 安装 pandoc（仅 DOCX 导出需要）

```powershell
winget install --id JohnMacFarlane.Pandoc -e
```

或从 [pandoc.org/installing.html](https://pandoc.org/installing.html) 下载安装包。安装完成后需要重启 MD Reader。

> 如果你只需要 PDF / HTML 导出，不需要安装 pandoc。

## 开发

### 环境要求

| 工具 | 版本 | 安装 |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org/ |
| pnpm | ≥ 8 | `npm install -g pnpm` |
| Rust | ≥ 1.77 | https://rustup.rs/ |
| WebView2 Runtime | — | Win10/11 自带 |
| Visual Studio Build Tools | 2019+ | 含 "Desktop development with C++" 工作负载 |

### 命令

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
pnpm lint
pnpm format
```

## 技术栈

- **桌面框架**: Tauri 2（Rust + WebView2）
- **前端**: Vue 3 + TypeScript + Vite
- **Markdown**: markdown-it + 多个插件
- **编辑器**: CodeMirror 6
- **公式**: KaTeX
- **图表**: Mermaid
- **代码高亮**: highlight.js
- **PDF 导出**: 系统 Edge `--headless=new --print-to-pdf`
- **DOCX 导出**: pandoc
- **文件监听**: notify + notify-debouncer-mini
- **全文搜索**: walkdir + 流式逐行扫描
- **单例运行 / 文件关联**: tauri-plugin-single-instance
- **国际化**: vue-i18n

## PDF 导出原理

不依赖 LaTeX 或额外的渲染引擎。

1. 前端把已渲染的 DOM（KaTeX 公式、Mermaid SVG 已就绪）抓取
2. 图片转 base64 内嵌、KaTeX/highlight.js CSS 内嵌
3. Rust 写临时 HTML 到 `%TEMP%`（ASCII 路径）
4. 调用系统 Edge headless 模式：`--headless=new --print-to-pdf=...`
5. Edge 完成后把 PDF 拷贝到用户选择的目标路径

结果：1-3 秒生成，与阅读器视觉完全一致。

## 常见问题

### Q: 启动应用提示缺失 WebView2？

A: 从 https://developer.microsoft.com/microsoft-edge/webview2/ 下载 Evergreen Bootstrapper 安装一次即可。Win10 21H2 及以上、Win11 默认自带。

### Q: 导出 PDF 时找不到 Edge？

A: 应用会弹文件选择对话框让你指定 `msedge.exe` 路径。也可以选择 Chrome（`chrome.exe`），同样工作。

### Q: 导出 DOCX 提示未检测到 pandoc？

A: 安装 pandoc 后重启 MD Reader。

### Q: 支持 macOS / Linux 吗？

A: 支持，但目前为实验版本。正式发布的是 Windows 版；macOS / Linux 可通过 GitHub Actions 自行构建（见上方「安装」）。这些实验版未做代码签名。

## 许可

MIT
