import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

const ALERT_TYPES = new Set([
  "NOTE",
  "TIP",
  "IMPORTANT",
  "WARNING",
  "CAUTION",
]);

type AlertInfo = { type: string; title: string };

function parseAlertMarker(content: string): AlertInfo | null {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const match = /^\s*\[!([A-Za-z]+)\]([^\r\n]*)$/.exec(firstLine);
  if (!match) return null;

  const type = match[1].toUpperCase();
  if (!ALERT_TYPES.has(type)) return null;

  return { type, title: match[2].trim() || type };
}

function firstLineChildCount(children: Token[] | null | undefined): number {
  if (!children) return 0;
  for (let i = 0; i < children.length; i++) {
    if (children[i].type === "softbreak" || children[i].type === "hardbreak") {
      return i + 1;
    }
  }
  return children.length;
}

function findBlockquoteClose(tokens: Token[], start: number): number {
  let depth = 0;
  for (let i = start; i < tokens.length; i++) {
    if (tokens[i].type === "blockquote_open") depth++;
    if (tokens[i].type === "blockquote_close") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export default function githubAlertsPlugin(md: MarkdownIt): void {
  md.core.ruler.before("source_line_attrs", "github_alerts", (state) => {
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length - 2; i++) {
      if (tokens[i].type !== "blockquote_open") continue;

      const paragraphOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      if (paragraphOpen.type !== "paragraph_open" || inline.type !== "inline") {
        continue;
      }

      const alert = parseAlertMarker(inline.content);
      if (!alert) continue;

      const closeIndex = findBlockquoteClose(tokens, i);
      if (closeIndex < 0) continue;

      const open = tokens[i];
      open.type = "alert_open";
      open.tag = "div";
      open.attrSet("class", `markdown-alert markdown-alert-${alert.type.toLowerCase()}`);
      open.meta = { alertTitle: alert.title };

      const close = tokens[closeIndex];
      close.type = "alert_close";
      close.tag = "div";

      const children = inline.children;
      if (children) {
        children.splice(0, firstLineChildCount(children));
      }
      if (!children || children.length === 0) {
        const removeCount = tokens[i + 3]?.type === "paragraph_close" ? 3 : 2;
        tokens.splice(i + 1, removeCount);
      }
    }
  });

  md.renderer.rules.alert_open = (tokens, idx) => {
    const token = tokens[idx];
    const meta = token.meta as { alertTitle?: string } | null;
    const title = md.utils.escapeHtml(meta?.alertTitle ?? "");
    return `<div${md.renderer.renderAttrs(token)}><p class="markdown-alert-title">${title}</p>`;
  };

  md.renderer.rules.alert_close = () => "</div>";
}
