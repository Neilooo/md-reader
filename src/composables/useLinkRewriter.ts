import { convertFileSrc } from "@tauri-apps/api/core";

function dirname(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function joinPath(base: string, rel: string): string {
  const baseNorm = base.replace(/\\/g, "/").replace(/\/+$/, "");
  const relNorm = rel.replace(/\\/g, "/");
  if (relNorm.startsWith("/")) return relNorm;
  const parts = (baseNorm + "/" + relNorm).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  let joined = out.join("/");
  if (/^[A-Za-z]:$/.test(out[0] || "")) {
    joined = out[0] + "/" + out.slice(1).join("/");
  } else if (baseNorm.startsWith("/")) {
    joined = "/" + joined;
  }
  return joined;
}

function isAbsoluteWin(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p);
}

function isAbsoluteUnix(p: string): boolean {
  return p.startsWith("/");
}

function isExternal(url: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:|asset:|tauri:)/i.test(url);
}

export interface RewriteContext {
  currentFile: string;
  rootDir: string;
}

export function rewriteImagesAndLinks(
  container: HTMLElement,
  ctx: RewriteContext,
  onInternalLink: (path: string, hash: string) => void
): void {
  wrapTables(container);
  if (!ctx.currentFile) return;
  const baseDir = dirname(ctx.currentFile);

  container.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || isExternal(src)) return;
    try {
      const abs =
        isAbsoluteWin(src) || isAbsoluteUnix(src) ? src : joinPath(baseDir, src);
      img.src = convertFileSrc(abs);
    } catch {
      /* skip */
    }
  });

  container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href || isExternal(href)) return;
    if (href.startsWith("#")) {
      a.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          const id = href.slice(1);
          if (!id) return;
          const target = container.querySelector<HTMLElement>(
            `#${CSS.escape(id)}`
          );
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
        { once: false }
      );
      return;
    }
    const hashIdx = href.indexOf("#");
    const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : "";
    if (!pathPart) return;
    if (!/\.(md|markdown|mdx|txt)$/i.test(pathPart)) return;
    const abs =
      isAbsoluteWin(pathPart) || isAbsoluteUnix(pathPart)
        ? pathPart
        : joinPath(baseDir, pathPart);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onInternalLink(abs, hash);
    });
    a.classList.add("internal-link");
  });
}

function wrapTables(container: HTMLElement): void {
  container.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}
