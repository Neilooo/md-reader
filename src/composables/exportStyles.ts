export const EXPORT_BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  color: #24292f;
  background: #fff;
  margin: 0;
  padding: 40px 32px 80px;
  line-height: 1.75;
  font-size: 16px;
}
.markdown-body { max-width: 900px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.3; margin: 1.5em 0 0.6em; }
h1 { font-size: 2em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d0d7de; padding-bottom: 0.3em; }
h3 { font-size: 1.25em; } h4 { font-size: 1em; }
p, ul, ol, blockquote, pre { margin: 0 0 1em; }
ul, ol { padding-left: 1.8em; }
a { color: #0969da; text-decoration: none; }
img { max-width: 100%; height: auto; }
blockquote { padding: 0 1em; color: #57606a; border-left: 4px solid #d0d7de; margin: 1em 0; }
code { background: #f6f8fa; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
pre { background: #f6f8fa; padding: 14px 16px; border-radius: 6px; overflow: auto; }
pre code { background: transparent; padding: 0; }
.front-matter { margin: 0 0 1.25em; padding: 12px 14px; border: 1px solid #d0d7de; border-radius: 8px; background: #f6f8fa; }
.front-matter-title { margin-bottom: 8px; color: #57606a; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.front-matter table { margin: 0; width: 100%; display: table; }
.front-matter th { width: 1%; white-space: nowrap; color: #57606a; vertical-align: top; }
.front-matter td ul { margin: 0; padding-left: 1.3em; }
.front-matter pre { margin: 0; padding: 8px 10px; }
.front-matter-error { color: #c00; }
.table-wrap { overflow-x: auto; margin: 0 0 1em; }
table { border-collapse: collapse; width: 100%; display: table; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
tr:nth-child(2n) td { background: #f6f8fa; }
hr { border: 0; border-top: 1px solid #d0d7de; margin: 2em 0; }
.task-list-item { list-style: none; margin-left: -1.4em; }
.task-list-item input[type="checkbox"] { margin-right: 6px; }
.footnotes { margin-top: 2em; padding-top: 1em; border-top: 1px solid #d0d7de;
  font-size: 0.9em; color: #57606a; }
.mermaid-block { margin: 1em 0; text-align: center; background: #f6f8fa;
  padding: 14px; border-radius: 6px; overflow-x: auto; }
.mermaid-block svg { max-width: 100%; height: auto; }
.math-block { margin: 1em 0; text-align: center; overflow-x: auto; }
.header-anchor { display: none !important; }
.find-highlight { background: transparent !important; color: inherit !important; }
@media print { body { padding: 0; } .markdown-body { max-width: none; } }
`;
