/**
 * 导出编排（HTML / DOCX / PDF / 打印）的公共入口：
 * - buildExportHtml 把阅读区 DOM 克隆成自包含 HTML（内联图片 + KaTeX/hljs
 *   样式 + PDF 样式变量），是 HTML/DOCX/PDF/打印四条链路的共同基座
 * - HTML：直接写盘；DOCX：交给后端 pandoc；PDF：交给后端 Edge headless
 * - 用户选择的外部依赖路径（pandoc 参考模板 / Edge 路径）缓存在
 *   localStorage，跨会话生效
 * 注意保持本文件精简（编辑器字符串限制），大块样式在 exportStyles.ts。
 */

import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import hljsLight from "highlight.js/styles/github.css?raw";
import hljsDark from "highlight.js/styles/github-dark.css?raw";
import katexCss from "katex/dist/katex.min.css?raw";
import { EXPORT_BASE_CSS } from "./exportStyles";
import {
  usePdfStyle,
  pdfStyleToCss,
  isLightColor,
  getDefaultPdfStyle,
  type PdfStyleOptions,
} from "./usePdfStyle";
import { inlineImages, ensureSvgNamespace } from "./exportInline";
import { i18n } from "../i18n";

function t(key: string): string {
  return i18n.global.t(key);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 保存对话框的默认路径：源文件同目录 + 同名换扩展（无源文件则仅文件名）。 */
export function buildDefaultPath(
  sourceFilePath: string | undefined,
  defaultFileName: string
): string {
  if (sourceFilePath) {
    const lastSep = Math.max(sourceFilePath.lastIndexOf("/"), sourceFilePath.lastIndexOf("\\"));
    if (lastSep >= 0) {
      const dir = sourceFilePath.substring(0, lastSep + 1);
      return dir + defaultFileName;
    }
  }
  return defaultFileName;
}

export interface BuildExportOpts {
  /** 强制亮色（DOCX 场景：Word 里有自己的深色，页面背景按亮色算）。 */
  forceLight?: boolean;
  /** PDF 样式（默认取当前用户设置）。 */
  pdfStyle?: PdfStyleOptions;
}

/**
 * 把渲染好的阅读区 DOM 打包成自包含 HTML：
 * 1. 克隆并清理：拆掉查找高亮（还原纯文本）、删除锚点链接
 * 2. 图片内联成 dataURL（脱离源目录也能显示）、SVG 补命名空间
 * 3. 拼装 KaTeX/hljs/基础样式 + PDF 样式变量；代码高亮主题按页面
 *    背景明暗自动选择
 */
export async function buildExportHtml(
  body: HTMLElement,
  title: string,
  opts: BuildExportOpts = {}
): Promise<string> {
  const clone = body.cloneNode(true) as HTMLElement;
  // find-highlight 是包裹 span，要把内容还原回去而不是整段删掉
  clone.querySelectorAll(".find-highlight").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  clone.querySelectorAll(".header-anchor").forEach((el) => el.remove());
  // 导出物保持原貌：去掉注入的复制按钮与语言标签头。
  clone.querySelectorAll(".code-block-header").forEach((el) => el.remove());

  await inlineImages(clone);
  ensureSvgNamespace(clone);

  const pdfStyle = opts.pdfStyle ?? getDefaultPdfStyle();
  // Pick the code-highlight theme based on the chosen page background.
  const dark =
    opts.forceLight
      ? false
      : !isLightColor(pdfStyle.bgColor);
  const hljs = dark ? hljsDark : hljsLight;
  const styleVars = pdfStyleToCss(pdfStyle);

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
${katexCss}
${hljs}
${EXPORT_BASE_CSS}
${styleVars}
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>`;
}

/** 导出单文件 HTML（含用户当前的 PDF 样式设置）。 */
export async function exportToHtml(
  body: HTMLElement,
  baseName: string,
  sourceFilePath?: string
): Promise<string | null> {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const defaultPath = buildDefaultPath(sourceFilePath, stem + ".html");
  const dest = await save({
    title: t("export.dialogHtml"),
    defaultPath,
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, baseName, {
    pdfStyle: usePdfStyle().settings.value,
  });
  await writeTextFile(dest, html);
  return dest;
}

/** pandoc 环境探测结果（后端 check_pandoc 命令的返回类型）。 */
export interface PandocInfo {
  available: boolean;
  version: string;
  has_xelatex: boolean;
}

export async function checkPandoc(): Promise<PandocInfo> {
  return await invoke<PandocInfo>("check_pandoc");
}

// pandoc DOCX 参考模板缓存（设置页选择，导出时自动附加）
const PANDOC_REF_DOC_KEY = "md-reader-pandoc-reference-doc";

export function getCachedPandocRefDoc(): string | null {
  return localStorage.getItem(PANDOC_REF_DOC_KEY);
}

export function setCachedPandocRefDoc(p: string | null) {
  if (p) localStorage.setItem(PANDOC_REF_DOC_KEY, p);
  else localStorage.removeItem(PANDOC_REF_DOC_KEY);
}

/** pandoc 导出（当前仅 DOCX）：固定亮色样式 + 可选参考模板，交后端执行。 */
async function pandocExport(
  body: HTMLElement,
  baseName: string,
  title: string,
  ext: "docx",
  prettyName: string,
  sourceFilePath?: string
): Promise<string | null> {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const defaultPath = buildDefaultPath(sourceFilePath, stem + "." + ext);
  const dest = await save({
    title: t("export.dialogDocx"),
    defaultPath,
    filters: [{ name: prettyName, extensions: [ext] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, title, {
    forceLight: true,
    pdfStyle: getDefaultPdfStyle(),
  });
  return await invoke<string>("export_with_pandoc", {
    opts: {
      html,
      outPath: dest,
      format: ext,
      title,
      referenceDoc: ext === "docx" ? getCachedPandocRefDoc() ?? undefined : undefined,
    },
  });
}

export function exportToDocx(
  body: HTMLElement,
  baseName: string,
  title: string,
  sourceFilePath?: string
) {
  return pandocExport(body, baseName, title, "docx", t("export.wordDocument"), sourceFilePath);
}

/** 后端 export_pdf_via_edge 的返回（snake_case 与 Rust 侧序列化一致）。 */
export interface PdfExportResult {
  out_path: string;
  elapsed_ms: number;
  edge_path: string;
}

/** 后端 PdfExportError 的序列化形态（tag=kind, content=message）。 */
export interface PdfExportErrorPayload {
  kind: "NoEdge" | "EdgeFailed" | "IoError";
  message: string;
}

// 用户手动选择的 Edge 路径缓存（自动探测失败时的回退）
const EDGE_PATH_KEY = "md-reader-edge-path";

export function getCachedEdgePath(): string | null {
  return localStorage.getItem(EDGE_PATH_KEY);
}

export function setCachedEdgePath(p: string | null) {
  if (p) localStorage.setItem(EDGE_PATH_KEY, p);
  else localStorage.removeItem(EDGE_PATH_KEY);
}

/** 探测 PDF 引擎：缓存的自定义路径优先，找不到返回 null。 */
export async function checkPdfEngine(): Promise<string | null> {
  const custom = getCachedEdgePath();
  try {
    const r = await invoke<string | null>("check_pdf_engine", {
      customEdge: custom,
    });
    return r;
  } catch {
    return null;
  }
}

/** 调用后端 Edge headless 导出（单次，不含回退逻辑）。 */
async function callEdge(
  html: string,
  outPath: string,
  edgePath?: string | null
): Promise<PdfExportResult> {
  return await invoke<PdfExportResult>("export_pdf_via_edge", {
    opts: { html, outPath, edgePath: edgePath ?? undefined },
  });
}

/**
 * 导出 PDF：先尝试自动探测 + 缓存路径；后端报 NoEdge（找不到 Edge）时
 * 调 onPickEdge 弹选择框让用户手动指定，选中后缓存并重试一次。
 * 不要破坏这个回退链——它是无 Edge 机器上的唯一出路。
 */
export async function exportToPdf(
  body: HTMLElement,
  baseName: string,
  title: string,
  sourceFilePath: string | undefined,
  onPickEdge: () => Promise<string | null>
): Promise<PdfExportResult | null> {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const defaultPath = buildDefaultPath(sourceFilePath, stem + ".pdf");
  const dest = await save({
    title: t("export.dialogPdf"),
    defaultPath,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, title, {
    pdfStyle: usePdfStyle().settings.value,
  });
  const cached = getCachedEdgePath();
  try {
    return await callEdge(html, dest, cached);
  } catch (err: any) {
    const payload = err as PdfExportErrorPayload | undefined;
    if (payload && payload.kind === "NoEdge") {
      const picked = await onPickEdge();
      if (!picked) return null;
      setCachedEdgePath(picked);
      return await callEdge(html, dest, picked);
    }
    throw err;
  }
}

/**
 * 打印：导出 HTML 塞进隐藏 iframe 加载后调 print()。
 * afterprint 或 120s 超时后清理 blob URL 与 iframe，防止泄漏。
 */
export function printDocument(body: HTMLElement, title: string) {
  buildExportHtml(body, title, { pdfStyle: usePdfStyle().settings.value })
    .then((html) => {
      const blob = new globalThis.Blob([html], { type: "text/html" });
      const url = globalThis.URL.createObjectURL(blob);
      const iframe = document.createElement("iframe");
      iframe.setAttribute(
        "style",
        "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;",
      );
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        globalThis.URL.revokeObjectURL(url);
        iframe.remove();
      };
      iframe.addEventListener("load", () => {
        const cw = iframe.contentWindow;
        if (!cw) {
          cleanup();
          return;
        }
        cw.addEventListener("afterprint", cleanup, { once: true });
        window.setTimeout(cleanup, 120000);
        cw.focus();
        cw.print();
      });
      iframe.src = url;
      document.body.appendChild(iframe);
    })
    .catch((e) => console.error("print failed", e));
}
