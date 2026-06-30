import { ref, computed } from "vue";
import { i18n } from "../i18n";

export interface ReadingSettings {
  fontSize: number;
  lineHeight: number;
  maxWidth: number;
  fontFamily: string;
}

const FONT_KEYS = ["system", "sans", "serif", "mono"] as const;

const FONT_STACKS: Record<string, string> = {
  system:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  sans:
    '"Inter", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
  serif:
    '"Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "STSong", Georgia, serif',
  mono:
    'ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", "Source Code Pro", Consolas, monospace',
};

const STORAGE = "md-reader-reading";

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
  };
}

const settings = ref<ReadingSettings>(loadSettings());

function save() {
  localStorage.setItem(STORAGE, JSON.stringify(settings.value));
  apply();
}

function apply() {
  const r = document.documentElement;
  r.style.setProperty("--reader-font-size", settings.value.fontSize + "px");
  r.style.setProperty("--reader-line-height", String(settings.value.lineHeight));
  r.style.setProperty("--reader-max-width", settings.value.maxWidth + "px");
  r.style.setProperty(
    "--reader-font-family",
    FONT_STACKS[settings.value.fontFamily] || FONT_STACKS.system
  );
}

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

function reset() {
  settings.value = defaults();
  save();
}

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
    reset,
  };
}
