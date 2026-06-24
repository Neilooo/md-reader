# MD Reader

[![Release](https://img.shields.io/github/v/release/Neilooo/md-reader?include_prereleases&color=blue)](https://github.com/Neilooo/md-reader/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Neilooo/md-reader/total)](https://github.com/Neilooo/md-reader/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)]()

一个轻量、快速、所见即所得的 Markdown 桌面阅读器，基于 Tauri 2 + Vue 3 构建。

体积小（约 5 MB），启动快，支持公式、图表、代码高亮、文件树、全文搜索、PDF/HTML/DOCX 导出。

📦 **[下载最新版本](https://github.com/Neilooo/md-reader/releases/latest)**

---

## 目录

- [主要特性](#主要特性)
- [快捷键](#快捷键)
- [安装](#安装)
- [使用前需要安装的外部工具](#使用前需要安装的外部工具)
- [开发](#开发)
- [技术栈](#技术栈)
- [PDF 导出原理](#pdf-导出原理)
- [常见问题](#常见问题)

---

## 主要特性

### 阅读
- CommonMark + GitHub Flavored Markdown
- 代码语法高亮（highlight.js，30+ 语言）
- 数学公式（KaTeX，按需加载）
- 流程图 / 时序图 / 思维导图（Mermaid，按需加载）
- 任务列表 / 脚注 / Emoji / 标题锚点
- 亮 / 暗主题切换，记忆主题偏好

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
- 系统打印对话框

### 体验
- 阅读设置：字号、行高、宽度、字体可调
- 文件变更监听，自动刷新
- 最近文件 + 滚动位置记忆
- 文件关联：`.md / .markdown / .mdx` 双击直接打开
- 单例运行：从资源管理器多次打开会复用窗口
- 拖拽文件到窗口直接打开

## 快捷键

| 键 | 动作 |
|---|---|
| `Ctrl+F` | 当前文档查找 |
| `Ctrl+Shift+F` | 全文搜索 |
| `Ctrl+,` | 阅读设置 |
| `Ctrl+S` | 导出 HTML |
| `Ctrl+P` | 系统打印 / 另存为 PDF |
| `Esc` | 关闭查找 / 设置 |

## 安装

### Windows

从 [Releases 页面](https://github.com/Neilooo/md-reader/releases/latest) 下载：

| 文件 | 说明 |
|---|---|
| `MD Reader_<version>_x64_en-US.msi` | **安装版**：双击安装，自动注册 `.md / .markdown / .mdx` 文件关联 |
| `md-reader.exe` | **绿色版**：解压即用，不写注册表 |

> Windows 10 / 11 自带 WebView2 Runtime，无需额外安装。
> 旧版 Windows 10（早期 build）可能需要从 [Microsoft 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 单独安装 WebView2 Runtime。

## 使用前需要安装的外部工具

**核心阅读功能完全不需要安装任何东西**。可选功能按需安装：

| 功能 | 依赖 | Win10/11 默认 | 安装方法 |
|---|---|:-:|---|
| 阅读 / 文件树 / 全文搜索 / 公式 / 图表 / HTML 导出 | 无 | — | 无需安装 |
| **PDF 导出**（所见即所得） | Microsoft Edge（Chromium） | ✅ 自带 | 通常已自带；如缺失从 [microsoft.com/edge](https://www.microsoft.com/edge) 下载 |
| **DOCX 导出** | [pandoc](https://pandoc.org/) ≥ 2.x | ❌ | 见下方 |
| 打印 | 系统打印 | ✅ 自带 | 无需安装 |

### 安装 pandoc（仅 DOCX 导出需要）

任选其一：

**方式 1：winget（推荐）**

```powershell
winget install --id JohnMacFarlane.Pandoc -e
```

**方式 2：Chocolatey**

```powershell
choco install pandoc
```

**方式 3：手动安装**

从 [pandoc.org/installing.html](https://pandoc.org/installing.html) 下载 Windows 安装包，双击安装。

安装完成后，需要 **重启 MD Reader** 才能让导出菜单识别到 pandoc。

> 如果你只需要 PDF / HTML 导出，**不需要** 安装 pandoc。

### 启动时自动检测

应用启动时会自动检测：
- Microsoft Edge 路径（用于 PDF 导出）
- pandoc 是否安装（用于 DOCX 导出）

检测结果会显示在导出菜单的提示文字中。如果 PDF 导出找不到 Edge，会弹文件选择对话框让你手动指定 `msedge.exe` 路径（路径自动记忆到 localStorage）。

## 开发

### 环境要求

| 工具 | 版本 | 安装 |
|---|---|---|
| **Node.js** | ≥ 18 | https://nodejs.org/ |
| **pnpm** | ≥ 8 | `npm install -g pnpm` |
| **Rust** | ≥ 1.77 | https://rustup.rs/ |
| **WebView2 Runtime** | — | Win10/11 自带 |
| **Visual Studio Build Tools** | 2019+ | 含 "Desktop development with C++" 工作负载，Rust 编译 native crates 需要 |

> 国内网络环境推荐用镜像加速：
> - Rust：`RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static`
> - Cargo：在 `~/.cargo/config.toml` 添加 USTC 源
> - pnpm：`pnpm config set registry https://registry.npmmirror.com`

### 命令

```bash
pnpm install              # 安装前端依赖
pnpm tauri dev            # 启动开发模式（热重载）
pnpm tauri build          # 构建生产版本（生成 .exe + .msi）
pnpm lint                 # ESLint 检查
pnpm format               # Prettier 格式化
```

### 目录结构
```
src/                          前端 Vue 3
├── components/               界面组件
├── composables/              逻辑模块
│   ├── useMarkdown.ts        markdown-it 配置
│   ├── useFileTree.ts        文件树
│   ├── useFindInPage.ts      文档查找
│   ├── useExport.ts          导出（HTML/DOCX/PDF）
│   └── ...
├── App.vue                   主界面
└── main.ts                   入口

src-tauri/src/                Rust 后端
├── lib.rs                    Tauri 命令注册
├── pdf_utils.rs              Edge 路径探测
└── pdf_export.rs             PDF 导出（Edge headless）
```

## 技术栈

- **桌面框架**: Tauri 2（Rust + WebView2）
- **前端**: Vue 3 + TypeScript + Vite
- **Markdown**: markdown-it + 多个插件
- **公式**: KaTeX
- **图表**: Mermaid
- **代码高亮**: highlight.js
- **PDF 导出**: 系统 Edge `--headless=new --print-to-pdf`
- **DOCX 导出**: pandoc
- **文件监听**: notify + notify-debouncer-mini
- **全文搜索**: walkdir + 流式逐行扫描
- **单例运行 / 文件关联**: tauri-plugin-single-instance

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

A: 应用会弹文件选择对话框让你指定 `msedge.exe` 路径。常见位置：

- `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
- `C:\Program Files\Microsoft\Edge\Application\msedge.exe`

指定一次后会自动记忆。也可以选择 Chrome（`chrome.exe`），同样工作。

### Q: 导出 DOCX 提示"未检测到 pandoc"？

A: 安装 pandoc（见 [使用前需要安装的外部工具](#使用前需要安装的外部工具)），然后重启 MD Reader。

### Q: 导出的 PDF / DOCX 里 Mermaid 或 KaTeX 显示不正常？

A:
- **PDF** 用的是 Edge 渲染，与阅读器完全一致；如出问题请提 [Issue](https://github.com/Neilooo/md-reader/issues)。
- **DOCX** 走 pandoc 转换，对复杂内联 SVG / HTML 的还原能力有限，这是 pandoc 本身的限制。如对 Mermaid 保真度要求高，建议导出 PDF 或 HTML。

### Q: 文件关联失效了？

A: MSI 安装版会自动注册 `.md / .markdown / .mdx` 关联。绿色版不会写注册表。如关联意外丢失：右键 `.md` 文件 → "打开方式" → "选择其他应用" → 浏览到 `md-reader.exe` → 勾选"始终使用此应用打开"。

### Q: 大文件打开很慢 / 卡顿？

A: 单文件超过几 MB 的 Markdown 不在当前优化目标内。后续版本可能加入虚拟滚动。

### Q: 支持 macOS / Linux 吗？

A: 代码本身基于 Tauri 跨平台框架，理论上可以构建。但首版只发布了 Windows 安装包，且 PDF 导出 / 文件关联做了 Windows 特化。如有需求请提 Issue。

## 许可

MIT
