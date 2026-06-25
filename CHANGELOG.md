# 更新日志

## [Unreleased]

### 优化
- 保持浅色主题原有 GitHub 风格配色，仅对暗色主题按高级阅读器方向优化。
- 暗色主题下使用深色顶部栏和文件树、暖灰大纲区、深色纸张式阅读区。
- 暗色主题下文件树当前项为金色左边线高亮，大纲当前项为青绿色左边线高亮。
- 暗色主题下优化 Markdown 正文标题、引用块和代码块排版，提升阅读层级和桌面阅读器质感。

## [0.1.1] - 2026-06-25

### 修复
- 修复 PDF 导出偶发 `Edge 执行完成但 PDF 未生成` 的问题：Edge headless 现在会最多重试 3 次，并为每次尝试使用独立临时 profile。
- 增强 PDF 导出的 Edge 稳定性参数，降低 Edge 首次启动、后台限速或 profile 初始化导致空输出的概率。
- PDF 导出失败时保留诊断 HTML，并返回每次尝试的 exit code / stdout / stderr，便于定位用户环境问题。
- 修复暗色主题下滚动条仍为白色的问题，滚动条现在跟随亮/暗主题切换为灰色/深色。
- 修复通过文件关联或命令行打开局域网共享（UNC）路径 Markdown 文件时，`\\?\UNC\...` 被错误裁剪为 `UNC\...`，导致读取失败的问题。
- 修复 UNC 路径转换为 `file://` URL 时的前缀处理，避免后续导出或资源路径处理踩同类问题。

### 工程
- 为 Windows 扩展路径前缀处理新增单元测试，覆盖本地盘路径、普通 UNC 路径和扩展 UNC 路径。

## [0.1.0] - 2026-06-24

首个公开版本，功能完整可用。

### 新增

#### 核心阅读
- Markdown 渲染（CommonMark + GFM）
- 代码语法高亮（highlight.js）
- 数学公式渲染（KaTeX 按需加载）
- 流程图 / 时序图（Mermaid 按需加载）
- 任务列表、脚注、Emoji、标题锚点
- 亮 / 暗主题切换

#### 导航
- 左侧文件树（递归扫描，过滤 .git/.node_modules）
- 右侧 TOC 大纲（滚动同步高亮）
- 三栏可拖拽分隔条，宽度持久化
- 内部链接 `[xxx](./y.md#z)` 跳转
- 图片相对路径自动解析（asset 协议）

#### 查找
- 当前文档查找（Ctrl+F，TreeWalker 遍历文本节点高亮）
- 跨文件全文搜索（Ctrl+Shift+F，Rust 后端）

#### 导出
- 导出 HTML（自包含单文件，图片/CSS 全内嵌）
- 导出 PDF（Edge headless，所见即所得，1-3 秒）
- 导出 DOCX（pandoc）
- 系统打印（Ctrl+P）

#### 系统集成
- 文件关联：`.md / .markdown / .mdx` 默认打开方式
- 单例运行：第二次打开会复用现有窗口
- 命令行参数：支持 `md-reader.exe <file>`
- 拖拽文件到窗口
- 文件变更监听自动刷新（notify-debouncer-mini，300ms 防抖）

#### 体验
- 阅读设置：字号 / 行高 / 页面宽度 / 字体
- 最近文件历史（localStorage，最多 20）
- 每文件独立的滚动位置记忆
- 启动恢复上次最后浏览的文件
- Edge 路径自动探测 + 手动指定持久化

### 工程
- TypeScript 严格模式
- ESLint flat config + Prettier
- Vite 代码分包（Mermaid/KaTeX/hljs 独立 chunk）
- 构建产物：md-reader.exe ~5.6 MB，MSI ~3.8 MB

### 已知限制
- DOCX 导出需要安装 pandoc
- PDF 导出依赖系统 Edge（Win10/11 自带）
- Mermaid 在 DOCX 中可能样式简化（pandoc 转换限制）
