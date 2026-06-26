<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { gotoLine, openSearchPanel, search, searchKeymap } from "@codemirror/search";
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
let view: EditorView | null = null;

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
          { key: "Mod-h", run: openSearchPanel },
          ...searchKeymap,
        ]),
        themeCompartment.of(themeExtension()),
        editableCompartment.of(editableExtension()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            emit("update:modelValue", update.state.doc.toString());
          }
        }),
      ],
    }),
  });
  emit("ready");
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
  view.focus();
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
  <div ref="host" class="markdown-editor"></div>
</template>

<style scoped>
.markdown-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
