/**
 * 渲染后 DOM 重写（在每次渲染完成后跑，必须保持幂等——同一棵 DOM
 * 重复跑不能产生双重包裹/双重监听）：
 * 1. 本地图片 src → convertFileSrc（走 asset 协议，受 capabilities 白名单约束）；
 * 2. 页内 #锚点 → 平滑滚动到目标标题；
 * 3. 指向 .md/.markdown/.mdx/.txt 的相对链接 → 拦截点击改为 loadFile；
 * 4. 表格套一层 .table-wrap 以支持横向滚动。
 */

import { convertFileSrc } from "@tauri-apps/api/core";

/** 取父目录（统一按 / 处理分隔符），无分隔符返回空串。 */
function dirname(path: string): string {
  const i = path.replace(/\\/g, "/").lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/**
 * base + rel 拼绝对路径：先按 / 切分，再压掉 "." / ".." 段。
 * 盘符（C:）开头的路径不保留前导 "/"。
 */
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
  } else if (baseNorm.startsWith("//")) {
    // UNC 根（\\wsl.localhost\... 经 dirname 归一为 //开头）必须补回两个
    // 前导斜杠——丢掉一个就变成无效路径，#36 的 WSL 相对链接读取失败
    joined = "//" + joined;
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

/** 带协议的链接（http/https/mailto/asset 等）不走本地重写。 */
function isExternal(url: string): boolean {
  return /^(https?:|data:|blob:|mailto:|tel:|asset:|tauri:)/i.test(url);
}

/** Decode URI escaping added by MarkdownIt before using a local URL as a file path. */
function resolveLocalPath(baseDir: string, urlPath: string): string {
  let path = urlPath;
  try {
    path = decodeURIComponent(urlPath);
  } catch {
    // Raw HTML may contain a stray "%". Keep it unchanged instead of breaking
    // every link rewrite in the rendered document.
  }
  return isAbsoluteWin(path) || isAbsoluteUnix(path)
    ? path
    : joinPath(baseDir, path);
}

export interface RewriteContext {
  /** 当前打开的 md 文件绝对路径，相对图片/链接以它的目录为基准。 */
  currentFile: string;
  rootDir: string;
}

/**
 * 重写入口：container 是刚渲染完的预览容器。
 * 注意幂等性依赖两点：wrapTables 有 .table-wrap 判断不重复包裹；
 * 链接监听是整体重渲染时随 DOM 销毁的（不会对同一 <a> 叠加）。
 */
export function rewriteImagesAndLinks(
  container: HTMLElement,
  ctx: RewriteContext,
  onInternalLink: (path: string, hash: string) => void
): void {
  wrapTables(container);
  if (!ctx.currentFile) return;
  const baseDir = dirname(ctx.currentFile);

  // 本地图片：相对路径基于当前文档目录解析，再转 asset 协议 URL
  container.querySelectorAll<HTMLImageElement>("img[src]").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (!src || isExternal(src)) return;
    try {
      const abs = resolveLocalPath(baseDir, src);
      img.src = convertFileSrc(abs);
    } catch {
      /* skip */
    }
  });

  container.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!href || isExternal(href)) return;
    // 纯锚点：页内滚动，注意 CSS.escape 防止标题里有 . / 数字开头等
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
    // 拆出 path#hash；只拦截 markdown/纯文本，其余文件类型交给系统默认行为
    const hashIdx = href.indexOf("#");
    const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
    const hash = hashIdx >= 0 ? href.slice(hashIdx + 1) : "";
    if (!pathPart) return;
    const abs = resolveLocalPath(baseDir, pathPart);
    if (!/\.(md|markdown|mdx|txt)$/i.test(abs)) return;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      onInternalLink(abs, hash);
    });
    a.classList.add("internal-link");
  });
}

/** 表格外包 .table-wrap（宽表横向滚动），已有包裹则跳过保证幂等。 */
function wrapTables(container: HTMLElement): void {
  container.querySelectorAll("table").forEach((table) => {
    if (table.parentElement?.classList.contains("table-wrap")) return;
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    table.parentNode?.insertBefore(wrap, table);
    wrap.appendChild(table);
  });
}
