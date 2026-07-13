<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import { EditorView, keymap } from "@codemirror/view";
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

const props = defineProps<{
  modelValue: string;
  theme: "light" | "dark";
  readonly?: boolean;
  currentFile?: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ready"): void;
  (e: "toggle-mode"): void;
}>();

const host = ref<HTMLElement | null>(null);
const searchCounter = ref({ visible: false, current: 0, total: 0 });
let view: EditorView | null = null;
let searchCounterTimer: number | null = null;
let lastSearchKey = "";

const themeCompartment = new Compartment();
const editableCompartment = new Compartment();
const replacePanelTheme = EditorView.baseTheme({
  ".cm-panel.cm-search [name=replace]": {
    display: "inline-block",
  },
  ".cm-panel.cm-search [name=replaceAll]": {
    display: "inline-block",
  },
});

const editorBaseTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--bg)",
    color: "var(--fg)",
  },
  ".cm-scroller": {
    fontFamily:
      'ui-monospace, SFMono-Regular, "JetBrains Mono", "Cascadia Code", Consolas, monospace',
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
    backgroundColor: "var(--bg-active)",
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

function themeExtension(): Extension {
  return props.theme === "dark"
    ? [oneDark, editorBaseTheme]
    : [editorBaseTheme];
}

function editableExtension() {
  return EditorView.editable.of(!props.readonly);
}

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
    if (match.from === selection.from && match.to === selection.to) current = total;
    if (!firstAfterSelection && match.from >= selection.from) firstAfterSelection = total;
  }
  if (!current) current = firstAfterSelection || (total ? 1 : 0);
  searchCounter.value = {
    visible: true,
    current,
    total,
  };
}

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

function createEditor() {
  if (!host.value) return;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        markdown(),
        search({ top: true }),
        replacePanelTheme,
        Prec.highest(
          keymap.of([
            {
              key: "Mod-l",
              run: () => wrapSelection("<mark>", "</mark>"),
            },
            {
              key: "Mod-b",
              run: () => wrapSelection("**"),
            },
            {
              key: "Mod-i",
              run: () => wrapSelection("*"),
            },
            {
              key: "Mod-u",
              run: () => wrapSelection("<u>", "</u>"),
            },
            {
              key: "Mod-Shift-`",
              run: () => wrapSelection("`"),
            },
            {
              key: "Mod-e",
              run: () => {
                emit("toggle-mode");
                return true;
              },
            },
            {
              key: "Mod-f",
              run: () => {
                openSearch();
                return true;
              },
            },
            {
              key: "Mod-h",
              run: () => {
                openReplace();
                return true;
              },
            },
          ])
        ),
        keymap.of([indentWithTab, ...searchKeymap]),
        themeCompartment.of(themeExtension()),
        editableCompartment.of(editableExtension()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modelValue", update.state.doc.toString());
          }
          if (update.docChanged || update.selectionSet || update.transactions.length) {
            scheduleSearchCounterUpdate(update.docChanged || update.selectionSet);
          }
        }),
      ],
    }),
  });
  emit("ready");
  updateSearchCounter();
}

function replaceDoc(value: string) {
  if (!view) return;
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: value,
    },
  });
}

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

function getTopVisibleLine(): number {
  if (!view) return 1;
  const scroller = view.scrollDOM;
  const block = view.lineBlockAtHeight(scroller.scrollTop);
  return view.state.doc.lineAt(block.from).number;
}

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

function focus() {
  view?.focus();
}

function openSearch() {
  if (!view) return;
  openSearchPanel(view);
  focusSearchInput();
}

function openReplace() {
  openSearch();
}

function goToLine() {
  if (!view) return;
  gotoLine(view);
}

function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function getImageDir(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  const baseDir = i < 0 ? "" : normalized.slice(0, i);
  return baseDir ? `${baseDir}/images` : "images";
}

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
  host.value?.addEventListener("paste", handlePaste, true);
});

onBeforeUnmount(() => {
  host.value?.removeEventListener("paste", handlePaste, true);
  view?.destroy();
  view = null;
  if (searchCounterTimer !== null) {
    window.clearTimeout(searchCounterTimer);
    searchCounterTimer = null;
  }
});

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return;
    replaceDoc(value);
  }
);

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
  <div class="markdown-editor-shell">
    <div ref="host" class="markdown-editor"></div>
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
}
.markdown-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
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
