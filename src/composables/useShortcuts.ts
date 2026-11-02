/**
 * 快捷键系统（模块级单例）：
 * - DEFS 定义全部快捷键（默认绑定、生效目标、分类、i18n 描述键）
 * - 用户自定义绑定存 localStorage["md-reader-shortcuts"]，只存与默认不同的
 * - 被关闭（停用）的快捷键 id 存 localStorage["md-reader-shortcut-disabled"]，
 *   停用后分发端（App.vue / CodeMirror keymap）直接跳过，按键回落到默认行为
 * - App.vue 的 window keydown 分发和 MarkdownEditor 的 CodeMirror keymap
 *   都从 getBinding() + isEnabled() 取值，所以改绑定/停用两边立即生效
 * - ShortcutsDialog 的展示/录制/冲突检测也走这里
 */

import { ref } from "vue";
import { i18n } from "../i18n";

/** 生效目标：app = 全局键盘分发；editor = 仅 CodeMirror 内；both = 两处；readonly = 仅展示不可改（Esc/Ctrl+滚轮）。 */
export type ShortcutTarget = "app" | "editor" | "both" | "readonly";
/** 设置页展示分组：全局 / 编辑器 / 查找。 */
export type ShortcutCategory = "global" | "editor" | "find";

export interface ShortcutDef {
  id: string;
  /** 形如 "Ctrl+Shift+F" 的组合串（单字母统一小写归一化后存储）。 */
  defaultBinding: string;
  target: ShortcutTarget;
  /** 仅编辑态有效（如替换、跳行）。 */
  editOnly?: boolean;
  category: ShortcutCategory;
  /** i18n 键（shortcuts.<descKey>），设置页与冲突提示用。 */
  descKey: string;
  /** 固定快捷键，不允许用户改绑（如 Esc、Ctrl+滚轮）。 */
  readonly?: boolean;
}

// 全部快捷键定义表
const DEFS: ShortcutDef[] = [
  {
    id: "toggle-mode",
    defaultBinding: "Ctrl+E",
    target: "both",
    category: "global",
    descKey: "toggleMode",
  },
  {
    id: "new-file",
    defaultBinding: "Ctrl+N",
    target: "app",
    category: "global",
    descKey: "newFile",
  },
  {
    id: "open-file",
    defaultBinding: "Ctrl+O",
    target: "app",
    category: "global",
    descKey: "openFile",
  },
  {
    id: "search-panel",
    defaultBinding: "Ctrl+Shift+F",
    target: "app",
    category: "global",
    descKey: "searchPanel",
  },
  {
    id: "save",
    defaultBinding: "Ctrl+S",
    target: "app",
    category: "global",
    descKey: "save",
  },
  {
    id: "save-as",
    defaultBinding: "Ctrl+Shift+S",
    target: "app",
    category: "global",
    descKey: "saveAs",
  },
  {
    id: "settings",
    defaultBinding: "Ctrl+,",
    target: "app",
    category: "global",
    descKey: "settings",
  },
  {
    id: "print",
    defaultBinding: "Ctrl+P",
    target: "app",
    category: "global",
    descKey: "print",
  },
  {
    id: "zoom-in",
    defaultBinding: "Ctrl+=",
    target: "app",
    category: "global",
    descKey: "zoomIn",
  },
  {
    id: "zoom-out",
    defaultBinding: "Ctrl+-",
    target: "app",
    category: "global",
    descKey: "zoomOut",
  },
  {
    id: "zoom-reset",
    defaultBinding: "Ctrl+0",
    target: "app",
    category: "global",
    descKey: "zoomReset",
  },
  {
    id: "find",
    defaultBinding: "Ctrl+F",
    target: "both",
    category: "find",
    descKey: "find",
  },
  {
    id: "close-tab",
    defaultBinding: "Ctrl+W",
    target: "app",
    category: "global",
    descKey: "closeTab",
  },
  {
    id: "next-tab",
    defaultBinding: "Ctrl+Tab",
    target: "app",
    category: "global",
    descKey: "nextTab",
  },
  {
    id: "prev-tab",
    defaultBinding: "Ctrl+Shift+Tab",
    target: "app",
    category: "global",
    descKey: "prevTab",
  },
  {
    id: "next-tab-right",
    defaultBinding: "Ctrl+ArrowRight",
    target: "app",
    category: "global",
    descKey: "nextTabRight",
  },
  {
    id: "prev-tab-left",
    defaultBinding: "Ctrl+ArrowLeft",
    target: "app",
    category: "global",
    descKey: "prevTabLeft",
  },
  {
    id: "replace",
    defaultBinding: "Ctrl+H",
    target: "both",
    editOnly: true,
    category: "find",
    descKey: "replace",
  },
  {
    id: "go-to-line",
    defaultBinding: "Ctrl+G",
    target: "app",
    editOnly: true,
    category: "find",
    descKey: "goToLine",
  },
  {
    id: "bold",
    defaultBinding: "Ctrl+B",
    target: "editor",
    category: "editor",
    descKey: "bold",
  },
  {
    id: "italic",
    defaultBinding: "Ctrl+I",
    target: "editor",
    category: "editor",
    descKey: "italic",
  },
  {
    id: "underline",
    defaultBinding: "Ctrl+U",
    target: "editor",
    category: "editor",
    descKey: "underline",
  },
  {
    id: "highlight",
    defaultBinding: "Ctrl+L",
    target: "editor",
    category: "editor",
    descKey: "highlight",
  },
  {
    id: "inline-code",
    defaultBinding: "Ctrl+Shift+`",
    target: "editor",
    category: "editor",
    descKey: "inlineCode",
  },
  {
    id: "close",
    defaultBinding: "Esc",
    target: "readonly",
    category: "global",
    descKey: "close",
    readonly: true,
  },
  {
    id: "zoom-wheel",
    defaultBinding: "Ctrl+Wheel",
    target: "readonly",
    category: "global",
    descKey: "zoomWheel",
    readonly: true,
  },
];

/** 归一化组合串：末尾若是单字母则转小写，让 "Ctrl+S" 和 "Ctrl+s" 视为同一个键。 */
function normalizeComboKey(combo: string): string {
  const parts = combo.split("+");
  const last = parts[parts.length - 1];
  if (last.length === 1 && /[a-zA-Z]/.test(last)) {
    parts[parts.length - 1] = last.toLowerCase();
  }
  return parts.join("+");
}

// id → 默认绑定（归一化后）的映射
const DEFAULTS: Record<string, string> = {};
for (const def of DEFS) {
  DEFAULTS[def.id] = normalizeComboKey(def.defaultBinding);
}

const STORAGE = "md-reader-shortcuts";
/** 停用集合单独一个键：旧版本只认识 STORAGE，分开存可无损兼容。 */
const STORAGE_DISABLED = "md-reader-shortcut-disabled";

/** 从 localStorage 读用户自定义（损坏数据静默忽略）。 */
function loadOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

/** 读停用集合（只保留字符串 id，防止脏数据）。 */
function loadDisabled(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_DISABLED);
    if (raw) {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return new Set(list.filter((id): id is string => typeof id === "string"));
      }
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

// 用户改过的绑定（id → 归一化组合串），模块级单例
const overrides = ref<Record<string, string>>(loadOverrides());
// 被关闭的快捷键 id 集合（停用后不参与按键分发）
const disabled = ref<Set<string>>(loadDisabled());

function save() {
  localStorage.setItem(STORAGE, JSON.stringify(overrides.value));
}

function saveDisabled() {
  localStorage.setItem(STORAGE_DISABLED, JSON.stringify([...disabled.value]));
}

/** 取某快捷键的当前生效绑定（自定义优先，无则默认）。 */
function getBinding(id: string): string {
  return overrides.value[id] ?? DEFAULTS[id] ?? "";
}

function getDef(id: string): ShortcutDef | undefined {
  return DEFS.find((d) => d.id === id);
}

/**
 * 设置绑定：先做冲突检测——与其他（非只读、非自身）快捷键的当前生效
 * 绑定相同则拒绝并返回冲突项名称；改回默认值时删除覆盖记录（保持
 * localStorage 只存差异）。返回 {ok, conflict?}。
 */
function setBinding(
  id: string,
  combo: string
): { ok: boolean; conflict?: string } {
  const normalized = normalizeComboKey(combo);
  for (const def of DEFS) {
    if (def.readonly || def.id === id) continue;
    if (getBinding(def.id) === normalized) {
      return { ok: false, conflict: i18n.global.t(`shortcuts.${def.descKey}`) };
    }
  }
  const next = { ...overrides.value };
  if (normalized === DEFAULTS[id]) {
    delete next[id];
  } else {
    next[id] = normalized;
  }
  overrides.value = next;
  save();
  return { ok: true };
}

/** 恢复单个快捷键为默认。 */
function resetBinding(id: string) {
  if (!(id in overrides.value)) return;
  const next = { ...overrides.value };
  delete next[id];
  overrides.value = next;
  save();
}

/** 恢复全部默认：绑定回到默认值，并重新启用所有被关闭的快捷键。 */
function resetAll() {
  overrides.value = {};
  disabled.value = new Set();
  save();
  saveDisabled();
}

/** 该快捷键是否被用户自定义过（设置页显示「已自定义」标记）。 */
function isCustom(id: string): boolean {
  return id in overrides.value;
}

/** 快捷键当前是否生效（未停用）。 */
function isEnabled(id: string): boolean {
  return !disabled.value.has(id);
}

/** 单个快捷键启用/停用（readonly 项固定生效，不允许停用）。 */
function setEnabled(id: string, enabled: boolean) {
  const def = getDef(id);
  if (!def || def.readonly) return;
  if (enabled === isEnabled(id)) return;
  const next = new Set(disabled.value);
  if (enabled) next.delete(id);
  else next.add(id);
  disabled.value = next;
  saveDisabled();
}

/** 是否所有可停用的快捷键都已关闭（决定「全部关闭/全部启用」按钮文案）。 */
function allDisabled(): boolean {
  return DEFS.filter((d) => !d.readonly).every((d) => disabled.value.has(d.id));
}

/** 全部启用/全部关闭（readonly 项不参与）。 */
function setAllEnabled(enabled: boolean) {
  disabled.value = enabled
    ? new Set()
    : new Set(DEFS.filter((d) => !d.readonly).map((d) => d.id));
  saveDisabled();
}

/** 把键盘事件转成组合串（Ctrl/Meta 统一为 Ctrl，单字母小写）。 */
function normalizeEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key.length === 1) key = key.toLowerCase();
  parts.push(key);
  return parts.join("+");
}

/** 转成 CodeMirror 的键名格式："Ctrl+B" → "Mod-B"（CM 用 Mod 跨平台表示 Cmd/Ctrl）。 */
function toCodeMirror(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "Ctrl" ? "Mod" : p))
    .join("-");
}

/** 展示格式：末尾单字母转大写（"ctrl+s" → "Ctrl+S"）。 */
function formatBinding(combo: string): string {
  const parts = combo.split("+");
  const last = parts[parts.length - 1];
  if (last.length === 1 && /[a-z]/.test(last)) {
    parts[parts.length - 1] = last.toUpperCase();
  }
  return parts.join("+");
}

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

/** 录制的组合是否合法：必须含 Ctrl 且以非修饰键结尾。 */
function isValidCombo(combo: string): boolean {
  if (!combo.includes("Ctrl")) return false;
  const parts = combo.split("+");
  const last = parts[parts.length - 1];
  if (MODIFIER_KEYS.has(last)) return false;
  return true;
}

/** 是否为修饰键（录制过程中单独按下修饰键不算完成）。 */
function isModifierKey(key: string): boolean {
  return MODIFIER_KEYS.has(key);
}

export function useShortcuts() {
  return {
    defs: DEFS,
    overrides,
    disabled,
    getBinding,
    getDef,
    setBinding,
    resetBinding,
    resetAll,
    isCustom,
    isEnabled,
    setEnabled,
    allDisabled,
    setAllEnabled,
    normalizeEvent,
    toCodeMirror,
    formatBinding,
    isValidCombo,
    isModifierKey,
  };
}
