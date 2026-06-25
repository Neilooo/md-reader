<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import MarkdownView from "./components/MarkdownView.vue";
import FileTree from "./components/FileTree.vue";
import TocPanel from "./components/TocPanel.vue";
import FindBar from "./components/FindBar.vue";
import SearchPanel from "./components/SearchPanel.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import { useFileTree } from "./composables/useFileTree";
import { useFileWatcher } from "./composables/useFileWatcher";
import { extractHeadings, type Heading } from "./composables/useMarkdown";
import { useResizable } from "./composables/useResizable";
import { useScrollSpy } from "./composables/useScrollSpy";
import { useFindInPage } from "./composables/useFindInPage";
import { useHistory } from "./composables/useHistory";
import { useReadingSettings } from "./composables/useReadingSettings";
import {
  exportToHtml,
  exportToDocx,
  exportToPdf,
  checkPandoc,
  checkPdfEngine,
  printDocument,
  type PandocInfo,
} from "./composables/useExport";

const {
  rootDir,
  tree,
  loading: treeLoading,
  error: treeError,
  refresh: refreshTree,
  openFolder,
  restoreRoot,
  clearRoot,
} = useFileTree();

const watcher = useFileWatcher();
const { pushRecent, saveScroll, getScroll } = useHistory();
const { apply: applyReadingSettings } = useReadingSettings();

const content = ref<string>("");
const currentFile = ref<string>("");
const errorMsg = ref<string>("");
const headings = ref<Heading[]>([]);

const theme = ref<"light" | "dark">(
  (localStorage.getItem("md-reader-theme") as "light" | "dark") || "light"
);
const showFileTree = ref<boolean>(
  localStorage.getItem("md-reader-show-tree") !== "0"
);
const showToc = ref<boolean>(
  localStorage.getItem("md-reader-show-toc") !== "0"
);
const showSettings = ref(false);
const leftMode = ref<"files" | "search">("files");
const showExportMenu = ref(false);
const exportBusy = ref(false);
const exportToast = ref("");
const pandocInfo = ref<PandocInfo | null>(null);
const pdfEnginePath = ref<string | null>(null);

const { width: leftWidth, startResize: resizeLeft } = useResizable(
  "md-reader-left-w",
  260
);
const { width: rightWidth, startResize: resizeRight } = useResizable(
  "md-reader-right-w",
  240,
  { inverse: true }
);

const viewerEl = ref<HTMLElement | null>(null);
const markdownRef = ref<{ root: HTMLElement | null } | null>(null);
const bodyRef = computed(() => markdownRef.value?.root ?? null);

const { activeId, onScroll, jumpTo } = useScrollSpy(viewerEl, bodyRef);
const find = useFindInPage(bodyRef);

const fileName = computed(() => {
  if (!currentFile.value) return "未打开文件";
  const parts = currentFile.value.split(/[\\/]/);
  return parts[parts.length - 1];
});

let pendingScrollTop = 0;
let pendingHash = "";

async function loadFile(path: string, hash = "") {
  try {
    saveCurrentScroll();
    const text = await readTextFile(path);
    content.value = text;
    currentFile.value = path;
    errorMsg.value = "";
    headings.value = extractHeadings(text);
    pushRecent(path);
    pendingHash = hash;
    pendingScrollTop = hash ? 0 : getScroll(path);
    find.clearHighlights();
  } catch (e: any) {
    errorMsg.value = `读取失败: ${e?.message || e}`;
  }
}

function onRendered() {
  nextTick(() => {
    if (!viewerEl.value) return;
    if (pendingHash) {
      jumpTo(pendingHash);
      pendingHash = "";
    } else if (pendingScrollTop > 0) {
      viewerEl.value.scrollTop = pendingScrollTop;
    } else {
      viewerEl.value.scrollTop = 0;
    }
  });
}

function saveCurrentScroll() {
  if (currentFile.value && viewerEl.value) {
    saveScroll(currentFile.value, viewerEl.value.scrollTop);
  }
}

async function pickFile() {
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
    ],
  });
  if (typeof selected === "string") await loadFile(selected);
}

async function pickFolder() {
  const dir = await openFolder();
  if (dir) await startWatching(dir);
}

async function startWatching(dir: string) {
  await watcher.start(dir, async (paths) => {
    await refreshTree();
    if (currentFile.value && paths.includes(currentFile.value)) {
      await loadFile(currentFile.value);
    }
  });
}

function closeFolder() {
  void watcher.stop();
  clearRoot();
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  localStorage.setItem("md-reader-theme", theme.value);
  applyTheme();
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
}

async function exportHtml() {
  if (!bodyRef.value || !content.value) return;
  try {
    await exportToHtml(bodyRef.value, fileName.value || "document.html");
  } catch (e: any) {
    errorMsg.value = `导出失败: ${e?.message ?? e}`;
  }
}

async function exportDocx() {
  if (!bodyRef.value || !content.value) return;
  showExportMenu.value = false;
  exportBusy.value = true;
  exportToast.value = "正在生成 DOCX…";
  try {
    const out = await exportToDocx(
      bodyRef.value,
      fileName.value || "document",
      fileName.value
    );
    if (out) exportToast.value = `已导出 DOCX: ${out}`;
    else exportToast.value = "";
  } catch (e: any) {
    errorMsg.value = `导出 DOCX 失败: ${e?.message ?? e}`;
    exportToast.value = "";
  } finally {
    exportBusy.value = false;
  }
}

async function exportPdf() {
  if (!bodyRef.value || !content.value) return;
  showExportMenu.value = false;
  exportBusy.value = true;
  exportToast.value = "正在生成 PDF…";
  try {
    const result = await exportToPdf(
      bodyRef.value,
      fileName.value || "document",
      fileName.value,
      async () => {
        const picked = await open({
          title: "请选择 msedge.exe 路径",
          multiple: false,
          filters: [
            { name: "Edge / Chrome", extensions: ["exe"] },
            { name: "所有文件", extensions: ["*"] },
          ],
        });
        return typeof picked === "string" ? picked : null;
      }
    );
    if (result) {
      pdfEnginePath.value = result.edge_path;
      const sec = (result.elapsed_ms / 1000).toFixed(1);
      exportToast.value = `已导出 PDF (${sec}s): ${result.out_path}`;
    } else {
      exportToast.value = "";
    }
  } catch (e: any) {
    const msg = e?.message || (typeof e === "string" ? e : JSON.stringify(e));
    errorMsg.value = `导出 PDF 失败: ${msg}`;
    exportToast.value = "";
  } finally {
    exportBusy.value = false;
  }
}

function doPrint() {
  if (bodyRef.value) printDocument(bodyRef.value, fileName.value);
}

function onSearchOpen(path: string, _line: number) {
  void loadFile(path);
}

function onInternalLink(path: string, hash: string) {
  void loadFile(path, hash);
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "f" && !e.shiftKey) {
    e.preventDefault();
    find.open();
  } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    leftMode.value = "search";
    showFileTree.value = true;
  } else if (mod && e.key === ",") {
    e.preventDefault();
    showSettings.value = true;
  } else if (mod && e.key.toLowerCase() === "p") {
    e.preventDefault();
    doPrint();
  } else if (mod && e.key.toLowerCase() === "s") {
    e.preventDefault();
    void exportHtml();
  } else if (e.key === "Escape") {
    if (find.visible.value) find.close();
    else if (showSettings.value) showSettings.value = false;
  }
}

let scrollSaveTimer: number | null = null;
function onViewerScroll() {
  onScroll();
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = window.setTimeout(saveCurrentScroll, 400);
}

watch(showFileTree, (v) =>
  localStorage.setItem("md-reader-show-tree", v ? "1" : "0")
);
watch(showToc, (v) =>
  localStorage.setItem("md-reader-show-toc", v ? "1" : "0")
);

let unlistenDrop: (() => void) | null = null;
let unlistenOpen: (() => void) | null = null;

onMounted(async () => {
  applyTheme();
  applyReadingSettings();
  void checkPandoc().then((info) => (pandocInfo.value = info));
  void checkPdfEngine().then((p) => (pdfEnginePath.value = p));
  await restoreRoot();
  if (rootDir.value) await startWatching(rootDir.value);

  // Listen for file-open events fired by Rust (file association / single-instance).
  try {
    const { listen } = await import("@tauri-apps/api/event");
    unlistenOpen = await listen<string>("md-reader://open-file", async (e) => {
      const path = e.payload;
      if (typeof path === "string" && path) {
        await loadFile(path);
      }
    });
  } catch (e) {
    console.warn("listen open-file unavailable", e);
  }

  const last = localStorage.getItem("md-reader-last-file");
  if (last && !currentFile.value) {
    try {
      await loadFile(last);
    } catch {
      /* ignore */
    }
  }
  try {
    const webview = getCurrentWebview();
    unlistenDrop = await webview.onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const target = paths.find((p) =>
            /\.(md|markdown|mdx|txt)$/i.test(p)
          );
          if (target) await loadFile(target);
        }
      }
    });
  } catch (e) {
    console.warn("drag-drop unavailable", e);
  }
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  unlistenDrop?.();
  unlistenOpen?.();
  void watcher.stop();
  window.removeEventListener("keydown", onKeydown);
});

watch(currentFile, (v) => {
  if (v) localStorage.setItem("md-reader-last-file", v);
});

watch(exportToast, (v) => {
  if (v) {
    window.setTimeout(() => {
      exportToast.value = "";
    }, 3500);
  }
});
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <button class="btn" @click="pickFile" title="打开 .md 文件">文件</button>
      <button class="btn" @click="pickFolder" title="打开文件夹">文件夹</button>
      <button
        v-if="rootDir"
        class="btn"
        @click="refreshTree"
        :disabled="treeLoading"
        title="刷新"
      >
        ↻
      </button>
      <button
        v-if="rootDir"
        class="btn"
        @click="closeFolder"
        title="关闭文件夹"
      >
        ✕
      </button>
      <div class="filename" :title="currentFile">{{ fileName }}</div>
      <button
        class="btn icon"
        @click="find.open()"
        title="查找 (Ctrl+F)"
        :disabled="!content"
      >
        🔍
      </button>
      <div class="export-wrap">
        <button
          class="btn icon"
          @click="showExportMenu = !showExportMenu"
          :disabled="!content || exportBusy"
          :title="exportBusy ? '导出中…' : '导出 (Ctrl+S 快捷)'"
        >
          {{ exportBusy ? "⏳" : "⤓" }}
        </button>
        <div v-if="showExportMenu" class="export-menu" @click.stop>
          <button class="menu-item" @click="exportHtml(); showExportMenu = false">
            <span class="mi-label">导出 HTML</span>
            <span class="mi-hint">自包含 · 含图片/公式/图表</span>
          </button>
          <button
            class="menu-item"
            :disabled="!pandocInfo?.available"
            @click="exportDocx"
            :title="!pandocInfo?.available ? '未检测到 pandoc' : ''"
          >
            <span class="mi-label">导出 DOCX</span>
            <span class="mi-hint">
              {{ pandocInfo?.available ? "Word 文档" : "需要 pandoc" }}
            </span>
          </button>
          <button
            class="menu-item"
            @click="exportPdf"
            :title="
              pdfEnginePath
                ? '使用 ' + pdfEnginePath
                : '将在导出时让你手动指定 Edge 路径'
            "
          >
            <span class="mi-label">导出 PDF</span>
            <span class="mi-hint">
              {{
                pdfEnginePath
                  ? "Edge headless · 所见即所得"
                  : "未检测到 Edge（导出时可指定）"
              }}
            </span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="doPrint(); showExportMenu = false">
            <span class="mi-label">打印 / 系统 PDF</span>
            <span class="mi-hint">浏览器打印对话框</span>
          </button>
        </div>
      </div>
      <button
        class="btn icon"
        @click="showSettings = true"
        title="阅读设置 (Ctrl+,)"
      >
        ⚙
      </button>
      <button
        class="btn icon"
        @click="showFileTree = !showFileTree"
        :title="showFileTree ? '隐藏侧栏' : '显示侧栏'"
      >
        ☰
      </button>
      <button
        class="btn icon"
        @click="showToc = !showToc"
        :title="showToc ? '隐藏大纲' : '显示大纲'"
      >
        ≡
      </button>
      <button class="btn icon" @click="toggleTheme" title="切换主题">
        {{ theme === "light" ? "🌙" : "☀️" }}
      </button>
    </header>

    <main class="layout">
      <aside
        v-if="showFileTree"
        class="left"
        :style="{ width: leftWidth + 'px' }"
      >
        <div class="panel-tabs">
          <button
            class="tab"
            :class="{ active: leftMode === 'files' }"
            @click="leftMode = 'files'"
          >
            文件
          </button>
          <button
            class="tab"
            :class="{ active: leftMode === 'search' }"
            @click="leftMode = 'search'"
            title="全文搜索 (Ctrl+Shift+F)"
          >
            搜索
          </button>
        </div>
        <div v-if="leftMode === 'files'" class="panel-body">
          <div class="panel-header">
            <span>{{ rootDir ? "文件" : "未打开文件夹" }}</span>
            <span v-if="treeLoading" class="muted">…</span>
          </div>
          <div v-if="treeError" class="panel-error">{{ treeError }}</div>
          <div class="tree-scroll">
            <FileTree
              v-if="rootDir"
              :nodes="tree"
              :current-path="currentFile"
              @open="loadFile"
            />
            <div v-else class="empty-tip">
              点击「文件夹」<br />打开目录浏览所有 md 文件
            </div>
          </div>
        </div>
        <div v-else class="panel-body">
          <SearchPanel
            :visible="true"
            :root-dir="rootDir"
            @close="leftMode = 'files'"
            @open="onSearchOpen"
          />
        </div>
      </aside>

      <div
        v-if="showFileTree"
        class="resizer"
        @pointerdown="resizeLeft"
      ></div>

      <section
        ref="viewerEl"
        class="viewer"
        @scroll.passive="onViewerScroll"
      >
        <FindBar
          :visible="find.visible.value"
          :query="find.query.value"
          :case-sensitive="find.caseSensitive.value"
          :total="find.total.value"
          :active-index="find.activeIndex.value"
          @update:query="(v) => (find.query.value = v)"
          @update:case-sensitive="(v) => (find.caseSensitive.value = v)"
          @search="find.search"
          @next="find.next"
          @prev="find.prev"
          @close="find.close"
        />
        <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
        <div v-else-if="!content" class="empty">
          <div class="empty-title">MD Reader</div>
          <div class="empty-hint">
            点击「文件」或「文件夹」开始<br />也可将 .md 文件拖入此窗口
          </div>
          <div class="shortcut-hint">
            Ctrl+F 查找 · Ctrl+Shift+F 全文搜索 · Ctrl+, 设置
          </div>
        </div>
        <MarkdownView
          v-else
          ref="markdownRef"
          :source="content"
          :current-file="currentFile"
          :root-dir="rootDir"
          @rendered="onRendered"
          @internal-link="onInternalLink"
        />
      </section>

      <div v-if="showToc" class="resizer" @pointerdown="resizeRight"></div>

      <aside
        v-if="showToc"
        class="right"
        :style="{ width: rightWidth + 'px' }"
      >
        <TocPanel
          :headings="headings"
          :active-id="activeId"
          @jump="jumpTo"
        />
      </aside>
    </main>

    <SettingsDialog
      :visible="showSettings"
      @close="showSettings = false"
    />

    <div v-if="exportToast" class="toast" @click="exportToast = ''">
      ✓ {{ exportToast }}
    </div>
    <div
      v-if="showExportMenu"
      class="menu-overlay"
      @click="showExportMenu = false"
    ></div>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
  user-select: none;
}
.filename {
  flex: 1 1 auto;
  font-size: 13px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0 8px;
}
.btn {
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg);
  cursor: pointer;
}
.btn:hover {
  background: var(--bg-btn-hover);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.icon {
  padding: 4px 8px;
  font-size: 14px;
  line-height: 1;
}
.layout {
  flex: 1 1 auto;
  display: flex;
  min-height: 0;
}
.left,
.right {
  flex: 0 0 auto;
  background: var(--bg-toolbar);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  min-width: 160px;
  overflow: hidden;
}
.right {
  border-right: none;
  border-left: 1px solid var(--border);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--border);
}
.panel-error {
  padding: 8px 12px;
  font-size: 12px;
  color: #c00;
  background: rgba(255, 0, 0, 0.06);
}
.tree-scroll {
  flex: 1 1 auto;
  overflow: auto;
}
.empty-tip {
  padding: 16px 12px;
  font-size: 12px;
  color: var(--fg-muted);
  line-height: 1.7;
}
.muted {
  color: var(--fg-muted);
}
.resizer {
  flex: 0 0 4px;
  cursor: col-resize;
  background: transparent;
  position: relative;
}
.resizer:hover {
  background: var(--link);
  opacity: 0.4;
}
.viewer {
  flex: 1 1 auto;
  overflow: auto;
  background: var(--bg);
  min-width: 0;
  position: relative;
}
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--fg-muted);
}
.empty-title {
  font-size: 28px;
  font-weight: 600;
}
.empty-hint {
  font-size: 14px;
  text-align: center;
}
.shortcut-hint {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 8px;
}
.panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  background: var(--bg-toolbar);
}
.tab {
  flex: 1;
  padding: 6px 0;
  font-size: 12px;
  background: transparent;
  color: var(--fg-muted);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.tab:hover {
  color: var(--fg);
}
.tab.active {
  color: var(--link);
  border-bottom-color: var(--link);
}
.panel-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.export-wrap {
  position: relative;
}
.export-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  min-width: 260px;
  padding: 4px;
  z-index: 30;
}
.menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--fg);
  cursor: pointer;
  text-align: left;
}
.menu-item:hover:not(:disabled) {
  background: var(--bg-btn-hover);
}
.menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mi-label {
  font-size: 13px;
  font-weight: 500;
}
.mi-hint {
  font-size: 11px;
  color: var(--fg-muted);
}
.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  background: rgba(35, 134, 54, 0.95);
  color: #fff;
  border-radius: 8px;
  font-size: 13px;
  z-index: 40;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  cursor: pointer;
  max-width: 70%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
:global(:root[data-theme="dark"]) .toolbar {
  flex-basis: 42px;
  border-bottom-color: var(--mdr-panel-line);
  background: linear-gradient(180deg, var(--mdr-panel-soft), var(--mdr-panel));
}
:global(:root[data-theme="dark"]) .filename {
  color: var(--mdr-panel-muted);
}
:global(:root[data-theme="dark"]) .btn {
  border-color: var(--mdr-panel-line);
  background: var(--mdr-panel-soft);
  color: #e7edf6;
  min-height: 28px;
}
:global(:root[data-theme="dark"]) .btn:hover {
  background: var(--mdr-panel-raised);
  border-color: color-mix(in srgb, var(--mdr-accent-gold) 60%, var(--mdr-panel-line));
}
:global(:root[data-theme="dark"]) .export-wrap .btn {
  border-color: color-mix(in srgb, var(--mdr-accent-gold) 70%, var(--mdr-panel-line));
  background: color-mix(in srgb, var(--mdr-accent-gold) 18%, var(--mdr-panel-soft));
}
:global(:root[data-theme="dark"]) .left,
:global(:root[data-theme="dark"]) .right {
  background: var(--mdr-panel);
  border-right-color: var(--mdr-panel-line);
}
:global(:root[data-theme="dark"]) .right {
  background: var(--mdr-paper-soft);
  border-left-color: var(--border);
}
:global(:root[data-theme="dark"]) .panel-header {
  color: var(--mdr-panel-muted);
  border-bottom-color: var(--mdr-panel-line);
}
:global(:root[data-theme="dark"]) .right .panel-header {
  color: var(--fg-muted);
  border-bottom-color: var(--border);
}
:global(:root[data-theme="dark"]) .viewer {
  background: var(--mdr-paper-soft);
}
:global(:root[data-theme="dark"]) .panel-tabs {
  border-bottom-color: var(--mdr-panel-line);
  background: var(--mdr-panel);
}
:global(:root[data-theme="dark"]) .tab {
  padding: 7px 0 6px;
  color: var(--mdr-panel-muted);
}
:global(:root[data-theme="dark"]) .tab:hover {
  color: #e7edf6;
  background: var(--mdr-panel-soft);
}
:global(:root[data-theme="dark"]) .tab.active {
  color: var(--mdr-accent-gold);
  border-bottom-color: var(--mdr-accent-gold);
  background: color-mix(in srgb, var(--mdr-accent-gold) 10%, transparent);
}
:global(:root[data-theme="dark"]) .export-menu {
  min-width: 320px;
  padding: 6px;
  margin-top: 6px;
  background: var(--mdr-paper);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.24);
}
:global(:root[data-theme="dark"]) .menu-item {
  gap: 3px;
  padding: 9px 12px;
}
:global(:root[data-theme="dark"]) .menu-item:hover:not(:disabled) {
  background: color-mix(in srgb, var(--mdr-accent-gold) 12%, transparent);
}
:global(:root[data-theme="dark"]) .mi-label {
  font-weight: 600;
}
.error {
  margin: 24px;
  padding: 12px 16px;
  border-radius: 6px;
  background: #fee;
  color: #c00;
  border: 1px solid #fcc;
}
</style>