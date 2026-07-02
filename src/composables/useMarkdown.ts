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

interface FrontMatterBlock {
  raw: string;
  body: string;
  bodyStartLine: number;
  data: unknown;
  error: string;
}

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

export function renderMarkdown(source: string): string {
  const block = splitFrontMatter(source);
  const body = block ? block.body : source;
  const offset = block ? block.bodyStartLine - 1 : 0;
  const rawFrontMatter = block ? renderFrontMatter(block) : "";
  const raw = rawFrontMatter + md.render(body, { sourceLineOffset: offset });
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ["target", "data-math", "data-source-line"],
  });
}

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

function sanitizeMermaidSvg(svg: string): string {
  const doc = new globalThis.DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName === "parsererror") return "";
  root.querySelectorAll("script").forEach((n) => n.remove());
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
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
