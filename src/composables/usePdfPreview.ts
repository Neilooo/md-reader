// Live preview for the PDF export style panel. Reuses the exact same pipeline as
// the real export (renderMarkdown + buildExportHtml) so what you see is what you get,
// rendered in isolated <iframe srcdoc> that cannot affect the app's own styles.
// Optionally renders a side-by-side 浅色 / 深色 (light / dark) comparison that keeps the
// user's chosen typography but forces a neutral light or dark page palette.
import { onMounted, ref, watch, type Ref } from "vue";
import { renderMarkdown } from "./useMarkdown";
import { buildExportHtml } from "./useExport";
import { usePdfStyle, type PdfStyleOptions } from "./usePdfStyle";

// A small but representative document exercising headings, text, lists, a table,
// a blockquote, inline code and a fenced code block.
const SAMPLE = `# 标题示例 H1
## 二级标题 H2
## 三级标题 H3

这是一段**正文**示例，包含 *斜体*、\`行内代码\` 与[链接](https://example.com)。

> 引用：好的排版让人更愿意读完一整篇文档。

- 列表项一
- 列表项二
  - 嵌套项

1. 有序一
2. 有序二

| 名称 | 数值 |
| --- | --- |
| A | 10 |
| B | 20 |

\`\`\`ts
function greet(name: string): string {
  return \`Hello, \${name}\`;
}
\`\`\`

—— 预览随上方样式设置实时更新。`;

// Neutral, readable GitHub-like palettes used by the light/dark comparison.
// Typography (font, size, density, code font) is kept from the user's style; only
// the color fields are overridden so the user can compare page polarity.
function lightVariant(o: PdfStyleOptions): PdfStyleOptions {
  return {
    ...o,
    bgColor: "#ffffff",
    textColor: "#24292f",
    headingColor: "#1f2328",
    linkColor: "#0969da",
    codeBg: "#f6f8fa",
    codeColor: "#24292f",
    quoteColor: "#57606a",
    quoteBorder: "#d0d7de",
    borderColor: "#d0d7de",
    tableHeadBg: "#f6f8fa",
    tableOddBg: "#ffffff",
    tableEvenBg: "#f6f8fa",
  };
}

function darkVariant(o: PdfStyleOptions): PdfStyleOptions {
  return {
    ...o,
    bgColor: "#0d1117",
    textColor: "#c9d1d9",
    headingColor: "#e6edf3",
    linkColor: "#58a6ff",
    codeBg: "#161b22",
    codeColor: "#c9d1d9",
    quoteColor: "#8b949e",
    quoteBorder: "#30363d",
    borderColor: "#30363d",
    tableHeadBg: "#161b22",
    tableOddBg: "#0d1117",
    tableEvenBg: "#161b22",
  };
}

export interface PdfPreviewState {
  previewHtml: Ref<string>;
  previewLight: Ref<string>;
  previewDark: Ref<string>;
  sampleText: Ref<string>;
  compareMode: Ref<boolean>;
}

export function usePdfPreview(): PdfPreviewState {
  const previewHtml = ref("");
  const previewLight = ref("");
  const previewDark = ref("");
  const sampleText = ref(SAMPLE);
  const compareMode = ref(false);
  const { settings } = usePdfStyle();
  let timer: number | undefined;

  async function rebuild(): Promise<void> {
    const html = renderMarkdown(sampleText.value);
    const container = document.createElement("div");
    container.innerHTML = html;
    const base = { pdfStyle: settings.value };
    previewHtml.value = await buildExportHtml(container, "预览", base);
    if (compareMode.value) {
      previewLight.value = await buildExportHtml(
        container,
        "浅色",
        { pdfStyle: lightVariant(settings.value) }
      );
      previewDark.value = await buildExportHtml(
        container,
        "深色",
        { pdfStyle: darkVariant(settings.value) }
      );
    }
  }

  function schedule(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void rebuild();
    }, 150);
  }

  onMounted(rebuild);
  watch(settings, schedule, { deep: true });
  watch(sampleText, schedule);
  watch(compareMode, schedule);

  return { previewHtml, previewLight, previewDark, sampleText, compareMode };
}
