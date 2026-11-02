<!--
  Markdown 编辑器：CodeMirror 6 集成。
  - 主题/只读/快捷键用 Compartment 动态重配（无需重建编辑器）
  - 快捷键（加粗/高亮/行内代码等）从 useShortcuts 的用户可改绑定生成，
    绑定变更时热更新 keymap
  - 内置 CodeMirror 查找/替换面板 + 自绘的「当前/总数」计数器
  - 顶部格式化工具栏（标题级别/行内格式/块级格式），可在阅读设置里关闭
  - 粘贴图片自动落盘到文档同目录 images/ 并插入相对链接
  对外（defineExpose）提供 App.vue 键盘分发用的接口：查找/替换/跳行/
  可视行定位与滚动（编辑↔预览切换的位置同步锚点）。
-->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { basicSetup } from "codemirror";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type ChangeSpec,
  type Extension,
  type SelectionRange,
} from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  getSearchQuery,
  gotoLine,
  openSearchPanel,
  search,
  searchKeymap,
  searchPanelOpen,
} from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import { useShortcuts } from "../composables/useShortcuts";

const props = defineProps<{
  modelValue: string;
  theme: "light" | "dark";
  readonly?: boolean;
  currentFile?: string;
  /** 是否显示顶部格式化工具栏（阅读设置里可关，默认开）。 */
  showToolbar?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ready"): void;
  (e: "toggle-mode"): void;
  /** 编辑区滚动/换文档后上报顶部可见源码行（1-based），驱动编辑态大纲高亮。 */
  (e: "scroll-line", line: number): void;
}>();

const host = ref<HTMLElement | null>(null);
// 自绘查找计数器状态（CM 自带面板没有这个信息）
const searchCounter = ref({ visible: false, current: 0, total: 0 });
// 当前选区首行的标题级别（0=正文），驱动工具栏下拉回显
const currentHeading = ref(0);
let view: EditorView | null = null;
let searchCounterTimer: number | null = null;
// 上次计数器计算时的查询指纹，内容/选区没变就跳过重算
let lastSearchKey = "";

// 三个 Compartment：主题/只读/快捷键的运行时热切换
const themeCompartment = new Compartment();
const editableCompartment = new Compartment();
const keymapCompartment = new Compartment();
const { t } = useI18n();
const {
  getBinding,
  toCodeMirror,
  overrides,
  isEnabled,
  disabled,
  formatBinding,
} = useShortcuts();
// 让查找面板的「替换/全部替换」按钮显示出来（默认只搜不换）
const replacePanelTheme = EditorView.baseTheme({
  ".cm-panel.cm-search [name=replace]": {
    display: "inline-block",
  },
  ".cm-panel.cm-search [name=replaceAll]": {
    display: "inline-block",
  },
});

// 基础主题：把 CM 外观接到应用的 CSS 变量（跟随阅读设置）
const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
  },
  ".cm-scroller": {
    fontFamily:
      'var(--editor-font-family, ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", Consolas, monospace)',
    fontSize: "var(--editor-font-size, 14px)",
    lineHeight: "1.65",
  },
  ".cm-content": {
    padding: "24px 0 80px",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-toolbar)",
    color: "var(--fg-muted)",
    borderRight: "1px solid var(--border)",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--editor-active-line-bg, rgba(0, 0, 0, 0.03))",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-active)",
    color: "var(--link)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "var(--editor-selection-bg, rgba(9, 105, 218, 0.3))",
  },
  ".cm-search": {
    backgroundColor: "var(--bg-toolbar)",
    color: "var(--fg)",
    borderTop: "1px solid var(--border)",
  },
  ".cm-search input": {
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    outline: "none",
  },
  ".cm-search button": {
    backgroundColor: "var(--bg-btn)",
    color: "var(--fg)",
    border: "1px solid var(--border)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  ".cm-search button:hover": {
    backgroundColor: "var(--bg-btn-hover)",
  },
});

/** 主题扩展：暗色叠加 oneDark，亮色只用接 CSS 变量的基础主题。 */
function themeExtension(): Extension {
  return props.theme === "dark"
    ? [oneDark, editorBaseTheme]
    : [editorBaseTheme];
}

function editableExtension() {
  return EditorView.editable.of(!props.readonly);
}

/** 查询指纹：搜索面板开合 + 查询参数 + 文档长度的组合，用于跳过无谓重算。 */
function searchKey(): string {
  if (!view) return "";
  if (!searchPanelOpen(view.state)) return "closed";
  const query = getSearchQuery(view.state);
  return JSON.stringify({
    search: query.search,
    caseSensitive: query.caseSensitive,
    literal: query.literal,
    regexp: query.regexp,
    wholeWord: query.wholeWord,
    valid: query.valid,
    docLength: view.state.doc.length,
  });
}

/**
 * 重算查找计数器（x/y）：全量遍历匹配游标统计 total；current 取与选区
 * 完全重合的匹配，否则退而取选区之后的第一个匹配。CM 面板没有提供
 * 这个信息，只能自己扫。
 */
function updateSearchCounter() {
  if (!view || !searchPanelOpen(view.state)) {
    lastSearchKey = "closed";
    searchCounter.value = { visible: false, current: 0, total: 0 };
    return;
  }
  const key = searchKey();
  lastSearchKey = key;
  const query = getSearchQuery(view.state);
  if (!query.valid || !query.search) {
    searchCounter.value = { visible: true, current: 0, total: 0 };
    return;
  }
  const selection = view.state.selection.main;
  const cursor = query.getCursor(view.state, 0, view.state.doc.length);
  let total = 0;
  let current = 0;
  let firstAfterSelection = 0;
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    total += 1;
    const match = next.value;
    if (match.from === selection.from && match.to === selection.to)
      current = total;
    if (!firstAfterSelection && match.from >= selection.from)
      firstAfterSelection = total;
  }
  if (!current) current = firstAfterSelection || (total ? 1 : 0);
  searchCounter.value = {
    visible: true,
    current,
    total,
  };
}

/** 80ms 防抖更新计数器；指纹没变且有选区时跳过（输入/移动光标场景）。 */
function scheduleSearchCounterUpdate(force = false) {
  if (!view) return;
  if (!force) {
    const nextKey = searchKey();
    if (nextKey === lastSearchKey && !view.state.selection.main.empty) return;
  }
  if (searchCounterTimer !== null) window.clearTimeout(searchCounterTimer);
  searchCounterTimer = window.setTimeout(() => {
    searchCounterTimer = null;
    updateSearchCounter();
  }, 80);
}

/** 打开查找面板后把焦点移到搜索输入框（CM 默认不聚焦）。 */
function focusSearchInput() {
  if (!view) return;
  window.requestAnimationFrame(() => {
    const root = view?.dom.parentElement ?? host.value;
    const input = root?.querySelector<HTMLInputElement>(
      '.cm-search [main-field="true"], .cm-search input[name="search"], .cm-search input'
    );
    input?.focus();
    input?.select();
    updateSearchCounter();
  });
}

/**
 * 构建格式化快捷键表（加粗/斜体/高亮/下划线/行内代码 + 模式切换/查找/替换）。
 * 绑定来自 useShortcuts（用户可在设置里改），Prec.highest 保证压过
 * basicSetup 自带的默认键；已停用的快捷键不注册，让按键回落到编辑器默认行为。
 */
function buildKeymap() {
  const actions: { id: string; run: () => boolean }[] = [
    {
      id: "highlight",
      run: () => wrapSelection("<mark>", "</mark>"),
    },
    { id: "bold", run: () => wrapSelection("**") },
    { id: "italic", run: () => wrapSelection("*") },
    { id: "underline", run: () => wrapSelection("<u>", "</u>") },
    { id: "inline-code", run: () => wrapSelection("`") },
    {
      id: "toggle-mode",
      run: () => {
        emit("toggle-mode");
        return true;
      },
    },
    {
      id: "find",
      run: () => {
        openSearch();
        return true;
      },
    },
    {
      id: "replace",
      run: () => {
        openReplace();
        return true;
      },
    },
  ];
  return Prec.highest(
    keymap.of(
      actions
        .filter((a) => isEnabled(a.id))
        .map((a) => ({ key: toCodeMirror(getBinding(a.id)), run: a.run }))
    )
  );
}

/** 创建 CodeMirror 实例（挂载时一次）。updateListener 负责内容同步与计数器调度。 */
function createEditor() {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        drawSelection(),
        markdown(),
        search({ top: true }),
        replacePanelTheme,
        keymapCompartment.of(buildKeymap()),
        keymap.of([indentWithTab, ...searchKeymap]),
        themeCompartment.of(themeExtension()),
        editableCompartment.of(editableExtension()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modelValue", update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet) {
            syncHeading();
          }
          if (
            update.docChanged ||
            update.selectionSet ||
            update.transactions.length
          ) {
            scheduleSearchCounterUpdate(
              update.docChanged || update.selectionSet
            );
          }
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener("scroll", onEditorScroll, { passive: true });
  emit("ready");
  updateSearchCounter();
  syncHeading();
  emit("scroll-line", getTopVisibleLine());
}

/** 整体替换文档内容（外部 modelValue 变化时；会触发改动事件回流）。 */
function replaceDoc(value: string) {
  if (!view) return;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: value,
    },
  });
  emit("scroll-line", getTopVisibleLine());
}

/**
 * 用前后缀包裹所有选区（格式化快捷键的核心）。多选区逐个处理并
 * 累计偏移量修正后续位置；空选区退化为光标插入前后缀。
 */
function wrapSelection(prefix: string, suffix = prefix) {
  if (!view) return false;
  const state = view.state;
  const changes: ChangeSpec[] = [];
  const ranges: SelectionRange[] = [];
  let offset = 0;
  for (const range of state.selection.ranges) {
    const selected = state.sliceDoc(range.from, range.to);
    const insert = `${prefix}${selected}${suffix}`;
    changes.push({ from: range.from, to: range.to, insert });
    const from = range.from + offset + prefix.length;
    const to = from + selected.length;
    ranges.push(
      selected ? EditorSelection.range(from, to) : EditorSelection.cursor(from)
    );
    offset += prefix.length + suffix.length;
  }
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

/* ---- 格式化工具栏 ---- */

/** 当前选区覆盖的行（空选区 = 光标所在行）。 */
function selectedLines(): { from: number; to: number; text: string }[] {
  if (!view) return [];
  const doc = view.state.doc;
  const sel = view.state.selection.main;
  const start = doc.lineAt(sel.from).number;
  const end = doc.lineAt(sel.to).number;
  const lines: { from: number; to: number; text: string }[] = [];
  for (let n = start; n <= end; n++) lines.push(doc.line(n));
  return lines;
}

/** 选区首行的标题级别（0=正文），供下拉回显。 */
function readHeadingLevel(): number {
  if (!view) return 0;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const m = /^(#{1,6})\s+/.exec(line.text);
  return m ? m[1].length : 0;
}

function syncHeading() {
  currentHeading.value = readHeadingLevel();
}

/**
 * 设置标题级别（0=正文）。作用于选区覆盖的所有行；若所有行已经是目标
 * 级别则整体取消（下拉再选同一级别 = 切回正文），否则统一设置。
 */
function applyHeading(level: number) {
  if (!view) return;
  const lines = selectedLines();
  const allMatch = lines.every((line) => {
    const m = /^(#{1,6})\s+/.exec(line.text);
    return (m ? m[1].length : 0) === level;
  });
  const target = allMatch ? 0 : level;
  const changes: ChangeSpec[] = lines.map((line) => {
    const body = line.text.replace(/^#{1,6}\s+/, "");
    return {
      from: line.from,
      to: line.to,
      insert: target > 0 ? "#".repeat(target) + " " + body : body,
    };
  });
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

function onHeadingChange(e: Event) {
  applyHeading(Number((e.target as HTMLSelectElement).value));
}

/** 目标类型前缀（判断“是否已经是该类型”用）。 */
function linePrefixRegex(kind: "bullet" | "ordered" | "quote"): RegExp {
  if (kind === "quote") return /^(\s*)>\s?/;
  if (kind === "bullet") return /^(\s*)[-*+]\s+/;
  return /^(\s*)\d+\.\s+/;
}

/** 剥离前缀用：列表两种类型互相转换，引用只去引用标记。 */
function stripPrefixRegex(kind: "bullet" | "ordered" | "quote"): RegExp {
  if (kind === "quote") return /^(\s*)>\s?/;
  return /^(\s*)(?:[-*+]\s+|\d+\.\s+)/;
}

/**
 * 列表/引用前缀切换：所有行都已带目标前缀则移除，否则统一添加；
 * 有序列表按行重新编号，缩进保留。
 */
function toggleLinePrefix(kind: "bullet" | "ordered" | "quote") {
  if (!view) return;
  const lines = selectedLines();
  const sameRe = linePrefixRegex(kind);
  const stripRe = stripPrefixRegex(kind);
  const allMatch = lines.every((line) => sameRe.test(line.text));
  let counter = 1;
  const changes: ChangeSpec[] = lines.map((line) => {
    const stripped = line.text.replace(stripRe, "$1");
    if (allMatch) return { from: line.from, to: line.to, insert: stripped };
    const indent = /^(\s*)/.exec(stripped)?.[1] ?? "";
    const body = stripped.slice(indent.length);
    let prefix = "> ";
    if (kind === "bullet") prefix = "- ";
    else if (kind === "ordered") prefix = `${counter++}. `;
    return { from: line.from, to: line.to, insert: indent + prefix + body };
  });
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
}

/** 代码块：有选区则包裹，无选区插入空块并把光标放到中间行。 */
function wrapCodeBlock() {
  if (!view) return;
  const sel = view.state.selection.main;
  if (sel.empty) {
    view.dispatch({
      changes: { from: sel.from, insert: "```\n\n```" },
      selection: EditorSelection.cursor(sel.from + 4),
      userEvent: "input",
    });
  } else {
    const text = view.state.sliceDoc(sel.from, sel.to);
    view.dispatch({
      changes: {
        from: sel.from,
        to: sel.to,
        insert: "```\n" + text + "\n```",
      },
      selection: EditorSelection.range(
        sel.from + 4,
        sel.from + 4 + text.length
      ),
      userEvent: "input",
    });
  }
  view.focus();
}

/** 分割线：空行直接填 ---，否则在当前行后另起一段插入。 */
function insertHorizontalRule() {
  if (!view) return;
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  if (!line.text.trim()) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "---" },
      userEvent: "input",
    });
  } else {
    view.dispatch({
      changes: { from: line.to, insert: "\n\n---" },
      userEvent: "input",
    });
  }
  view.focus();
}

/** 工具栏按钮 tooltip：文案 + 快捷键（快捷键被停用时不显示提示）。 */
function formatTitle(id: string, key: string): string {
  const label = t(`format.${key}`);
  return isEnabled(id) ? `${label} (${formatBinding(getBinding(id))})` : label;
}
function getTopVisibleLine(): number {
  if (!view) return 1;
  const scroller = view.scrollDOM;
  const block = view.lineBlockAtHeight(scroller.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

// 编辑区滚动 → rAF 节流上报顶部可见行（编辑态大纲高亮用）
let scrollRaf = 0;
function onEditorScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    emit("scroll-line", getTopVisibleLine());
  });
}

/** 滚动到指定行并把光标放到行首（预览→编辑切换时的对位）。 */
function scrollToLine(line: number) {
  if (!view) return;
  const target = Math.min(Math.max(1, line), view.state.doc.lines);
  const pos = view.state.doc.line(target).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
  });
  view.focus();
}

// ---- 对外暴露的接口（App.vue 键盘分发使用）----

function focus() {
  view?.focus();
}

function openSearch() {
  if (!view) return;
  openSearchPanel(view);
  focusSearchInput();
}

/** 打开替换（CM 的搜索面板本身就含替换字段，等价于 openSearch）。 */
function openReplace() {
  openSearch();
}

function goToLine() {
  if (!view) return;
  gotoLine(view);
}

// ---- 粘贴图片：落盘到文档同目录 images/ 并插入相对链接 ----

/** 时间戳文件名：paste-YYYYMMDD-HHmmss.ext，避免重名覆盖。 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** 图片存放目录：当前文档所在目录下的 images/。 */
function getImageDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  const baseDir = i < 0 ? "" : normalized.slice(0, i);
  return baseDir ? `${baseDir}/images` : "images";
}

/** 粘贴拦截：剪贴板里有图片就落盘插入，替代默认的（无意义）粘贴行为。 */
function handlePaste(e: ClipboardEvent) {
  if (!props.currentFile || !view) return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        const pos = view.state.selection.main.from;
        void insertPastedImage(file, pos);
        return;
      }
    }
  }
}

async function insertPastedImage(file: File, pos: number) {
  if (!view) return;
  try {
    const ext = file.type
      ? (file.type.split("/")[1] || "png").toLowerCase()
      : "png";
    const fileName = `paste-${formatTimestamp(new Date())}.${ext}`;
    const imageDir = getImageDir(props.currentFile || "");
    await mkdir(imageDir, { recursive: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await writeFile(`${imageDir}/${fileName}`, bytes);
    // 插入相对路径链接（渲染时 useLinkRewriter 会按文档目录解析）
    const markdown = `![](images/${fileName})\n`;
    view.dispatch({
      changes: { from: pos, insert: markdown },
      selection: { anchor: pos + markdown.length },
    });
    view.focus();
  } catch (err) {
    console.error("paste image failed", err);
  }
}

onMounted(() => {
  createEditor();
  // capture 阶段拦截 paste，赶在 CM 默认处理之前
  host.value?.addEventListener("paste", handlePaste, true);
});

onBeforeUnmount(() => {
  host.value?.removeEventListener("paste", handlePaste, true);
  if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
  scrollRaf = 0;
  view?.scrollDOM.removeEventListener("scroll", onEditorScroll);
  view?.destroy();
  view = null;
  if (searchCounterTimer !== null) {
    window.clearTimeout(searchCounterTimer);
    searchCounterTimer = null;
  }
});

// 外部内容变化 → 替换文档（仅当与当前文档不同，避免光标跳动）
watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    replaceDoc(value);
  }
);

// 主题/只读/快捷键绑定变化 → Compartment 热重配（不重建编辑器）
watch(
  () => props.theme,
  () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) });
  }
);

watch(
  () => props.readonly,
  () => {
    view?.dispatch({
      effects: editableCompartment.reconfigure(editableExtension()),
    });
  }
);

// 快捷键绑定/启停变化 → Compartment 热重配（不重建编辑器）
watch(
  [overrides, disabled],
  () => {
    view?.dispatch({ effects: keymapCompartment.reconfigure(buildKeymap()) });
  },
  { deep: true }
);

defineExpose({
  focus,
  openSearch,
  openReplace,
  goToLine,
  getTopVisibleLine,
  scrollToLine,
});
</script>

<template>
  <div
    class="markdown-editor-shell"
    :class="{ 'has-toolbar': showToolbar !== false && !readonly }"
  >
    <!-- 格式化工具栏：仅编辑模式显示，阅读设置里可关闭 -->
    <div v-if="showToolbar !== false && !readonly" class="format-toolbar">
      <select
        class="fmt-heading"
        :value="currentHeading"
        :title="t('format.heading')"
        @change="onHeadingChange"
      >
        <option :value="0">{{ t("format.paragraph") }}</option>
        <option v-for="lvl in 6" :key="lvl" :value="lvl">H{{ lvl }}</option>
      </select>
      <span class="fmt-sep"></span>
      <button
        type="button"
        class="fmt-btn"
        :title="formatTitle('bold', 'bold')"
        @mousedown.prevent
        @click="wrapSelection('**')"
      >
        {{ t("format.bold") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="formatTitle('italic', 'italic')"
        @mousedown.prevent
        @click="wrapSelection('*')"
      >
        {{ t("format.italic") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="formatTitle('underline', 'underline')"
        @mousedown.prevent
        @click="wrapSelection('<u>', '</u>')"
      >
        {{ t("format.underline") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="formatTitle('highlight', 'highlight')"
        @mousedown.prevent
        @click="wrapSelection('<mark>', '</mark>')"
      >
        {{ t("format.highlight") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="formatTitle('inline-code', 'inlineCode')"
        @mousedown.prevent
        @click="wrapSelection('`')"
      >
        {{ t("format.inlineCode") }}
      </button>
      <span class="fmt-sep"></span>
      <button
        type="button"
        class="fmt-btn"
        :title="t('format.bulletList')"
        @mousedown.prevent
        @click="toggleLinePrefix('bullet')"
      >
        {{ t("format.bulletList") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="t('format.orderedList')"
        @mousedown.prevent
        @click="toggleLinePrefix('ordered')"
      >
        {{ t("format.orderedList") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="t('format.quote')"
        @mousedown.prevent
        @click="toggleLinePrefix('quote')"
      >
        {{ t("format.quote") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="t('format.codeBlock')"
        @mousedown.prevent
        @click="wrapCodeBlock()"
      >
        {{ t("format.codeBlock") }}
      </button>
      <button
        type="button"
        class="fmt-btn"
        :title="t('format.horizontalRule')"
        @mousedown.prevent
        @click="insertHorizontalRule()"
      >
        {{ t("format.horizontalRule") }}
      </button>
    </div>
    <!-- CodeMirror 挂载宿主 -->
    <div ref="host" class="markdown-editor"></div>
    <!-- 查找计数器浮层（面板打开且查询有效时显示） -->
    <div v-if="searchCounter.visible" class="editor-find-counter">
      {{ searchCounter.current }}/{{ searchCounter.total }}
    </div>
  </div>
</template>

<style scoped>
.markdown-editor-shell {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.format-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
  overflow-x: auto;
  white-space: nowrap;
  user-select: none;
  scrollbar-width: thin;
}
.fmt-heading {
  flex: 0 0 auto;
  font-size: 12px;
  padding: 2px 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-btn);
  color: var(--fg);
  cursor: pointer;
}
.fmt-btn {
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
}
.fmt-btn:hover {
  background: var(--bg-btn-hover);
  border-color: var(--border);
}
.fmt-sep {
  flex: 0 0 auto;
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border);
}
.markdown-editor {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
/* 工具栏占位后，CM 顶部搜索面板下移，计数器同步偏移 */
.has-toolbar .editor-find-counter {
  top: 92px;
}
.editor-find-counter {
  position: absolute;
  top: 58px;
  right: 16px;
  z-index: 8;
  min-width: 44px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-toolbar);
  color: var(--fg-muted);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}
</style>
