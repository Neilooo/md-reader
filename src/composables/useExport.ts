import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import hljsLight from "highlight.js/styles/github.css?raw";
import hljsDark from "highlight.js/styles/github-dark.css?raw";
import katexCss from "katex/dist/katex.min.css?raw";
import { EXPORT_BASE_CSS } from "./exportStyles";
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

function pickTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export interface BuildExportOpts {
  forceLight?: boolean;
}

export async function buildExportHtml(
  body: HTMLElement,
  title: string,
  opts: BuildExportOpts = {}
): Promise<string> {
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".find-highlight").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  clone.querySelectorAll(".header-anchor").forEach((el) => el.remove());

  await inlineImages(clone);
  ensureSvgNamespace(clone);

  const theme = opts.forceLight ? "light" : pickTheme();
  const hljs = theme === "dark" ? hljsDark : hljsLight;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
${katexCss}
${hljs}
${EXPORT_BASE_CSS}
</style>
</head>
<body>
<article class="markdown-body">
${clone.innerHTML}
</article>
</body>
</html>`;
}

export async function exportToHtml(
  body: HTMLElement,
  baseName: string
): Promise<string | null> {
  const dest = await save({
    title: t("export.dialogHtml"),
    defaultPath: baseName.replace(/\.[^.]+$/, "") + ".html",
    filters: [{ name: "HTML", extensions: ["html", "htm"] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, baseName);
  await writeTextFile(dest, html);
  return dest;
}

export interface PandocInfo {
  available: boolean;
  version: string;
  has_xelatex: boolean;
}

export async function checkPandoc(): Promise<PandocInfo> {
  return await invoke<PandocInfo>("check_pandoc");
}

const PANDOC_REF_DOC_KEY = "md-reader-pandoc-reference-doc";

export function getCachedPandocRefDoc(): string | null {
  return localStorage.getItem(PANDOC_REF_DOC_KEY);
}

export function setCachedPandocRefDoc(p: string | null) {
  if (p) localStorage.setItem(PANDOC_REF_DOC_KEY, p);
  else localStorage.removeItem(PANDOC_REF_DOC_KEY);
}

async function pandocExport(
  body: HTMLElement,
  baseName: string,
  title: string,
  ext: "docx",
  prettyName: string
): Promise<string | null> {
  const dest = await save({
    title: t("export.dialogDocx"),
    defaultPath: baseName.replace(/\.[^.]+$/, "") + "." + ext,
    filters: [{ name: prettyName, extensions: [ext] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, title, { forceLight: true });
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
  title: string
) {
  return pandocExport(body, baseName, title, "docx", t("export.wordDocument"));
}

export interface PdfExportResult {
  out_path: string;
  elapsed_ms: number;
  edge_path: string;
}

export interface PdfExportErrorPayload {
  kind: "NoEdge" | "EdgeFailed" | "IoError";
  message: string;
}

const EDGE_PATH_KEY = "md-reader-edge-path";

export function getCachedEdgePath(): string | null {
  return localStorage.getItem(EDGE_PATH_KEY);
}

export function setCachedEdgePath(p: string | null) {
  if (p) localStorage.setItem(EDGE_PATH_KEY, p);
  else localStorage.removeItem(EDGE_PATH_KEY);
}

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

async function callEdge(
  html: string,
  outPath: string,
  edgePath?: string | null
): Promise<PdfExportResult> {
  return await invoke<PdfExportResult>("export_pdf_via_edge", {
    opts: { html, outPath, edgePath: edgePath ?? undefined },
  });
}

export async function exportToPdf(
  body: HTMLElement,
  baseName: string,
  title: string,
  onPickEdge: () => Promise<string | null>
): Promise<PdfExportResult | null> {
  const dest = await save({
    title: t("export.dialogPdf"),
    defaultPath: baseName.replace(/\.[^.]+$/, "") + ".pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!dest) return null;
  const html = await buildExportHtml(body, title, { forceLight: true });
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

export function printDocument(body: HTMLElement, title: string) {
  buildExportHtml(body, title, { forceLight: true })
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
