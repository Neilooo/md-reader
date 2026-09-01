# 标签页右键菜单增强 + PDF 导出样式系统

## 背景与动机
本 PR 解决两个用户反馈的问题，并顺带做了若干增强：
- **Issue 1**：标签页右键菜单只有「打开文件所在文件夹」，缺少关闭 / 刷新 / 关闭其他 / 关闭全部等常用操作。
- **Issue 2**：PDF 导出无法自定义字体与颜色。参考 md-to.com 的样式能力，新增独立设置页、24 套预设模板、紧凑 / 宽松间距与导出前实时预览。

## 一、标签页右键菜单增强
`TabBar.vue` 新增右键菜单项：
- 关闭 / 关闭其他（仅剩 1 个标签时禁用）/ 关闭全部（无标签时禁用）/ 刷新
- 复制路径（写入剪贴板，带成功 / 失败提示）
- 打开文件所在文件夹
`App.vue` 接入对应事件处理，新增 `copyPath()`（`navigator.clipboard` + `execCommand` 兜底）。

## 二、PDF 导出样式系统
### 独立设置标签页
设置对话框新增「PDF 导出」独立标签页（`settingsTab` 切换），与阅读设置分离，更清晰。

### 24 套预设模板
分为三组：
- **文档（doc）**：默认 / 极简 / 学术 / 护眼 / 商务蓝 / 经典棕 / GitHub
- **开发（dev）**：暗色 / 终端绿 / Dracula / VS Code 蓝 / Nord / Solarized 亮 / Solarized 暗 / Gruvbox 亮 / Gruvbox 暗 / Monokai / Catppuccin / One Dark
- **创意（creative）**：樱花粉 / 薰衣草 / 海洋青 / 日落橙 / 森林绿

### 间距变体（紧凑 / 标准 / 宽松）
对应 md-to.com 的 Compact / Standard / Loose。通过 `PdfDensity` + `PDF_DENSITY_SPACING`（lineHeight / blockGap）驱动，导出的 HTML 用 `calc(var(--pdf-block-gap,1em)*N)` 实现段落间距。

### 分组下拉
模板下拉按「文档 / 开发 / 创意」用 `<optgroup>` 分组，便于浏览。

### 实时预览
新增 `usePdfPreview.ts`，复用真实导出管线（`renderMarkdown` + `buildExportHtml`）在隔离 `<iframe :srcdoc>` 中渲染：
- 可编辑示例文本（textarea），输入即更新（150ms 防抖）。
- 明暗对比预览开关：同一套字体 / 排版，强制 GitHub 中性明暗配色并排显示。

### 字体 / 颜色 / 页面自定义
正文 / 标题 / 代码字体、正文字号、行高、正文色 / 标题色 / 链接色 / 代码背景 / 页面背景、页边距、页面尺寸（A4 / Letter）、方向（纵向 / 横向）均可调；通过 `--pdf-*` CSS 变量注入导出 HTML。

## 三、其他改进
- 设置页「恢复默认」修正了之前误嵌套在快捷键栅格中的 bug。
- Rust 侧 `pdf_export.rs` 移除 `cmd.arg("--no-margins")`，使注入的 `@page { margin }` 生效（需重新 `tauri build` 才能生效）。

## 四、国际化
`zh-CN.ts` / `en-US.ts` 新增：标签菜单（复制路径等）、PDF 样式（间距 / 紧凑 / 标准 / 宽松 / 预览 / 示例文本 / 对比 / 明 / 暗 / 分组标题）及 8 套开发模板名称，中英文一一对应。

## 五、文件清单
- src/components/TabBar.vue
- src/components/SettingsDialog.vue
- src/App.vue
- src/composables/usePdfStyle.ts
- src/composables/useExport.ts
- src/composables/exportStyles.ts
- src/composables/usePdfPreview.ts（新增）
- src-tauri/src/pdf_export.rs
- src/i18n/zh-CN.ts
- src/i18n/en-US.ts

## 六、验证
- `eslint .` 无错误
- `vue-tsc --noEmit` 类型通过
- `vite build` 构建通过

## 七、注意事项
- `pdf_export.rs` 的改动属于 Rust 侧，需重新编译（`tauri build` / `tauri dev`）后导出 PDF 才会应用新的页边距逻辑。
- 关于「双击关联 .md 文件时把最小化窗口置前」的需求，本 PR 暂未包含（需在 Rust 单实例 / DeepLink 处理中调用窗口 focus / unminimize），如需可另开 PR。
