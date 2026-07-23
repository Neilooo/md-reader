<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { persistLocale, type AppLocale } from "./i18n";
import MarkdownView from "./components/MarkdownView.vue";
import FileTree from "./components/FileTree.vue";
import TocPanel from "./components/TocPanel.vue";
import FindBar from "./components/FindBar.vue";
import SearchPanel from "./components/SearchPanel.vue";
import SettingsDialog from "./components/SettingsDialog.vue";
import MarkdownEditor from "./components/MarkdownEditor.vue";
import UnsavedChangesDialog from "./components/UnsavedChangesDialog.vue";
import TabBar from "./components/TabBar.vue";
import { useFileTree } from "./composables/useFileTree";
import { useFileWatcher } from "./composables/useFileWatcher";
import { extractHeadings } from "./composables/useMarkdown";
import { useResizable } from "./composables/useResizable";
import { useScrollSpy } from "./composables/useScrollSpy";
import { useFindInPage } from "./composables/useFindInPage";
import { useHistory, type RecentItem } from "./composables/useHistory";
import { useReadingSettings } from "./composables/useReadingSettings";
import { useShortcuts } from "./composables/useShortcuts";
import { useTabs, samePath, type Tab } from "./composables/useTabs";
import {
  exportToHtml,
  exportToDocx,
  exportToPdf,
  checkPandoc,
  checkPdfEngine,
  printDocument,
  type PandocInfo,
} from "./composables/useExport";

const { t, locale } = useI18n();

function toggleLocale() {
  const next = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  locale.value = next;
  persistLocale(next as AppLocale);
}

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
const { recent, pushRecent, clearRecent, saveScroll, getScroll } = useHistory();
const {
  apply: applyReadingSettings,
  settings: readingSettings,
  setFontSize,
  setEditorFontSize,
} = useReadingSettings();
const { getBinding, normalizeEvent, formatBinding } = useShortcuts();
function shortcutSuffix(id: string): string {
  return " (" + formatBinding(getBinding(id)) + ")";
}
const {
  tabs,
  activeTabId,
  activeTab,
  findTabByPath,
  createTab,
  activateTab,
  removeTab,
  persist,
  loadPersisted,
} = useTabs();

const errorMsg = ref<string>("");
const saving = ref(false);
const editorRef = ref<{
  focus: () => void;
  openSearch: () => void;
  openReplace: () => void;
  goToLine: () => void;
  getTopVisibleLine: () => number;
  scrollToLine: (line: number) => void;
} | null>(null);

type UnsavedChoice = "save" | "discard" | "cancel";
type UnsavedDialogMode = "unsaved" | "external";
const showUnsavedDialog = ref(false);
const unsavedDialogMode = ref<UnsavedDialogMode>("unsaved");
const dialogTab = ref<Tab | null>(null);
let unsavedResolve: ((choice: UnsavedChoice) => void) | null = null;

const suppressed = new Set<string>();
function addSuppress(p: string) {
  suppressed.add(p.replace(/\\/g, "/").toLowerCase());
}
function isSuppressed(p: string): boolean {
  return suppressed.has(p.replace(/\\/g, "/").toLowerCase());
}
function clearSuppress(p: string) {
  suppressed.delete(p.replace(/\\/g, "/").toLowerCase());
}
function scheduleSuppressClear(p: string) {
  window.setTimeout(() => clearSuppress(p), 1000);
}

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
const leftMode = ref<"files" | "search" | "outline">("files");
const tocOnLeft = computed(() => readingSettings.value.tocPosition === "left");
const showExportMenu = ref(false);
const exportBusy = ref(false);
const exportToast = ref("");
const pandocInfo = ref<PandocInfo | null>(null);
const pdfEnginePath = ref<string | null>(null);
const renderTick = ref(0);

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

const currentFile = computed(() => activeTab.value?.path ?? "");
const draftContent = computed(() => activeTab.value?.draftContent ?? "");
const isDirty = computed(() => activeTab.value?.isDirty ?? false);
const isEditing = computed(() => activeTab.value?.isEditing ?? false);
const headings = computed(() => activeTab.value?.headings ?? []);

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

const fileName = computed(() => {
  if (!currentFile.value) return t("app.noFile");
  return basename(currentFile.value);
});
const displayFileName = computed(() =>
  isDirty.value ? `${fileName.value} *` : fileName.value
);
const canExport = computed(() => Boolean(activeTab.value?.draftContent));
const hasActiveFile = computed(() => Boolean(activeTab.value?.path));
const dialogFileName = computed(() =>
  dialogTab.value ? basename(dialogTab.value.path) : ""
);
const unsavedDialogTitle = computed(() =>
  unsavedDialogMode.value === "external"
    ? t("editor.externalChangedTitle")
    : t("editor.unsavedTitle")
);
const unsavedDialogMessage = computed(() =>
  unsavedDialogMode.value === "external"
    ? t("editor.externalChangedMessage")
    : t("editor.unsavedMessage")
);

let headingTimer: number | null = null;
let appWindow: import("@tauri-apps/api/window").Window | null = null;

function askUnsaved(tab: Tab, mode: UnsavedDialogMode): Promise<UnsavedChoice> {
  if (unsavedResolve) {
    // A dialog is already in flight; don't clobber its resolver.
    return Promise.resolve("cancel");
  }
  return new Promise((resolve) => {
    dialogTab.value = tab;
    unsavedDialogMode.value = mode;
    unsavedResolve = resolve;
    showUnsavedDialog.value = true;
  });
}

function resolveDialog(choice: UnsavedChoice) {
  showUnsavedDialog.value = false;
  const resolve = unsavedResolve;
  unsavedResolve = null;
  dialogTab.value = null;
  resolve?.(choice);
}

async function readFileIntoTab(tab: Tab, path: string, hash = "") {
  const text = await readTextFile(path);
  tab.path = path;
  tab.content = text;
  tab.draftContent = text;
  tab.isDirty = false;
  tab.isEditing = false;
  tab.headings = extractHeadings(text);
  tab.pendingHash = hash;
  tab.pendingScrollTop = hash ? 0 : getScroll(path);
  tab.pendingSourceLine = 0;
  tab.scrollTop = tab.pendingScrollTop;
  pushRecent(path);
  errorMsg.value = "";
}

async function loadFile(path: string, hash = "") {
  const existing = findTabByPath(path);
  if (existing) {
    saveCurrentScroll();
    if (hash) {
      existing.pendingHash = hash;
      existing.pendingScrollTop = 0;
      existing.pendingSourceLine = 0;
    } else {
      existing.pendingHash = "";
      existing.pendingScrollTop = existing.scrollTop;
      existing.pendingSourceLine = 0;
    }
    activateTab(existing.id);
    return;
  }
  saveCurrentScroll();
  const tab = createTab(path);
  try {
    await readFileIntoTab(tab, path, hash);
  } catch (e: any) {
    errorMsg.value = `${t("errors.readFailed")}: ${e?.message || e}`;
    return;
  }
  tabs.value.push(tab);
  activateTab(tab.id);
}

async function forceReloadTab(tab: Tab) {
  try {
    const text = await readTextFile(tab.path);
    tab.content = text;
    tab.draftContent = text;
    tab.isDirty = false;
    tab.headings = extractHeadings(text);
    if (tab.id === activeTabId.value) {
      tab.pendingHash = "";
      tab.pendingScrollTop = tab.scrollTop;
      tab.pendingSourceLine = 0;
      find.clearHighlights();
    }
  } catch (e: any) {
    errorMsg.value = `${t("errors.readFailed")}: ${e?.message || e}`;
  }
}

function switchToTab(id: string) {
  if (id === activeTabId.value) return;
  saveCurrentScroll();
  const tab = tabs.value.find((x) => x.id === id);
  if (!tab) return;
  tab.pendingHash = "";
  tab.pendingScrollTop = tab.scrollTop;
  tab.pendingSourceLine = 0;
  activateTab(id);
}

async function handleRefresh() {
  saveCurrentScroll();
  if (isEditing.value && editorRef.value && activeTab.value) {
    activeTab.value.pendingSourceLine = editorRef.value.getTopVisibleLine();
  }
  if (activeTab.value?.path) {
    addSuppress(activeTab.value.path);
  }
  await refreshTree();
  if (activeTab.value?.path) {
    scheduleSuppressClear(activeTab.value.path);
  }
}

async function saveTab(tab: Tab): Promise<boolean> {
  if (!tab.path || saving.value) return false;
  saving.value = true;
  try {
    addSuppress(tab.path);
    await writeTextFile(tab.path, tab.draftContent);
    tab.content = tab.draftContent;
    tab.isDirty = false;
    tab.headings = extractHeadings(tab.draftContent);
    exportToast.value = t("editor.saved");
    await refreshTree();
    scheduleSuppressClear(tab.path);
    return true;
  } catch (e: any) {
    clearSuppress(tab.path);
    errorMsg.value = `${t("editor.saveFailed")}: ${e?.message ?? e}`;
    return false;
  } finally {
    saving.value = false;
  }
}

async function saveCurrentFile(): Promise<boolean> {
  const tab = activeTab.value;
  if (!tab) return false;
  return saveTab(tab);
}

async function saveAsCurrentFile(): Promise<boolean> {
  const tab = activeTab.value;
  if (!tab || saving.value) return false;
  const dest = await save({
    title: t("editor.saveAs"),
    defaultPath: fileName.value.replace(/\.[^.]+$/, "") + ".md",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
    ],
  });
  if (!dest) return false;
  saving.value = true;
  try {
    addSuppress(dest);
    await writeTextFile(dest, tab.draftContent);
    tab.content = tab.draftContent;
    tab.path = dest;
    tab.isDirty = false;
    tab.headings = extractHeadings(tab.draftContent);
    pushRecent(dest);
    exportToast.value = `${t("editor.saved")}: ${dest}`;
    await refreshTree();
    scheduleSuppressClear(dest);
    persist();
    return true;
  } catch (e: any) {
    clearSuppress(dest);
    errorMsg.value = `${t("editor.saveFailed")}: ${e?.message ?? e}`;
    return false;
  } finally {
    saving.value = false;
  }
}

async function closeTab(id: string) {
  const tab = tabs.value.find((x) => x.id === id);
  if (!tab) return;
  if (tab.isDirty) {
    if (id !== activeTabId.value) switchToTab(id);
    const choice = await askUnsaved(tab, "unsaved");
    if (choice === "cancel") return;
    if (choice === "save") {
      const ok = await saveTab(tab);
      if (!ok) return;
    }
  }
  removeTab(id);
}

async function confirmCloseAll(): Promise<boolean> {
  for (const tab of tabs.value.filter((x) => x.isDirty)) {
    activateTab(tab.id);
    const choice = await askUnsaved(tab, "unsaved");
    if (choice === "cancel") return false;
    if (choice === "save") {
      const ok = await saveTab(tab);
      if (!ok) return false;
    } else {
      tab.isDirty = false;
    }
  }
  return true;
}

function onDialogSave() {
  resolveDialog("save");
}
function onDialogDiscard() {
  resolveDialog("discard");
}
function onDialogCancel() {
  resolveDialog("cancel");
}

function getPreviewTopSourceLine(): number {
  const container = viewerEl.value;
  const body = bodyRef.value;
  if (!container || !body) return 1;
  const containerTop = container.getBoundingClientRect().top;
  const items = Array.from(
    body.querySelectorAll<HTMLElement>("[data-source-line]")
  );
  let current = 1;
  for (const item of items) {
    const line = Number(item.dataset.sourceLine || "0");
    if (!line) continue;
    const top = item.getBoundingClientRect().top - containerTop;
    if (top <= 16) {
      current = line;
    } else {
      return current === 1 ? line : current;
    }
  }
  return current;
}

function scrollPreviewToSourceLine(line: number) {
  const container = viewerEl.value;
  const body = bodyRef.value;
  if (!container || !body) return;
  const items = Array.from(
    body.querySelectorAll<HTMLElement>("[data-source-line]")
  );
  let target = items[0] ?? null;
  let targetLine = 0;
  for (const item of items) {
    const itemLine = Number(item.dataset.sourceLine || "0");
    if (!itemLine) continue;
    if (itemLine <= line && itemLine >= targetLine) {
      target = item;
      targetLine = itemLine;
    }
  }
  if (!target) return;
  container.scrollTop +=
    target.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    8;
}

function toggleEditorMode() {
  const tab = activeTab.value;
  if (!tab) return;
  if (tab.isEditing) {
    tab.pendingSourceLine = editorRef.value?.getTopVisibleLine() ?? 1;
    tab.pendingScrollTop = 0;
    tab.isEditing = false;
    find.reset();
    return;
  }
  const line = getPreviewTopSourceLine();
  tab.pendingSourceLine = 0;
  tab.isEditing = true;
  find.close();
  nextTick(() => editorRef.value?.scrollToLine(line));
}

function onRendered() {
  nextTick(() => {
    const tab = activeTab.value;
    if (!viewerEl.value || !tab) return;
    if (tab.pendingHash) {
      jumpTo(tab.pendingHash);
      tab.pendingHash = "";
    } else if (tab.pendingSourceLine > 0) {
      scrollPreviewToSourceLine(tab.pendingSourceLine);
      tab.pendingSourceLine = 0;
    } else if (tab.pendingScrollTop > 0) {
      viewerEl.value.scrollTop = tab.pendingScrollTop;
    } else {
      viewerEl.value.scrollTop = 0;
    }
  });
}

function saveCurrentScroll() {
  const tab = activeTab.value;
  if (tab && tab.path && viewerEl.value && !tab.isEditing) {
    tab.scrollTop = viewerEl.value.scrollTop;
    saveScroll(tab.path, viewerEl.value.scrollTop);
  }
}

function withMarkdownExtension(path: string): string {
  return /\.(md|markdown|mdx|txt)$/i.test(path) ? path : `${path}.md`;
}

async function createNewFile() {
  const dest = await save({
    title: t("editor.newFile"),
    defaultPath: "untitled.md",
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
    ],
  });
  if (!dest) return;
  const path = withMarkdownExtension(dest);
  saving.value = true;
  try {
    addSuppress(path);
    await writeTextFile(path, "");
    saveCurrentScroll();
    let tab = findTabByPath(path);
    if (!tab) {
      tab = createTab(path);
      tabs.value.push(tab);
    }
    tab.path = path;
    tab.content = "";
    tab.draftContent = "";
    tab.isDirty = false;
    tab.isEditing = true;
    tab.headings = [];
    tab.pendingHash = "";
    tab.pendingScrollTop = 0;
    tab.pendingSourceLine = 0;
    tab.scrollTop = 0;
    pushRecent(path);
    activateTab(tab.id);
    errorMsg.value = "";
    exportToast.value = `${t("editor.created")}: ${path}`;
    await refreshTree();
    scheduleSuppressClear(path);
    persist();
    await nextTick();
    editorRef.value?.focus();
  } catch (e: any) {
    clearSuppress(path);
    errorMsg.value = `${t("editor.createFailed")}: ${e?.message ?? e}`;
  } finally {
    saving.value = false;
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
    window.setTimeout(() => {
      void onFilesChanged(paths);
    }, 150);
  });
}

async function onFilesChanged(paths: string[]) {
  for (const tab of [...tabs.value]) {
    if (!paths.some((p) => samePath(p, tab.path))) continue;
    if (isSuppressed(tab.path)) {
      clearSuppress(tab.path);
      continue;
    }
    if (!tab.isDirty) {
      await forceReloadTab(tab);
    } else {
      if (showUnsavedDialog.value) return;
      activateTab(tab.id);
      const choice = await askUnsaved(tab, "external");
      if (choice === "save") await forceReloadTab(tab);
    }
  }
}

function closeFolder() {
  void watcher.stop();
  clearRoot();
}

async function getInitialOpenFile(): Promise<string> {
  try {
    const path = await invoke<string | null>("initial_open_file");
    return typeof path === "string" ? path : "";
  } catch {
    return "";
  }
}

async function restoreTabs(initialPath = "") {
  const persisted = loadPersisted();
  let paths: string[] = [];
  let activePath = "";
  if (persisted && persisted.paths.length) {
    paths = persisted.paths;
    activePath = persisted.activePath;
  } else {
    const last = localStorage.getItem("md-reader-last-file");
    if (last) {
      paths = [last];
      activePath = last;
    }
  }
  let activeId = "";
  for (const path of paths) {
    if (findTabByPath(path)) continue;
    const tab = createTab(path);
    try {
      await readFileIntoTab(tab, path);
    } catch {
      continue;
    }
    tabs.value.push(tab);
    if (samePath(path, activePath)) activeId = tab.id;
  }
  if (!activeId && tabs.value.length) activeId = tabs.value[0].id;
  if (activeId) activateTab(activeId);
  if (initialPath) await loadFile(initialPath);
}

function toggleTheme() {
  theme.value = theme.value === "light" ? "dark" : "light";
  localStorage.setItem("md-reader-theme", theme.value);
  applyTheme();
  // Force Mermaid/KaTeX re-render so charts follow the new theme.
  renderTick.value++;
}

function applyTheme() {
  document.documentElement.dataset.theme = theme.value;
  void invoke("set_app_theme", { theme: theme.value }).catch(() => {
    /* ignore in non-Tauri environments */
  });
}

async function exportHtml() {
  showExportMenu.value = false;
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (!bodyRef.value || !draftContent.value) return;
  try {
    await exportToHtml(
      bodyRef.value,
      fileName.value || "document.html",
      currentFile.value || undefined
    );
  } catch (e: any) {
    errorMsg.value = `${t("export.exportFailed")}: ${e?.message ?? e}`;
  }
}

async function exportDocx() {
  showExportMenu.value = false;
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (!bodyRef.value || !draftContent.value) return;
  exportBusy.value = true;
  exportToast.value = t("export.generatingDocx");
  try {
    const out = await exportToDocx(
      bodyRef.value,
      fileName.value || "document",
      displayFileName.value,
      currentFile.value || undefined
    );
    if (out) exportToast.value = `${t("export.exportedDocx")}: ${out}`;
    else exportToast.value = "";
  } catch (e: any) {
    errorMsg.value = `${t("export.docxFailed")}: ${e?.message ?? e}`;
    exportToast.value = "";
  } finally {
    exportBusy.value = false;
  }
}

async function exportPdf() {
  showExportMenu.value = false;
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (!bodyRef.value || !draftContent.value) return;
  exportBusy.value = true;
  exportToast.value = t("export.generatingPdf");
  try {
    const result = await exportToPdf(
      bodyRef.value,
      fileName.value || "document",
      displayFileName.value,
      currentFile.value || undefined,
      async () => {
        const picked = await open({
          title: t("export.chooseEdgePath"),
          multiple: false,
          filters: [
            { name: "Edge / Chrome", extensions: ["exe"] },
            { name: t("app.allFiles"), extensions: ["*"] },
          ],
        });
        return typeof picked === "string" ? picked : null;
      }
    );
    if (result) {
      pdfEnginePath.value = result.edge_path;
      const sec = (result.elapsed_ms / 1000).toFixed(1);
      exportToast.value = `${t("export.exportedPdf")} (${sec}s): ${result.out_path}`;
    } else {
      exportToast.value = "";
    }
  } catch (e: any) {
    const msg = e?.message || (typeof e === "string" ? e : JSON.stringify(e));
    errorMsg.value = `${t("export.pdfFailed")}: ${msg}`;
    exportToast.value = "";
  } finally {
    exportBusy.value = false;
  }
}

function doPrint() {
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (bodyRef.value) printDocument(bodyRef.value, fileName.value);
}

function onSearchOpen(path: string, _line: number) {
  void loadFile(path);
}

function onInternalLink(path: string, hash: string) {
  void loadFile(path, hash);
}

function onDraftUpdate(value: string) {
  const tab = activeTab.value;
  if (!tab) return;
  tab.draftContent = value;
  tab.isDirty = value !== tab.content;
  if (headingTimer) clearTimeout(headingTimer);
  headingTimer = window.setTimeout(() => {
    tab.headings = extractHeadings(value);
  }, 200);
}

function dirOf(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i < 0 ? "" : normalized.slice(0, i);
}

const recentFiltered = ref<RecentItem[]>([]);

async function refreshRecent() {
  const items = recent.value.slice(0, 10);
  const checks = await Promise.all(
    items.map(async (item) => ({
      item,
      ok: await exists(item.path).catch(() => false),
    }))
  );
  recentFiltered.value = checks.filter((c) => c.ok).map((c) => c.item);
}

function zoomFont(delta: number) {
  if (isEditing.value)
    setEditorFontSize(readingSettings.value.editorFontSize + delta);
  else setFontSize(readingSettings.value.fontSize + delta);
}

function resetFont() {
  if (isEditing.value) setEditorFontSize(14);
  else setFontSize(16);
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  e.preventDefault();
  zoomFont(e.deltaY < 0 ? 1 : -1);
}

function onKeydown(e: KeyboardEvent) {
  const mod = e.ctrlKey || e.metaKey;
  if (showUnsavedDialog.value) {
    if (e.key === "Escape") onDialogCancel();
    return;
  }
  if (e.defaultPrevented) return;

  if (e.key === "Escape") {
    if (find.visible.value) find.close();
    else if (showSettings.value) showSettings.value = false;
    return;
  }

  if (!mod) return;
  const combo = normalizeEvent(e);
  const isEdit = isEditing.value;

  if (combo === getBinding("toggle-mode")) {
    e.preventDefault();
    toggleEditorMode();
  } else if (combo === getBinding("new-file")) {
    e.preventDefault();
    void createNewFile();
  } else if (combo === getBinding("open-file")) {
    e.preventDefault();
    void pickFile();
  } else if (combo === getBinding("search-panel")) {
    e.preventDefault();
    leftMode.value = "search";
    showFileTree.value = true;
  } else if (combo === getBinding("save-as")) {
    e.preventDefault();
    void saveAsCurrentFile();
  } else if (combo === getBinding("settings")) {
    e.preventDefault();
    showSettings.value = true;
  } else if (combo === getBinding("print")) {
    e.preventDefault();
    doPrint();
  } else if (combo === getBinding("save")) {
    e.preventDefault();
    void saveCurrentFile();
  } else if (combo === getBinding("zoom-in")) {
    e.preventDefault();
    zoomFont(1);
  } else if (combo === getBinding("zoom-out")) {
    e.preventDefault();
    zoomFont(-1);
  } else if (combo === getBinding("zoom-reset")) {
    e.preventDefault();
    resetFont();
  } else if (isEdit && combo === getBinding("find")) {
    e.preventDefault();
    editorRef.value?.openSearch();
  } else if (isEdit && combo === getBinding("replace")) {
    e.preventDefault();
    editorRef.value?.openReplace();
  } else if (isEdit && combo === getBinding("go-to-line")) {
    e.preventDefault();
    editorRef.value?.goToLine();
  } else if (!isEdit && combo === getBinding("find")) {
    e.preventDefault();
    find.open();
  }
}

let scrollSaveTimer: number | null = null;
function onViewerScroll() {
  if (isEditing.value) return;
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

watch(isEditing, (editing) => {
  if (editing) {
    markdownRef.value = null;
    return;
  }
  nextTick(onScroll);
});

watch(activeTabId, () => {
  errorMsg.value = "";
  find.close();
  find.clearHighlights();
  if (!activeTab.value?.isEditing) nextTick(onScroll);
});

let unlistenDrop: (() => void) | null = null;
let unlistenOpen: (() => void) | null = null;
let unlistenClose: (() => void) | null = null;

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

  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    appWindow = getCurrentWindow();
    unlistenClose = await appWindow.onCloseRequested(async (event) => {
      if (!tabs.value.some((tb) => tb.isDirty)) {
        // No unsaved changes: let the default close proceed.
        return;
      }
      event.preventDefault();
      const ok = await confirmCloseAll();
      if (ok) await appWindow!.destroy();
    });
  } catch (e) {
    console.warn("close listener unavailable", e);
  }

  const initialPath = await getInitialOpenFile();
  await restoreTabs(initialPath);
  try {
    const webview = getCurrentWebview();
    unlistenDrop = await webview.onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        const paths = event.payload.paths;
        if (paths && paths.length > 0) {
          const target = paths.find((p) => /\.(md|markdown|mdx|txt)$/i.test(p));
          if (target) await loadFile(target);
        }
      }
    });
  } catch (e) {
    console.warn("drag-drop unavailable", e);
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("wheel", onWheel, { passive: false });
  void refreshRecent();
});

onUnmounted(() => {
  unlistenDrop?.();
  unlistenOpen?.();
  unlistenClose?.();
  if (headingTimer) clearTimeout(headingTimer);
  void watcher.stop();
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("wheel", onWheel);
});

watch(
  () => tabs.value.map((tb) => tb.path).join("\n"),
  () => persist()
);

watch(exportToast, (v) => {
  if (v) {
    window.setTimeout(() => {
      exportToast.value = "";
    }, 3500);
  }
});

watch(errorMsg, (v) => {
  if (v) {
    window.setTimeout(() => {
      errorMsg.value = "";
    }, 5000);
  }
});

watch(hasActiveFile, (v) => {
  if (!v) void refreshRecent();
});

watch(
  () => readingSettings.value.tocPosition,
  (pos) => {
    if (pos === "right" && leftMode.value === "outline") {
      leftMode.value = "files";
    }
  }
);
</script>

<template>
  <div class="app">
    <header class="toolbar">
      <button
        class="btn"
        @click="createNewFile"
        :title="t('toolbar.new') + shortcutSuffix('new-file')"
      >
        {{ t("toolbar.new") }}
      </button>
      <button
        class="btn"
        @click="pickFile"
        :title="t('app.file') + shortcutSuffix('open-file')"
      >
        {{ t("app.file") }}
      </button>
      <button class="btn" @click="pickFolder" :title="t('app.folder')">
        {{ t("app.folder") }}
      </button>
      <button
        v-if="rootDir"
        class="btn"
        @click="handleRefresh"
        :disabled="treeLoading"
        :title="t('app.refresh')"
      >
        ↻
      </button>
      <button
        v-if="rootDir"
        class="btn"
        @click="closeFolder"
        :title="t('app.closeFolder')"
      >
        ✕
      </button>
      <div class="filename" :title="currentFile">{{ displayFileName }}</div>
      <button
        class="btn"
        @click="toggleEditorMode"
        :disabled="!hasActiveFile"
        :title="
          (isEditing ? t('editor.preview') : t('editor.edit')) +
            shortcutSuffix('toggle-mode')
        "
      >
        {{ isEditing ? t("editor.preview") : t("editor.edit") }}
        <svg
          v-if="isEditing"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <path
            d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"
          />
          <circle cx="8" cy="8" r="2" />
        </svg>
        <svg
          v-else
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <path d="M11 2l3 3L4 15H1v-3z" />
          <path d="M8 6l2 2" />
        </svg>
      </button>
      <button
        class="btn"
        @click="() => saveCurrentFile()"
        :disabled="!hasActiveFile || !isDirty || saving"
        :title="t('editor.save') + shortcutSuffix('save')"
      >
        {{ t("editor.save") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <path d="M3 2h8l4 4v9H3V2z" />
          <path d="M11 2v4h4" />
          <path d="M5 8h6v5H5z" />
        </svg>
      </button>
      <button
        class="btn"
        @click="() => saveAsCurrentFile()"
        :disabled="!hasActiveFile || saving"
        :title="t('editor.saveAs') + shortcutSuffix('save-as')"
      >
        {{ t("editor.saveAs") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <path d="M3 2h6l4 4v8H3V2z" />
          <path d="M9 2v4h4" />
          <path d="M6 10h6M6 12h6" />
        </svg>
      </button>
      <button
        class="btn"
        @click="isEditing ? editorRef?.openSearch() : find.open()"
        :title="t('toolbar.find') + shortcutSuffix('find')"
        :disabled="!hasActiveFile"
      >
        {{ t("toolbar.find") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <circle cx="6.5" cy="6.5" r="4.5" />
          <path d="M10 10l4.5 4.5" />
        </svg>
      </button>
      <div class="export-wrap">
        <button
          class="btn"
          @click="showExportMenu = !showExportMenu"
          :disabled="!canExport || exportBusy"
          :title="
            exportBusy ? t('export.exportBusy') : t('export.exportShortcut')
          "
        >
          {{ exportBusy ? "⏳" : t("toolbar.export") + " " }}
          <svg
            v-if="!exportBusy"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="vertical-align: -2px"
          >
            <path d="M8 2v9M4 6l4-4 4 4" />
            <path d="M2 12v1a2 2 0 002 2h8a2 2 0 002-2v-1" />
          </svg>
        </button>
        <div v-if="showExportMenu" class="export-menu" @click.stop>
          <button
            class="menu-item"
            @click="
              exportHtml();
              showExportMenu = false;
            "
          >
            <span class="mi-label">{{ t("export.html") }}</span>
            <span class="mi-hint">{{ t("export.htmlHint") }}</span>
          </button>
          <button
            class="menu-item"
            :disabled="!pandocInfo?.available"
            @click="exportDocx"
            :title="
              !pandocInfo?.available ? t('export.docxRequiresPandoc') : ''
            "
          >
            <span class="mi-label">{{ t("export.docx") }}</span>
            <span class="mi-hint">
              {{
                pandocInfo?.available
                  ? t("export.docxHint")
                  : t("export.docxRequiresPandoc")
              }}
            </span>
          </button>
          <button
            class="menu-item"
            @click="exportPdf"
            :title="
              pdfEnginePath
                ? t('app.usePath', { path: pdfEnginePath })
                : t('app.specifyEdgePath')
            "
          >
            <span class="mi-label">{{ t("export.pdf") }}</span>
            <span class="mi-hint">
              {{ pdfEnginePath ? t("export.pdfHint") : t("export.pdfNoEdge") }}
            </span>
          </button>
          <div class="menu-divider"></div>
          <button
            class="menu-item"
            @click="
              doPrint();
              showExportMenu = false;
            "
          >
            <span class="mi-label">{{ t("export.print") }}</span>
            <span class="mi-hint">{{ t("export.printHint") }}</span>
          </button>
        </div>
      </div>
      <button
        class="btn"
        @click="showSettings = true"
        :title="t('toolbar.settings') + shortcutSuffix('settings')"
      >
        {{ t("toolbar.settingsBtn") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <circle cx="8" cy="8" r="2.5" />
          <path
            d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
          />
        </svg>
      </button>
      <button
        class="btn"
        @click="showFileTree = !showFileTree"
        :title="t('app.toggleSidebar')"
      >
        {{ t("toolbar.sidebar") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <rect x="2" y="2" width="12" height="12" rx="1" />
          <path d="M6 2v12" />
        </svg>
      </button>
      <button
        v-if="!tocOnLeft"
        class="btn"
        @click="showToc = !showToc"
        :title="t('app.toggleToc')"
      >
        {{ t("toolbar.outline") }}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          style="vertical-align: -2px; margin-left: 2px"
        >
          <path d="M3 3h10M3 7h10M3 11h7" />
        </svg>
      </button>
      <button
        class="btn icon"
        @click="toggleTheme"
        :title="t('app.toggleTheme')"
      >
        {{ theme === "light" ? "🌙" : "☀️" }}
      </button>
      <button
        class="btn lang"
        @click="toggleLocale"
        :title="t('app.switchLanguage')"
      >
        {{ locale === "zh-CN" ? "EN" : "中" }}
      </button>
    </header>

    <TabBar
      v-if="tabs.length"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      @activate="switchToTab"
      @close="closeTab"
    />

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
            {{ t("app.files") }}
          </button>
          <button
            class="tab"
            :class="{ active: leftMode === 'search' }"
            @click="leftMode = 'search'"
            :title="t('app.search') + shortcutSuffix('search-panel')"
          >
            {{ t("app.search") }}
          </button>
          <button
            v-if="tocOnLeft"
            class="tab"
            :class="{ active: leftMode === 'outline' }"
            @click="leftMode = 'outline'"
          >
            {{ t("toolbar.outline") }}
          </button>
        </div>
        <div v-if="leftMode === 'files'" class="panel-body">
          <div class="panel-header">
            <span>{{ rootDir ? t("app.files") : t("app.noFolder") }}</span>
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
            <div v-else class="empty-tip">{{ t("app.openFolderHint") }}</div>
          </div>
        </div>
        <div v-else-if="leftMode === 'search'" class="panel-body">
          <SearchPanel
            :visible="true"
            :root-dir="rootDir"
            @close="leftMode = 'files'"
            @open="onSearchOpen"
          />
        </div>
        <div v-else-if="leftMode === 'outline'" class="panel-body">
          <TocPanel :headings="headings" :active-id="activeId" @jump="jumpTo" />
        </div>
      </aside>

      <div v-if="showFileTree" class="resizer" @pointerdown="resizeLeft"></div>

      <section
        ref="viewerEl"
        class="viewer"
        :class="{ editing: isEditing }"
        @scroll.passive="onViewerScroll"
      >
        <div v-if="errorMsg" class="error" @click="errorMsg = ''">
          {{ errorMsg }}
        </div>
        <div v-if="!hasActiveFile" class="empty">
          <div class="empty-title">{{ t("app.emptyTitle") }}</div>
          <div class="empty-hint">{{ t("app.emptyHint") }}</div>
          <div class="shortcut-hint">
            {{ t("app.shortcutHint") }}
          </div>
          <div v-if="recentFiltered.length" class="recent-files">
            <div class="recent-title">{{ t("app.recentFiles") }}</div>
            <div
              v-for="item in recentFiltered"
              :key="item.path"
              class="recent-item"
              @click="loadFile(item.path)"
              :title="item.path"
            >
              <span class="recent-name">{{ item.name }}</span>
              <span class="recent-path">{{ dirOf(item.path) }}</span>
            </div>
            <button
              class="recent-clear"
              @click="
                clearRecent();
                recentFiltered = [];
              "
            >
              {{ t("app.clearRecent") }}
            </button>
          </div>
        </div>
        <MarkdownEditor
          v-else-if="isEditing"
          ref="editorRef"
          :model-value="draftContent"
          :theme="theme"
          :current-file="currentFile"
          @update:model-value="onDraftUpdate"
          @toggle-mode="toggleEditorMode"
        />
        <MarkdownView
          v-else
          ref="markdownRef"
          :source="draftContent"
          :current-file="currentFile"
          :root-dir="rootDir"
          :render-tick="renderTick"
          @rendered="onRendered"
          @internal-link="onInternalLink"
        />
      </section>

      <div
        v-if="showToc && !tocOnLeft"
        class="resizer"
        @pointerdown="resizeRight"
      ></div>

      <aside
        v-if="showToc && !tocOnLeft"
        class="right"
        :style="{ width: rightWidth + 'px' }"
      >
        <TocPanel :headings="headings" :active-id="activeId" @jump="jumpTo" />
      </aside>
    </main>

    <FindBar
      v-if="!isEditing"
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

    <SettingsDialog :visible="showSettings" @close="showSettings = false" />

    <UnsavedChangesDialog
      :visible="showUnsavedDialog"
      :title="unsavedDialogTitle"
      :message="unsavedDialogMessage"
      :file-name="dialogFileName"
      :save-label="
        unsavedDialogMode === 'external'
          ? t('editor.reloadFromDisk')
          : t('editor.saveAndContinue')
      "
      :discard-label="
        unsavedDialogMode === 'external'
          ? t('editor.keepEditing')
          : t('editor.discardAndContinue')
      "
      @save="onDialogSave"
      @discard="
        unsavedDialogMode === 'external' ? onDialogCancel() : onDialogDiscard()
      "
      @cancel="onDialogCancel"
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
  border-bottom: 1px solid var(--shell-toolbar-border);
  background: var(--shell-toolbar-bg);
  user-select: none;
}
.filename {
  flex: 1 1 auto;
  font-size: 13px;
  color: var(--shell-filename-color);
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
  background: var(--shell-sidebar-bg);
  border-right: 1px solid var(--shell-sidebar-border);
  display: flex;
  flex-direction: column;
  min-width: 160px;
  overflow: hidden;
}
.right {
  background: var(--shell-right-bg);
  border-right: none;
  border-left: 1px solid var(--shell-sidebar-border);
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--shell-panel-header-color);
  border-bottom: 1px solid var(--shell-panel-header-border);
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
  white-space: pre-line;
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
.viewer.editing {
  overflow: hidden;
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
  line-height: 1.7;
  text-align: center;
  white-space: pre-line;
}
.shortcut-hint {
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: 8px;
}
.recent-files {
  margin-top: 16px;
  width: 360px;
  max-width: 90%;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.recent-title {
  font-size: 12px;
  color: var(--fg-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.recent-item {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.1s;
}
.recent-item:hover {
  background: var(--bg-active);
}
.recent-name {
  font-size: 13px;
  color: var(--fg);
}
.recent-path {
  font-size: 11px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-clear {
  align-self: flex-start;
  margin-top: 6px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--fg-muted);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.recent-clear:hover {
  color: var(--fg);
  background: var(--bg-btn-hover);
}
.panel-tabs {
  display: flex;
  border-bottom: 1px solid var(--shell-sidebar-border);
  background: var(--shell-sidebar-bg);
}
.tab {
  flex: 1;
  padding: 6px 0;
  font-size: 12px;
  background: transparent;
  color: var(--shell-tab-color);
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.tab:hover {
  color: var(--shell-tab-hover-color);
}
.tab.active {
  color: var(--shell-tab-active-color);
  border-bottom-color: var(--shell-tab-active-border);
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
  background: var(--shell-export-bg);
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
  background: var(--shell-export-hover-bg);
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
.error {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 8px 16px;
  background: #fee;
  color: #c00;
  border-bottom: 1px solid #fcc;
  cursor: pointer;
  font-size: 13px;
}
</style>
