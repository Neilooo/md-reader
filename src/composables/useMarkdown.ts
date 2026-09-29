/**
 * Markdown 渲染核心管线（模块级单例 markdown-it 实例）：
 *
 * - renderMarkdown: 源文本 → 净化后的 HTML（front matter 表格 + 正文）
 * - extractHeadings: 抽取标题树（目录面板用，渲染前就能拿到）
 * - renderMath / renderMermaid: 渲染后对 DOM 的后处理（KaTeX/Mermaid 均
 *   懒加载——动态 import，用不到就不进主包；改成静态导入会翻倍主包体积）
 *
 * 插件装配：anchor（标题锚点）、footnote、taskLists、emoji、mathPlugin
 * （自定义，见 mathPlugin.ts）。core ruler 给块级 token 打上
 * data-source-line，编辑↔预览的滚动同步全靠它。
 */

import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type Renderer from "markdown-it/lib/renderer.mjs";
import type { Options } from "markdown-it";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { parse as parseYaml } from "yaml";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { full as emoji } from "markdown-it-emoji";
import mathPlugin from "./mathPlugin";

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  // 代码块渲染：mermaid 语言留给 renderMermaid 后处理；其余走 hljs 高亮，
  // 不认识的语言退化为转义纯文本。
  highlight(str: string, lang: string): string {
    if (lang === "mermaid") {
      return `<div class="mermaid-block">${md.utils.escapeHtml(str)}</div>`;
    }
    if (lang && hljs.getLanguage(lang)) {
      try {
        return (
          '<pre class="hljs"><code>' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          "</code></pre>"
        );
      } catch {
        /* ignore */
      }
    }
    return (
      '<pre class="hljs"><code>' +
      md.utils.escapeHtml(str) +
      "</code></pre>"
    );
  },
});

// 标题锚点：slug 用 encodeURIComponent（中文标题也能生成合法 id）
md.use(anchor, {
  slugify: (s: string) =>
    encodeURIComponent(String(s).trim().toLowerCase().replace(/\s+/g, "-")),
  permalink: anchor.permalink.linkInsideHeader({
    symbol: "#",
    placement: "before",
    ariaHidden: true,
  }),
});
md.use(footnote);
md.use(taskLists, { enabled: true, label: true });
md.use(emoji);
md.use(mathPlugin);

// 给每个块级 token 记录源码行号（+1 转为 1-based；offset 来自 front matter
// 的行数，保证 front matter 之后的块行号对得上原文件）
md.core.ruler.push("source_line_attrs", (state) => {
  const offset = Number((state.env as { sourceLineOffset?: number }).sourceLineOffset || 0);
  for (const token of state.tokens) {
    if (token.nesting === 1 && token.map) {
      token.attrSet("data-source-line", String(token.map[0] + 1 + offset));
    }
  }
});

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (
    tokens: Token[],
    idx: number,
    options: Options,
    _env: unknown,
    self: Renderer
  ): string {
    return self.renderToken(tokens, idx, options);
  };

// 外链强制新标签页打开 + noopener；站内 .md 链接保持原样
// （useLinkRewriter 会拦截并转成 loadFile）
md.renderer.rules.link_open = function (
  tokens: Token[],
  idx: number,
  options: Options,
  env: unknown,
  self: Renderer
): string {
  const token = tokens[idx];
  const hrefIdx = token.attrIndex("href");
  const href = hrefIdx >= 0 ? token.attrs![hrefIdx][1] : "";
  if (/^https?:\/\//i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noopener noreferrer");
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/** YAML front matter 解析结果（raw 原文 / body 去掉头部的正文 / 起始行号）。 */
interface FrontMatterBlock {
  raw: string;
  body: string;
  bodyStartLine: number;
  data: unknown;
  error: string;
}

/**
 * 拆分 YAML front matter：首行必须是 ---（容忍 BOM），到下一个 --- 为止。
 * 无 front matter 返回 null。YAML 解析失败不致命——记下 error 原样展示。
 */
function splitFrontMatter(source: string): FrontMatterBlock | null {
  const normalized = source.startsWith("\ufeff") ? source.slice(1) : source;
  const lines = normalized.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== "---") continue;
    const raw = lines.slice(1, i).join("\n");
    let data: unknown = null;
    let error = "";
    try {
      data = raw.trim() ? parseYaml(raw) : null;
    } catch (e: any) {
      error = String(e?.message ?? e);
    }
    return {
      raw,
      body: lines.slice(i + 1).join("\n"),
      bodyStartLine: i + 2,
      data,
      error,
    };
  }
  return null;
}

function escapeHtml(s: string): string {
  return md.utils.escapeHtml(s);
}

/** front matter 值 → 展示 HTML：数组渲染成列表，对象 JSON 序列化，标量转义。 */
function formatFrontMatterValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `<ul>${value.map((item) => `<li>${formatFrontMatterValue(item)}</li>`).join("")}</ul>`;
  }
  if (typeof value === "object") {
    return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }
  return escapeHtml(String(value));
}

/** front matter 渲染成键值表格（解析失败时展示 Error + 原文）。 */
function renderFrontMatter(block: FrontMatterBlock): string {
  const rows: string[] = [];
  if (block.error) {
    rows.push(
      `<tr><th>Error</th><td class="front-matter-error">${escapeHtml(block.error)}</td></tr>`
    );
    rows.push(`<tr><th>Raw</th><td><pre>${escapeHtml(block.raw)}</pre></td></tr>`);
  } else if (block.data && typeof block.data === "object" && !Array.isArray(block.data)) {
    for (const [key, value] of Object.entries(block.data as Record<string, unknown>)) {
      rows.push(`<tr><th>${escapeHtml(key)}</th><td>${formatFrontMatterValue(value)}</td></tr>`);
    }
  } else if (block.data != null) {
    rows.push(`<tr><th>Value</th><td>${formatFrontMatterValue(block.data)}</td></tr>`);
  } else {
    rows.push(`<tr><th>Raw</th><td><pre>${escapeHtml(block.raw)}</pre></td></tr>`);
  }
  return `<section class="front-matter" data-source-line="1"><div class="front-matter-title">YAML Front Matter</div><table><tbody>${rows.join("")}</tbody></table></section>`;
}

/** 抽取标题树（目录面板数据源）。锚点 id 复用 anchor 插件的 slug 规则。 */
export function extractHeadings(source: string): Heading[] {
  const block = splitFrontMatter(source);
  const body = block ? block.body : source;
  const env = { sourceLineOffset: block ? block.bodyStartLine - 1 : 0 };
  const tokens = md.parse(body, env);
  const headings: Heading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "heading_open") {
      const idAttr = t.attrGet("id") || "";
      const level = parseInt(t.tag.slice(1), 10);
      const next = tokens[i + 1];
      const text = next && next.type === "inline" ? next.content : "";
      headings.push({ level, text, id: idAttr });
    }
  }
  return headings;
}

// DOMPurify 默认 URI 白名单不认 D:/... / D:\... 这类盘符绝对路径，会把
// href/src 整个剥掉（#36：盘符绝对链接点击无反应、绝对路径图片不显示）。
// 在其默认正则上仅插入「盘符+冒号+斜杠」分支（[a-z]:[\\/]），其余逐字符
// 保持同形——相对链接/锚点仍走原有分支放行，javascript: 等仍被拦截。
// 字符类里的 \- 不能去掉：写成 - 会把 .-: 解析成 ASCII 区间（0x2E–0x3A），
// 连 / 一起排除，sub/b.md 这类相对链接就被误杀了。
const ALLOWED_URI =
  // eslint-disable-next-line no-useless-escape -- 同 DOMPurify 默认正则原形
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|matrix):|[a-z]:[\\/]|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i;

/**
 * 源文本 → HTML。front matter 单独渲染成表格，正文走 markdown-it，
 * 最后 DOMPurify 净化（白名单放行 target/data-math/data-source-line）。
 */
export function renderMarkdown(source: string): string {
  const block = splitFrontMatter(source);
  const body = block ? block.body : source;
  const offset = block ? block.bodyStartLine - 1 : 0;
  const rawFrontMatter = block ? renderFrontMatter(block) : "";
  const raw = rawFrontMatter + md.render(body, { sourceLineOffset: offset });
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "data-math", "data-source-line"],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

// KaTeX 懒加载（单次加载后复用同一 Promise）
let katexLoading: Promise<any> | null = null;
async function loadKatex() {
  if (!katexLoading) {
    katexLoading = (async () => {
      const mod = await import("katex");
      await import("katex/dist/katex.min.css");
      return (mod as any).default ?? mod;
    })();
  }
  return katexLoading;
}

// Mermaid 懒加载（同上）
let mermaidLoading: Promise<any> | null = null;
async function loadMermaid() {
  if (!mermaidLoading) {
    mermaidLoading = (async () => {
      const mod = await import("mermaid");
      return (mod as any).default ?? mod;
    })();
  }
  return mermaidLoading;
}

/** 按当前主题初始化 Mermaid（主题切换后需 force 重渲染）。 */
function configureMermaid(mermaid: any): void {
  const isDark = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? "dark" : "default",
    securityLevel: "strict",
    flowchart: { htmlLabels: false },
    class: { htmlLabels: false },
  });
}

/** KaTeX 后处理：把 .math-inline/.math-block 占位元素渲染成公式。 */
export async function renderMath(container: HTMLElement): Promise<void> {
  const inline = container.querySelectorAll<HTMLElement>(".math-inline");
  const block = container.querySelectorAll<HTMLElement>(".math-block");
  if (inline.length === 0 && block.length === 0) return;
  const katex = await loadKatex();
  inline.forEach((el) => {
    const expr = el.dataset.math ?? "";
    try {
      katex.render(expr, el, { throwOnError: false, displayMode: false });
    } catch {
      el.textContent = expr;
    }
  });
  block.forEach((el) => {
    const expr = el.dataset.math ?? "";
    try {
      katex.render(expr, el, { throwOnError: false, displayMode: true });
    } catch {
      el.textContent = expr;
    }
  });
}

// Mermaid 的标签内容按 HTML 规则序列化（foreignObject 里的 <br> 不闭合、&nbsp; 实体），
// 不是合法 XML，直接按 image/svg+xml 解析会失败；先归一化为 XML 兼容形式。
function toXmlSafeSvg(svg: string): string {
  return svg.replace(/<br\s*\/?>/gi, "<br/>").replace(/&nbsp;/gi, "&#160;");
}

/**
 * Mermaid SVG 净化：剥离 script 与事件属性/javascript: 链接。
 * 解析策略：先按 XML 解析；Chromium 失败时根元素是 <html> 包着
 * <parsererror>（要全局查找），此时退回 HTML 解析再序列化成良构 XML。
 * 返回空串表示完全无法解析（调用方保持占位不变）。
 */
function sanitizeMermaidSvg(svg: string): string {
  const parser = new globalThis.DOMParser();
  const xml = parser.parseFromString(toXmlSafeSvg(svg), "image/svg+xml");
  let root: Element | null = xml.documentElement;
  // Chromium 解析失败时根元素是 <html> 包着 <parsererror>，必须全局查找而非只看根节点。
  if (!root || xml.querySelector("parsererror")) {
    // 仍失败则退回 HTML 解析（能容忍一切 HTML 写法），再经 XMLSerializer 产出良构 XML。
    const html = parser.parseFromString(svg, "text/html");
    root = html.querySelector("svg");
    if (!root) return "";
  }
  root.querySelectorAll("script").forEach((n) => n.remove());
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toStrip: { el: Element; name: string }[] = [];
  let current: Node | null = root;
  while (current) {
    const el = current as Element;
    if (el.attributes) {
      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (
          name.startsWith("on") ||
          ((name === "href" || name === "xlink:href") && value.startsWith("javascript:"))
        ) {
          toStrip.push({ el, name: attr.name });
        }
      }
    }
    current = walker.nextNode();
  }
  toStrip.forEach(({ el, name }) => el.removeAttribute(name));
  return new globalThis.XMLSerializer().serializeToString(root);
}

let mermaidIdCounter = 0;
/**
 * Mermaid 后处理：把 .mermaid-block 占位渲染成 SVG。
 * - 原始代码存 dataset.mermaidSrc，主题切换 force 重渲染时用（innerHTML
 *   已被 SVG 覆盖）
 * - 默认跳过已渲染的块（mermaid-rendered 类标记）；force=true 全部重来
 * - 渲染失败展示错误文本（不中断其他块）
 */
export async function renderMermaid(
  container: HTMLElement,
  force = false
): Promise<void> {
  let blocks = Array.from(
    container.querySelectorAll<HTMLElement>(".mermaid-block")
  );
  if (!force) {
    blocks = blocks.filter((el) => !el.classList.contains("mermaid-rendered"));
  }
  if (blocks.length === 0) return;
  const mermaid = await loadMermaid();
  configureMermaid(mermaid);
  for (const el of blocks) {
    let code: string;
    if (el.dataset.mermaidSrc != null) {
      code = el.dataset.mermaidSrc;
    } else {
      code = el.textContent ?? "";
      el.dataset.mermaidSrc = code;
    }
    const id = `mermaid-${Date.now()}-${mermaidIdCounter++}`;
    try {
      const { svg } = await mermaid.render(id, code);
      el.innerHTML = sanitizeMermaidSvg(svg);
      el.classList.add("mermaid-rendered");
    } catch (e: any) {
      const pre = document.createElement("pre");
      pre.className = "mermaid-error";
      pre.textContent = `Mermaid: ${String(e?.message ?? e)}`;
      el.replaceChildren(pre);
      el.classList.add("mermaid-rendered");
    }
  }
}

export function useMarkdown() {
  return { renderMarkdown, renderMath, renderMermaid, extractHeadings };
}
