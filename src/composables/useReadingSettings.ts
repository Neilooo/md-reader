/**
 * 阅读设置（模块级单例）：字号/行高/页宽/字体（阅读区 + 编辑器）、目录
 * 位置、阅读区背景色（亮/暗主题分别保存）。
 * 持久化到 localStorage；apply() 把全部设置写到 :root 的 CSS 变量上，
 * 阅读区/编辑器样式只消费变量——改设置无需触碰组件。
 */

import { ref, computed } from "vue";
import { i18n } from "../i18n";

export interface ReadingSettings {
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  /** 内置字体键（system/sans/serif/mono）或系统字体名。 */
  fontFamily: string;
  editorFontSize: number;
  editorFontFamily: string;
  tocPosition: "left" | "right";
  /** 阅读区自定义背景色；null = 跟随主题默认。亮暗分开存。 */
  readerBgLight: string | null;
  readerBgDark: string | null;
  /** 启动时是否恢复上次关闭的标签页（#38）。 */
  restoreTabs: boolean;
}

const FONT_KEYS = ["system", "sans", "serif", "mono"] as const;

// 内置字体栈（中文优先）
const FONT_STACKS: Record<string, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  sans: '"Inter", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif:
    '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Georgia, serif',
  mono: 'ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", "Source Code Pro", Consolas, monospace',
};

const STORAGE = "md-reader-reading";

/** 读取设置：与默认值合并（保证新增字段有合理初值）。 */
function loadSettings(): ReadingSettings {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaults();
}

function defaults(): ReadingSettings {
  return {
    fontSize: 16,
    lineHeight: 1.75,
    maxWidth: 900,
    fontFamily: "system",
    editorFontSize: 14,
    editorFontFamily: "mono",
    tocPosition: "right",
    readerBgLight: null,
    readerBgDark: null,
    restoreTabs: true,
  };
}

const settings = ref<ReadingSettings>(loadSettings());

/** 持久化并立即应用到 CSS 变量。 */
function save() {
  localStorage.setItem(STORAGE, JSON.stringify(settings.value));
  apply();
}

/** 阅读字体栈：内置键取预设；系统字体名则「"字体", 回退栈」。 */
function getFontStack(value: string): string {
  if (FONT_STACKS[value]) return FONT_STACKS[value];
  if (value) return `"${value}", ${FONT_STACKS.system}`;
  return FONT_STACKS.system;
}

/** 编辑器字体栈：默认等宽；选了系统字体则在等宽栈前插入。 */
function getEditorFontStack(value: string): string {
  if (value === "mono" || !value) return FONT_STACKS.mono;
  return `"${value}", ${FONT_STACKS.mono}`;
}

/** 把全部设置写到 :root CSS 变量（--reader-* / --editor-*）。 */
function apply() {
  const r = document.documentElement;
  r.style.setProperty("--reader-font-size", settings.value.fontSize + "px");
  r.style.setProperty(
    "--reader-line-height",
    String(settings.value.lineHeight)
  );
  r.style.setProperty("--reader-max-width", settings.value.maxWidth + "px");
  r.style.setProperty(
    "--reader-font-family",
    getFontStack(settings.value.fontFamily)
  );
  r.style.setProperty(
    "--editor-font-size",
    settings.value.editorFontSize + "px"
  );
  r.style.setProperty(
    "--editor-font-family",
    getEditorFontStack(settings.value.editorFontFamily)
  );
  setReaderBgVar("--reader-bg-light", settings.value.readerBgLight);
  setReaderBgVar("--reader-bg-dark", settings.value.readerBgDark);
}

/** 背景色变量：合法 #RRGGBB 写入，否则移除变量（回落到主题默认）。 */
function setReaderBgVar(name: string, value: string | null) {
  const r = document.documentElement;
  if (value && /^#[0-9a-fA-F]{6}$/.test(value)) {
    r.style.setProperty(name, value);
  } else {
    r.style.removeProperty(name);
  }
}

// 各设置项的写入器（数值项做范围钳制，防 Ctrl+滚轮缩放出边界值）
function setFontSize(v: number) {
  settings.value.fontSize = Math.max(10, Math.min(28, v));
  save();
}

function setLineHeight(v: number) {
  settings.value.lineHeight = Math.max(1.2, Math.min(2.4, v));
  save();
}

function setMaxWidth(v: number) {
  settings.value.maxWidth = Math.max(600, Math.min(1400, v));
  save();
}

function setFontFamily(v: string) {
  settings.value.fontFamily = v;
  save();
}

function setEditorFontSize(v: number) {
  settings.value.editorFontSize = Math.max(12, Math.min(24, v));
  save();
}

function setEditorFontFamily(v: string) {
  settings.value.editorFontFamily = v;
  save();
}

function setTocPosition(v: "left" | "right") {
  settings.value.tocPosition = v;
  save();
}

function setRestoreTabs(v: boolean) {
  settings.value.restoreTabs = v;
  save();
}

function setReaderBgLight(v: string | null) {
  settings.value.readerBgLight = normalizeColor(v);
  save();
}

function setReaderBgDark(v: string | null) {
  settings.value.readerBgDark = normalizeColor(v);
  save();
}

/** 颜色归一化：只接受 #RRGGBB，其余（含空）归为 null（恢复默认）。 */
function normalizeColor(v: string | null): string | null {
  if (!v) return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(v.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

/** 恢复亮暗两侧背景色默认。 */
function resetReaderBg() {
  settings.value.readerBgLight = null;
  settings.value.readerBgDark = null;
  save();
}

function reset() {
  settings.value = defaults();
  save();
}

// 内置字体下拉选项（label 走 i18n）
const fontOptions = computed(() =>
  FONT_KEYS.map((key) => ({
    label: i18n.global.t(`settings.${key}`),
    value: key,
  }))
);

export function useReadingSettings() {
  return {
    settings,
    fontOptions,
    apply,
    setFontSize,
    setLineHeight,
    setMaxWidth,
    setFontFamily,
    setEditorFontSize,
    setEditorFontFamily,
    setTocPosition,
    setRestoreTabs,
    setReaderBgLight,
    setReaderBgDark,
    resetReaderBg,
    reset,
  };
}
