// PNG long-image export: renders the live reading-view DOM into a single tall
// PNG via modern-screenshot (SVG foreignObject). Lazy-loads the library to
// keep it out of the main chunk.
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { inlineImages } from "./exportInline";
import { buildDefaultPath } from "./useExport";
import { i18n } from "../i18n";

function t(key: string): string {
  return i18n.global.t(key);
}

// Chromium caps one canvas at ~65535 px per edge and ~268M total pixels.
const MAX_EDGE = 65535;
const MAX_AREA = 2.4e8;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const bin = globalThis.atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// WYSIWYG background: the first opaque ancestor background of the reader.
function resolveBackground(el: HTMLElement | null): string {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = globalThis.getComputedStyle(node).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    node = node.parentElement;
  }
  return "#ffffff";
}

// Stage width ceiling. At the adaptive 2x scale this yields a 12000px canvas
// edge, comfortably inside Chromium's 65535px limit while keeping pathological
// documents from producing absurd canvases.
const MAX_STAGE_WIDTH = 6000;

// Override the reading view's scroll containers for the screenshot (#37):
// code blocks wrap instead of clipping, wide tables/diagrams lay out fully now
// that the stage is widened to fit them.
const EXPORT_STYLE = `
.mdr-png-export pre { overflow: visible; white-space: pre-wrap; word-break: break-word; }
.mdr-png-export .table-wrap,
.mdr-png-export .math-block,
.mdr-png-export .mermaid-block { overflow: visible; }
`;

/**
 * Natural width the image needs so nothing clips: the reader width, or the
 * widest non-wrappable element (tables, math, mermaid) when it overflows.
 * `pre` is excluded — long code wraps inside the image instead of widening it.
 */
function measureNeededWidth(body: HTMLElement): number {
  let needed = body.clientWidth;
  const selector = ".table-wrap, .math-block, .mermaid-block";
  body.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    needed = Math.max(needed, el.scrollWidth);
  });
  return needed;
}

export async function exportToPng(
  body: HTMLElement,
  baseName: string,
  sourceFilePath?: string
): Promise<string | null> {
  const stem = baseName.replace(/\.[^.]+$/, "");
  const defaultPath = buildDefaultPath(sourceFilePath, stem + ".png");
  const dest = await save({
    title: t("export.dialogPng"),
    defaultPath,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (!dest) return null;

  const { domToPng } = await import("modern-screenshot");

  // Same cleanup as buildExportHtml: no find highlights, no anchor permalinks.
  const clone = body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".find-highlight").forEach((el) => {
    const parent = el.parentNode;
    if (!parent) return;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
  clone.querySelectorAll(".header-anchor").forEach((el) => el.remove());
  clone.classList.add("mdr-png-export");

  await inlineImages(clone);

  // Measure before cloning would have been ideal; scrollWidth is measured on
  // `body`'s live descendants so wide tables report their full extent, then
  // the clone inherits the widened stage.
  const width = Math.min(
    Math.max(measureNeededWidth(body), 320),
    MAX_STAGE_WIDTH
  );
  const background = resolveBackground(body);
  const stage = document.createElement("div");
  stage.setAttribute(
    "style",
    "position:fixed;left:-10000px;top:0;z-index:-1;"
  );
  stage.style.width = width + "px";
  stage.style.backgroundColor = background;
  const style = document.createElement("style");
  style.textContent = EXPORT_STYLE;
  stage.appendChild(style);
  stage.appendChild(clone);
  document.body.appendChild(stage);

  try {
    // Adaptive scale: 2x for sharpness on normal documents, dropping towards
    // 1x as the long image approaches the canvas limits.
    const height = stage.clientHeight;
    let scale = Math.min(
      2,
      MAX_EDGE / height,
      MAX_EDGE / width,
      Math.sqrt(MAX_AREA / (width * height))
    );
    if (scale < 1) throw new Error(t("export.pngTooLong"));
    scale = Math.floor(scale * 100) / 100;

    const dataUrl = await domToPng(clone, { scale, backgroundColor: background });
    await writeFile(dest, dataUrlToBytes(dataUrl));
    return dest;
  } finally {
    stage.remove();
  }
}
