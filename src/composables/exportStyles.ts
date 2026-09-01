// Base CSS for exported HTML / PDF. All visual properties read from the
// --pdf-* CSS variables injected by usePdfStyle (pdfStyleToCss). Defaults in the
// var() fallbacks reproduce the original GitHub-like look when no style is set.
export const EXPORT_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: var(--pdf-body-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif);
  color: var(--pdf-fg, #24292f);
  background: var(--pdf-bg, #fff);
  margin: 0;
  padding: 0;
  line-height: var(--pdf-line-height, 1.75);
  font-size: var(--pdf-body-size, 16px);
}
/* Screen preview padding (does not affect print/PDF, which uses @page margins). */
@media screen { body { padding: 48px 40px 64px; } }
.markdown-body { max-width: 100%; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 {
  font-family: var(--pdf-heading-font, inherit);
  color: var(--pdf-heading-fg, inherit);
  font-weight: 600; line-height: 1.3;
  margin: calc(var(--pdf-block-gap, 1em) * 1.5) 0 calc(var(--pdf-block-gap, 1em) * 0.6);
}
h1 { font-size: var(--pdf-h1, 2em); border-bottom: 1px solid var(--pdf-border, #d0d7de); padding-bottom: 0.3em; }
h2 { font-size: var(--pdf-h2, 1.5em); border-bottom: 1px solid var(--pdf-border, #d0d7de); padding-bottom: 0.3em; }
h3 { font-size: var(--pdf-h3, 1.25em); } h4 { font-size: 1em; }
p, ul, ol, blockquote, pre { margin: 0 0 var(--pdf-block-gap, 1em); }
ul, ol { padding-left: 1.8em; }
a { color: var(--pdf-link, #0969da); text-decoration: none; }
img { max-width: 100%; height: auto; }
blockquote {
  padding: 0 1em; color: var(--pdf-quote-fg, #57606a);
  border-left: 4px solid var(--pdf-quote-border, #d0d7de); margin: var(--pdf-block-gap, 1em) 0;
}
code {
  background: var(--pdf-code-bg, #f6f8fa);
  color: var(--pdf-code-fg, inherit);
  padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em;
  font-family: var(--pdf-code-font, ui-monospace, SFMono-Regular, Consolas, monospace);
}
pre { background: var(--pdf-code-bg, #f6f8fa); padding: 14px 16px; border-radius: 6px; overflow: auto; }
pre code { background: transparent; padding: 0; color: inherit; }
.front-matter { margin: 0 0 calc(var(--pdf-block-gap, 1em) * 1.25); padding: 12px 14px; border: 1px solid var(--pdf-border, #d0d7de); border-radius: 8px; background: var(--pdf-code-bg, #f6f8fa); }
.front-matter-title { margin-bottom: 8px; color: var(--pdf-quote-fg, #57606a); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.front-matter table { margin: 0; width: 100%; display: table; }
.front-matter th { width: 1%; white-space: nowrap; color: var(--pdf-quote-fg, #57606a); vertical-align: top; }
.front-matter td ul { margin: 0; padding-left: 1.3em; }
.front-matter pre { margin: 0; padding: 8px 10px; }
.front-matter-error { color: #c00; }
.table-wrap { overflow-x: auto; margin: 0 0 var(--pdf-block-gap, 1em); }
table { border-collapse: collapse; width: 100%; display: table; }
th, td { border: 1px solid var(--pdf-border, #d0d7de); padding: 6px 12px; }
thead th, .front-matter th { background: var(--pdf-table-head-bg, #f6f8fa); }
tr:nth-child(2n) td { background: var(--pdf-table-even-bg, #f6f8fa); }
hr { border: 0; border-top: 1px solid var(--pdf-border, #d0d7de); margin: calc(var(--pdf-block-gap, 1em) * 2) 0; }
.task-list-item { list-style: none; margin-left: -1.4em; }
.task-list-item input[type="checkbox"] { margin-right: 6px; }
.footnotes { margin-top: calc(var(--pdf-block-gap, 1em) * 2); padding-top: 1em; border-top: 1px solid var(--pdf-border, #d0d7de); font-size: 0.9em; color: var(--pdf-quote-fg, #57606a); }
.mermaid-block { margin: 1em 0; text-align: center; background: var(--pdf-code-bg, #f6f8fa); padding: 14px; border-radius: 6px; overflow-x: auto; }
.mermaid-block svg { max-width: 100%; height: auto; }
.math-block { margin: 1em 0; text-align: center; overflow-x: auto; }
.header-anchor { display: none !important; }
.find-highlight { background: transparent !important; color: inherit !important; }
@media print { body { padding: 0; } .markdown-body { max-width: none; } }
`;
