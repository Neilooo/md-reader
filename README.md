# MD Reader

**English** | [简体中文](README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Neilooo/md-reader?include_prereleases&color=blue)](https://github.com/Neilooo/md-reader/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Downloads](https://img.shields.io/github/downloads/Neilooo/md-reader/total)](https://github.com/Neilooo/md-reader/releases)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)]()

A lightweight, fast, WYSIWYG **Markdown viewer / reader / preview** for Windows. Built with **Tauri 2 + Vue 3 + Rust**.

Small footprint (~5 MB), fast startup, full Markdown rendering, KaTeX math, Mermaid diagrams, syntax highlighting, file tree, full-text search, and high-fidelity PDF/HTML/DOCX export.

📦 **[Download the latest release](https://github.com/Neilooo/md-reader/releases/latest)**

---

## Features

### Reading
- CommonMark + GitHub Flavored Markdown
- Syntax highlighting with highlight.js
- Math formulas with KaTeX
- Diagrams with Mermaid
- Task lists, footnotes, emoji, heading anchors
- Light / dark theme
- Chinese / English UI switch

### Navigation
- File tree for Markdown folders
- Outline / TOC with scroll sync
- Resizable three-column layout
- Internal Markdown links: `[text](./other.md#heading)`
- Relative image path rewriting

### Search
- `Ctrl+F` find in current document
- `Ctrl+Shift+F` full-text search across files (Rust backend)

### Export
- **PDF**: Edge headless, 1-3 seconds, WYSIWYG, no LaTeX required
- **HTML**: self-contained single file with images/CSS embedded
- **DOCX**: powered by pandoc

### Desktop integration
- File association for `.md / .markdown / .mdx`
- Single-instance behavior: opening another file reuses the existing window
- Drag and drop files into the window
- Recent files and per-file scroll position restore

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+F` | Find in current document |
| `Ctrl+Shift+F` | Full-text search |
| `Ctrl+,` | Reading settings |
| `Ctrl+S` | Export HTML |
| `Ctrl+P` | System print / Save as PDF |
| `Esc` | Close find/settings |

---

## Installation

### Windows

Download from the [Releases page](https://github.com/Neilooo/md-reader/releases/latest):

| File | Description |
|---|---|
| `MD-Reader-*-windows-x64-setup.msi` | Installer with file association support |
| `MD-Reader-*-windows-x64-portable.exe` | Portable executable, no registry changes |

> Windows 10 / 11 usually includes WebView2 Runtime. Older Windows 10 builds may need the [Microsoft WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

---

## External Dependencies

Core reading features require **no external tools**. Optional features need the tools below:

| Feature | Dependency | Included on Windows 10/11 | Notes |
|---|---|:-:|---|
| Reading / file tree / search / math / diagrams / HTML export | None | — | Works out of the box |
| **PDF export** | Microsoft Edge / Chrome | ✅ Edge usually included | Used for WYSIWYG PDF export |
| **DOCX export** | [pandoc](https://pandoc.org/) ≥ 2.x | ❌ | Install only if you need DOCX |
| Print | System print dialog | ✅ | Optional fallback |

### Install pandoc (DOCX export only)

```powershell
winget install --id JohnMacFarlane.Pandoc -e
```

Or download it from [pandoc.org/installing.html](https://pandoc.org/installing.html). Restart MD Reader after installing pandoc.

> PDF / HTML export does **not** require pandoc.

---

## Development

### Requirements

| Tool | Version | Install |
|---|---|---|
| Node.js | ≥ 18 | https://nodejs.org/ |
| pnpm | ≥ 8 | `npm install -g pnpm` |
| Rust | ≥ 1.77 | https://rustup.rs/ |
| WebView2 Runtime | — | Usually included on Windows 10/11 |
| Visual Studio Build Tools | 2019+ | `Desktop development with C++` workload |

### Commands

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
pnpm lint
pnpm format
```

---

## Tech Stack

- **Desktop**: Tauri 2 (Rust + WebView2)
- **Frontend**: Vue 3 + TypeScript + Vite
- **Markdown**: markdown-it plugins
- **Math**: KaTeX
- **Diagrams**: Mermaid
- **Highlighting**: highlight.js
- **PDF export**: system Edge `--headless=new --print-to-pdf`
- **DOCX export**: pandoc
- **File watching**: notify + notify-debouncer-mini
- **Full-text search**: walkdir + line scanning
- **File association / single instance**: tauri-plugin-single-instance
- **i18n**: vue-i18n

---

## How PDF Export Works

MD Reader does not use LaTeX for PDF export.

1. The frontend clones the already-rendered DOM (KaTeX and Mermaid are already rendered)
2. Images are embedded as base64 and CSS is inlined
3. Rust writes a temporary HTML file under `%TEMP%`
4. System Edge runs in headless mode: `--headless=new --print-to-pdf=...`
5. The generated PDF is copied to the user-selected output path

Result: fast, high-fidelity, WYSIWYG PDF export in 1-3 seconds.

---

## FAQ

### WebView2 is missing

Install the WebView2 Evergreen Runtime from Microsoft: https://developer.microsoft.com/microsoft-edge/webview2/

### PDF export cannot find Edge

MD Reader will ask you to choose `msedge.exe`. Chrome also works if Edge is unavailable.

### DOCX export says pandoc is missing

Install pandoc and restart MD Reader.

### Does it support macOS / Linux?

The codebase is based on Tauri and should be portable, but the official release currently targets Windows.

---

## License

MIT
