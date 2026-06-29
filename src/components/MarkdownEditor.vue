<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
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

const props = defineProps<{
  modelValue: string;
  theme: "light" | "dark";
  readonly?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "ready"): void;
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
    fontSize: "14px",
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
    backgroundColor: "rgba(9, 105, 218, 0.25)",
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
        keymap.of([
          indentWithTab,
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
          ...searchKeymap,
        ]),
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

onMounted(createEditor);

onBeforeUnmount(() => {
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

defineExpose({ focus, openSearch, openReplace, goToLine });
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
