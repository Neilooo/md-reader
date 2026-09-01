// PDF export styling: fonts, colors, spacing, page geometry and preset templates.
// Mirrors the options exposed by md-to.com's Markdown-to-PDF exporter so that the
// Edge-headless PDF output can be tuned (font family / font color / templates).
import { ref } from "vue";

export type PdfPageSize = "A4" | "Letter";
export type PdfOrientation = "portrait" | "landscape";
export type PdfDensity = "compact" | "standard" | "loose";

// Spacing presets (mirrors md-to.com's Compact / Standard / Loose variants).
export const PDF_DENSITY_SPACING: Record<
  PdfDensity,
  { lineHeight: number; blockGap: number }
> = {
  compact: { lineHeight: 1.5, blockGap: 0.6 },
  standard: { lineHeight: 1.75, blockGap: 1 },
  loose: { lineHeight: 2.0, blockGap: 1.4 },
};

export interface PdfStyleOptions {
  templateId: string;
  bodyFont: string;
  headingFont: string;
  codeFont: string;
  fontSize: number; // body font size in px
  h1Scale: number; // em
  h2Scale: number; // em
  h3Scale: number; // em
  lineHeight: number;
  density: PdfDensity;
  blockGap: number; // em, vertical gap between blocks/headings
  textColor: string;
  headingColor: string;
  linkColor: string;
  codeColor: string;
  codeBg: string;
  bgColor: string;
  quoteColor: string;
  quoteBorder: string;
  borderColor: string;
  tableHeadBg: string;
  tableOddBg: string;
  tableEvenBg: string;
  pageMargin: number; // mm
  pageSize: PdfPageSize;
  orientation: PdfOrientation;
}

export interface PdfFontChoice {
  label: string;
  value: string;
}

export const PDF_FONT_CHOICES: PdfFontChoice[] = [
  {
    label: "系统默认（中文）",
    value:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  },
  {
    label: "微软雅黑 Microsoft YaHei",
    value: '"Microsoft YaHei", "PingFang SC", sans-serif',
  },
  {
    label: "宋体 SimSun（衬线）",
    value: '"SimSun", "Songti SC", "STSong", serif',
  },
  { label: "黑体 SimHei", value: '"SimHei", "Microsoft YaHei", sans-serif' },
  {
    label: "思源黑体 Noto Sans SC",
    value: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
  },
  {
    label: "思源宋体 Noto Serif SC",
    value: '"Noto Serif SC", "Source Han Serif SC", "SimSun", serif',
  },
  {
    label: "Inter（无衬线）",
    value: '"Inter", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    label: "Georgia（衬线英文）",
    value: 'Georgia, "Times New Roman", "SimSun", serif',
  },
  { label: "Arial", value: 'Arial, "Microsoft YaHei", sans-serif' },
];

export const PDF_CODE_FONT_CHOICES: PdfFontChoice[] = [
  {
    label: "等宽（系统）",
    value:
      'ui-monospace, SFMono-Regular, "JetBrains Mono", Consolas, "Cascadia Code", monospace',
  },
  { label: "JetBrains Mono", value: '"JetBrains Mono", Consolas, monospace' },
  { label: "Consolas", value: 'Consolas, "Courier New", monospace' },
  {
    label: "Source Code Pro",
    value: '"Source Code Pro", Consolas, monospace',
  },
  {
    label: "SF Mono",
    value: '"SF Mono", "JetBrains Mono", Consolas, monospace',
  },
];

const SYSTEM_STACK = PDF_FONT_CHOICES[0].value;
const MONO_STACK = PDF_CODE_FONT_CHOICES[0].value;

function base(): PdfStyleOptions {
  return {
    templateId: "default",
    bodyFont: SYSTEM_STACK,
    headingFont: SYSTEM_STACK,
    codeFont: MONO_STACK,
    fontSize: 16,
    h1Scale: 2,
    h2Scale: 1.5,
    h3Scale: 1.25,
    lineHeight: 1.75,
    density: "standard",
    blockGap: 1,
    textColor: "#24292f",
    headingColor: "#1f2328",
    linkColor: "#0969da",
    codeColor: "#24292f",
    codeBg: "#f6f8fa",
    bgColor: "#ffffff",
    quoteColor: "#57606a",
    quoteBorder: "#d0d7de",
    borderColor: "#d0d7de",
    tableHeadBg: "#f6f8fa",
    tableOddBg: "#ffffff",
    tableEvenBg: "#f6f8fa",
    pageMargin: 18,
    pageSize: "A4",
    orientation: "portrait",
  };
}

export interface PdfTemplate {
  id: string;
  i18nKey: string;
  options: Partial<PdfStyleOptions>;
}

// Preset templates (a curated subset inspired by md-to.com's template gallery).
export const PDF_TEMPLATES: PdfTemplate[] = [
  {
    id: "default",
    i18nKey: "pdfStyle.tpl.default",
    options: {},
  },
  {
    id: "minimal",
    i18nKey: "pdfStyle.tpl.minimal",
    options: {
      textColor: "#333333",
      headingColor: "#111111",
      linkColor: "#007acc",
      codeBg: "#f5f5f5",
      borderColor: "#e0e0e0",
      quoteColor: "#666666",
      quoteBorder: "#cccccc",
      tableHeadBg: "#f5f5f5",
      tableEvenBg: "#fafafa",
      lineHeight: 1.7,
    },
  },
  {
    id: "academic",
    i18nKey: "pdfStyle.tpl.academic",
    options: {
      bodyFont: PDF_FONT_CHOICES[5].value,
      headingFont: PDF_FONT_CHOICES[5].value,
      textColor: "#1a1a1a",
      headingColor: "#1b5e20",
      linkColor: "#1565c0",
      codeBg: "#f3f3f3",
      bgColor: "#ffffff",
      quoteColor: "#555555",
      quoteBorder: "#cfcfcf",
      borderColor: "#cfcfcf",
      tableHeadBg: "#eef5ee",
      tableEvenBg: "#f7faf7",
      lineHeight: 1.9,
      fontSize: 16,
      pageMargin: 20,
    },
  },
  {
    id: "eyeCare",
    i18nKey: "pdfStyle.tpl.eyeCare",
    options: {
      textColor: "#42403a",
      headingColor: "#2f3a2f",
      linkColor: "#2e7d6b",
      codeBg: "#eae3d2",
      bgColor: "#f5f0e1",
      quoteColor: "#6b6452",
      quoteBorder: "#d8cdb5",
      borderColor: "#d8cdb5",
      tableHeadBg: "#ece4d0",
      tableOddBg: "#f5f0e1",
      tableEvenBg: "#efe8d6",
      lineHeight: 1.8,
    },
  },
  {
    id: "businessBlue",
    i18nKey: "pdfStyle.tpl.businessBlue",
    options: {
      textColor: "#1f2933",
      headingColor: "#0b3d91",
      linkColor: "#0969da",
      codeBg: "#f4f6fb",
      bgColor: "#ffffff",
      quoteColor: "#52606d",
      quoteBorder: "#d6deeb",
      borderColor: "#d6deeb",
      tableHeadBg: "#eef2fb",
      tableEvenBg: "#f7f9fc",
      lineHeight: 1.7,
    },
  },
  {
    id: "classicBrown",
    i18nKey: "pdfStyle.tpl.classicBrown",
    options: {
      bodyFont: PDF_FONT_CHOICES[5].value,
      headingFont: PDF_FONT_CHOICES[5].value,
      bgColor: "#fbf7f0",
      textColor: "#2b2620",
      headingColor: "#6b4226",
      linkColor: "#8a5a2b",
      codeBg: "#f1ece2",
      quoteColor: "#6b5f4f",
      quoteBorder: "#e0d6c3",
      borderColor: "#e0d6c3",
      tableHeadBg: "#f1e9da",
      tableEvenBg: "#f6f1e7",
      lineHeight: 1.9,
    },
  },
  {
    id: "dark",
    i18nKey: "pdfStyle.tpl.dark",
    options: {
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
      lineHeight: 1.7,
    },
  },
  {
    id: "github",
    i18nKey: "pdfStyle.tpl.github",
    options: {
      textColor: "#1f2328",
      headingColor: "#1f2328",
      linkColor: "#0969da",
      codeBg: "#f6f8fa",
      borderColor: "#d0d7de",
      quoteColor: "#59636e",
      quoteBorder: "#d0d7de",
      tableHeadBg: "#f6f8fa",
      tableEvenBg: "#f6f8fa",
      lineHeight: 1.75,
    },
  },
  // --- Developer templates ---
  {
    id: "terminalGreen",
    i18nKey: "pdfStyle.tpl.terminalGreen",
    options: {
      bodyFont: PDF_CODE_FONT_CHOICES[0].value,
      headingFont: PDF_CODE_FONT_CHOICES[0].value,
      codeFont: PDF_CODE_FONT_CHOICES[0].value,
      bgColor: "#0c0c0c",
      textColor: "#d4d4d4",
      headingColor: "#3ad97f",
      linkColor: "#36c5d6",
      codeBg: "#1a1a1a",
      codeColor: "#3ad97f",
      quoteColor: "#9aa0a6",
      quoteBorder: "#333333",
      borderColor: "#333333",
      tableHeadBg: "#1a1a1a",
      tableOddBg: "#0c0c0c",
      tableEvenBg: "#161616",
      lineHeight: 1.6,
    },
  },
  {
    id: "dracula",
    i18nKey: "pdfStyle.tpl.dracula",
    options: {
      bgColor: "#282a36",
      textColor: "#f8f8f2",
      headingColor: "#bd93f9",
      linkColor: "#8be9fd",
      codeBg: "#21222c",
      codeColor: "#f8f8f2",
      quoteColor: "#6272a4",
      quoteBorder: "#44475a",
      borderColor: "#44475a",
      tableHeadBg: "#21222c",
      tableOddBg: "#282a36",
      tableEvenBg: "#21222c",
      lineHeight: 1.7,
    },
  },
  {
    id: "vsCodeBlue",
    i18nKey: "pdfStyle.tpl.vsCodeBlue",
    options: {
      textColor: "#1e1e1e",
      headingColor: "#0066b8",
      linkColor: "#006ab1",
      codeBg: "#f3f3f3",
      quoteColor: "#555555",
      quoteBorder: "#d4d4d4",
      borderColor: "#d4d4d4",
      tableHeadBg: "#f3f3f3",
      tableEvenBg: "#f3f3f3",
      lineHeight: 1.7,
    },
  },
  // --- Creative templates ---
  {
    id: "sakuraPink",
    i18nKey: "pdfStyle.tpl.sakuraPink",
    options: {
      textColor: "#5a4a4a",
      headingColor: "#e75480",
      linkColor: "#d6336c",
      codeBg: "#ffe9ef",
      bgColor: "#fff5f7",
      quoteColor: "#a06b7d",
      quoteBorder: "#f3c6d3",
      borderColor: "#f3c6d3",
      tableHeadBg: "#ffe9ef",
      tableOddBg: "#fff5f7",
      tableEvenBg: "#fff0f4",
      lineHeight: 1.8,
    },
  },
  {
    id: "lavender",
    i18nKey: "pdfStyle.tpl.lavender",
    options: {
      textColor: "#4a4458",
      headingColor: "#7c5cff",
      linkColor: "#6a3df5",
      codeBg: "#ece6ff",
      bgColor: "#f6f3ff",
      quoteColor: "#8a7fb0",
      quoteBorder: "#d6caf5",
      borderColor: "#d6caf5",
      tableHeadBg: "#ece6ff",
      tableOddBg: "#f6f3ff",
      tableEvenBg: "#f1ecff",
      lineHeight: 1.8,
    },
  },
  {
    id: "oceanCyan",
    i18nKey: "pdfStyle.tpl.oceanCyan",
    options: {
      textColor: "#2a4a4a",
      headingColor: "#0fb6b6",
      linkColor: "#0a8f8f",
      codeBg: "#d9f6f4",
      bgColor: "#eefcfb",
      quoteColor: "#5a8a86",
      quoteBorder: "#b6e6e2",
      borderColor: "#b6e6e2",
      tableHeadBg: "#d9f6f4",
      tableOddBg: "#eefcfb",
      tableEvenBg: "#e6faf8",
      lineHeight: 1.8,
    },
  },
  {
    id: "sunsetOrange",
    i18nKey: "pdfStyle.tpl.sunsetOrange",
    options: {
      textColor: "#5a4636",
      headingColor: "#f97316",
      linkColor: "#ea7317",
      codeBg: "#ffeddb",
      bgColor: "#fff6ee",
      quoteColor: "#a87a52",
      quoteBorder: "#f3cda8",
      borderColor: "#f3cda8",
      tableHeadBg: "#ffeddb",
      tableOddBg: "#fff6ee",
      tableEvenBg: "#fff1e2",
      lineHeight: 1.8,
    },
  },
  {
    id: "forestMoss",
    i18nKey: "pdfStyle.tpl.forestMoss",
    options: {
      textColor: "#3a4a32",
      headingColor: "#5a8a3c",
      linkColor: "#4a7a2c",
      codeBg: "#e6f0dc",
      bgColor: "#f3f8ee",
      quoteColor: "#6a7a52",
      quoteBorder: "#c9d9b6",
      borderColor: "#c9d9b6",
      tableHeadBg: "#e6f0dc",
      tableOddBg: "#f3f8ee",
      tableEvenBg: "#eef4e6",
      lineHeight: 1.8,
    },
  },
  // --- Popular developer palettes ---
  {
    id: "nord",
    i18nKey: "pdfStyle.tpl.nord",
    options: {
      bgColor: "#2e3440",
      textColor: "#eceff4",
      headingColor: "#88c0d0",
      linkColor: "#81a1c1",
      codeBg: "#3b4252",
      codeColor: "#eceff4",
      quoteColor: "#d8dee9",
      quoteBorder: "#4c566a",
      borderColor: "#434c5e",
      tableHeadBg: "#3b4252",
      tableOddBg: "#2e3440",
      tableEvenBg: "#3b4252",
      lineHeight: 1.7,
    },
  },
  {
    id: "solarizedLight",
    i18nKey: "pdfStyle.tpl.solarizedLight",
    options: {
      bgColor: "#fdf6e3",
      textColor: "#657b83",
      headingColor: "#586e75",
      linkColor: "#268bd2",
      codeBg: "#eee8d5",
      codeColor: "#657b83",
      quoteColor: "#93a1a1",
      quoteBorder: "#eee8d5",
      borderColor: "#eee8d5",
      tableHeadBg: "#eee8d5",
      tableOddBg: "#fdf6e3",
      tableEvenBg: "#eee8d5",
      lineHeight: 1.7,
    },
  },
  {
    id: "solarizedDark",
    i18nKey: "pdfStyle.tpl.solarizedDark",
    options: {
      bgColor: "#002b36",
      textColor: "#839496",
      headingColor: "#93a1a1",
      linkColor: "#268bd2",
      codeBg: "#073642",
      codeColor: "#839496",
      quoteColor: "#586e75",
      quoteBorder: "#073642",
      borderColor: "#073642",
      tableHeadBg: "#073642",
      tableOddBg: "#002b36",
      tableEvenBg: "#073642",
      lineHeight: 1.7,
    },
  },
  {
    id: "gruvboxLight",
    i18nKey: "pdfStyle.tpl.gruvboxLight",
    options: {
      bgColor: "#fbf1c7",
      textColor: "#3c3836",
      headingColor: "#076678",
      linkColor: "#076678",
      codeBg: "#ebdbb2",
      codeColor: "#3c3836",
      quoteColor: "#7c6f64",
      quoteBorder: "#d5c4a1",
      borderColor: "#d5c4a1",
      tableHeadBg: "#ebdbb2",
      tableOddBg: "#fbf1c7",
      tableEvenBg: "#ebdbb2",
      lineHeight: 1.7,
    },
  },
  {
    id: "gruvboxDark",
    i18nKey: "pdfStyle.tpl.gruvboxDark",
    options: {
      bgColor: "#282828",
      textColor: "#ebdbb2",
      headingColor: "#d79921",
      linkColor: "#458588",
      codeBg: "#3c3836",
      codeColor: "#ebdbb2",
      quoteColor: "#a89984",
      quoteBorder: "#504945",
      borderColor: "#504945",
      tableHeadBg: "#3c3836",
      tableOddBg: "#282828",
      tableEvenBg: "#3c3836",
      lineHeight: 1.7,
    },
  },
  {
    id: "monokai",
    i18nKey: "pdfStyle.tpl.monokai",
    options: {
      bgColor: "#272822",
      textColor: "#f8f8f2",
      headingColor: "#66d9ef",
      linkColor: "#66d9ef",
      codeBg: "#1e1f1c",
      codeColor: "#f8f8f2",
      quoteColor: "#75715e",
      quoteBorder: "#49483e",
      borderColor: "#49483e",
      tableHeadBg: "#1e1f1c",
      tableOddBg: "#272822",
      tableEvenBg: "#1e1f1c",
      lineHeight: 1.7,
    },
  },
  {
    id: "catppuccin",
    i18nKey: "pdfStyle.tpl.catppuccin",
    options: {
      bgColor: "#1e1e2e",
      textColor: "#cdd6f4",
      headingColor: "#cba6f7",
      linkColor: "#89b4fa",
      codeBg: "#181825",
      codeColor: "#cdd6f4",
      quoteColor: "#bac2de",
      quoteBorder: "#313244",
      borderColor: "#313244",
      tableHeadBg: "#181825",
      tableOddBg: "#1e1e2e",
      tableEvenBg: "#181825",
      lineHeight: 1.7,
    },
  },
  {
    id: "oneDark",
    i18nKey: "pdfStyle.tpl.oneDark",
    options: {
      bgColor: "#282c34",
      textColor: "#abb2bf",
      headingColor: "#e5c07b",
      linkColor: "#61afef",
      codeBg: "#21252b",
      codeColor: "#abb2bf",
      quoteColor: "#5c6370",
      quoteBorder: "#3e4451",
      borderColor: "#3e4451",
      tableHeadBg: "#21252b",
      tableOddBg: "#282c34",
      tableEvenBg: "#21252b",
      lineHeight: 1.7,
    },
  },
];

// Template groups shown as <optgroup>s in the style dropdown.
export interface PdfTemplateCategory {
  id: string;
  i18nKey: string;
  items: string[];
}

export const PDF_TEMPLATE_CATEGORIES: PdfTemplateCategory[] = [
  {
    id: "doc",
    i18nKey: "pdfStyle.cat.doc",
    items: [
      "default",
      "minimal",
      "academic",
      "eyeCare",
      "businessBlue",
      "classicBrown",
      "github",
    ],
  },
  {
    id: "dev",
    i18nKey: "pdfStyle.cat.dev",
    items: [
      "dark",
      "terminalGreen",
      "dracula",
      "vsCodeBlue",
      "nord",
      "solarizedLight",
      "solarizedDark",
      "gruvboxLight",
      "gruvboxDark",
      "monokai",
      "catppuccin",
      "oneDark",
    ],
  },
  {
    id: "creative",
    i18nKey: "pdfStyle.cat.creative",
    items: ["sakuraPink", "lavender", "oceanCyan", "sunsetOrange", "forestMoss"],
  },
];

function resolveTemplate(id: string): PdfStyleOptions {
  const tpl = PDF_TEMPLATES.find((t) => t.id === id);
  return { ...base(), ...(tpl?.options ?? {}), templateId: id };
}

const STORAGE = "md-reader-pdf-style";

function load(): PdfStyleOptions {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PdfStyleOptions>;
      return { ...base(), ...parsed, templateId: parsed.templateId ?? "default" };
    }
  } catch {
    /* ignore */
  }
  return base();
}

const settingsRef = ref<PdfStyleOptions>(load());

function persist() {
  localStorage.setItem(STORAGE, JSON.stringify(settingsRef.value));
}

function applyTemplate(id: string) {
  settingsRef.value = resolveTemplate(id);
  persist();
}

function setOption<K extends keyof PdfStyleOptions>(
  key: K,
  value: PdfStyleOptions[K]
) {
  const next = { ...settingsRef.value, [key]: value } as PdfStyleOptions;
  if (key !== "templateId") next.templateId = "custom";
  settingsRef.value = next;
  persist();
}

function setDensity(d: PdfDensity) {
  const spacing = PDF_DENSITY_SPACING[d];
  settingsRef.value = {
    ...settingsRef.value,
    density: d,
    lineHeight: spacing.lineHeight,
    blockGap: spacing.blockGap,
    templateId: "custom",
  };
  persist();
}

function reset() {
  settingsRef.value = base();
  persist();
}

export function isLightColor(hex: string): boolean {
  let h = (hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return true;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.5;
}

export function getDefaultPdfStyle(): PdfStyleOptions {
  return base();
}

export function pdfStyleToCss(o: PdfStyleOptions): string {
  const page = `${o.pageSize} ${o.orientation}`;
  return `
:root {
  --pdf-body-font: ${o.bodyFont};
  --pdf-heading-font: ${o.headingFont};
  --pdf-code-font: ${o.codeFont};
  --pdf-body-size: ${o.fontSize}px;
  --pdf-line-height: ${o.lineHeight};
  --pdf-block-gap: ${o.blockGap}em;
  --pdf-fg: ${o.textColor};
  --pdf-heading-fg: ${o.headingColor};
  --pdf-link: ${o.linkColor};
  --pdf-code-fg: ${o.codeColor};
  --pdf-code-bg: ${o.codeBg};
  --pdf-bg: ${o.bgColor};
  --pdf-quote-fg: ${o.quoteColor};
  --pdf-quote-border: ${o.quoteBorder};
  --pdf-border: ${o.borderColor};
  --pdf-table-head-bg: ${o.tableHeadBg};
  --pdf-table-odd-bg: ${o.tableOddBg};
  --pdf-table-even-bg: ${o.tableEvenBg};
  --pdf-h1: ${o.h1Scale}em;
  --pdf-h2: ${o.h2Scale}em;
  --pdf-h3: ${o.h3Scale}em;
}
@page { size: ${page}; margin: ${o.pageMargin}mm; }
`;
}

export function usePdfStyle() {
  return {
    settings: settingsRef,
    templates: PDF_TEMPLATES,
    templateCategories: PDF_TEMPLATE_CATEGORIES,
    fontChoices: PDF_FONT_CHOICES,
    codeFontChoices: PDF_CODE_FONT_CHOICES,
    applyTemplate,
    setOption,
    setDensity,
    reset,
  };
}
