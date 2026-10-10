<!--
  应用根组件：整体布局（工具栏 / 左侧文件树·搜索·大纲 / 阅读区 / 右侧目录 /
  标签栏 / 各弹层）与全局事件（键盘分发、拖放、外部打开事件、窗口关闭保护）。
  状态刻意拆在 composables 里（见各 useXxx）；本组件持有「组合层」逻辑：
  标签生命周期、保存/关闭确认流、导出编排、编辑↔预览切换的滚动位置同步。
-->
<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from "vue";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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
import { exportToPng } from "./composables/exportImage";
import { useTheme } from "./composables/useTheme.ts";

const { t, locale } = useI18n();

/** 工具栏语言切换按钮：中↔英循环，选择立即持久化。 */
function toggleLocale() {
  const next = locale.value === "zh-CN" ? "en-US" : "zh-CN";
  locale.value = next;
  persistLocale(next as AppLocale);
}

// ---- 文件树 / 监听 / 历史 / 阅读设置 / 快捷键 / 标签（各 composable 单例） ----
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
/** 快捷键提示后缀，如 " (Ctrl+S)"，拼在菜单/按钮 title 上。 */
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
// 编辑器组件引用（openSearch/goToLine 等暴露给键盘分发的接口）
const editorRef = ref<{
  focus: () => void;
  openSearch: () => void;
  openReplace: () => void;
  goToLine: () => void;
  getTopVisibleLine: () => number;
  scrollToLine: (line: number) => void;
} | null>(null);

// ---- 未保存/外部变更对话框（promise-based：askUnsaved 挂起调用方直到用户选择） ----
type UnsavedChoice = "save" | "discard" | "cancel";
type UnsavedDialogMode = "unsaved" | "external";
const showUnsavedDialog = ref(false);
const unsavedDialogMode = ref<UnsavedDialogMode>("unsaved");
const dialogTab = ref<Tab | null>(null);
let unsavedResolve: ((choice: UnsavedChoice) => void) | null = null;

// ---- watcher 抑制表：自己写文件触发的变更事件不该触发重载对话框 ----
// 保存/新建前后 addSuppress 对应路径，1 秒后自动解除（等 watcher 事件过去）。
// 按路径归一化（反斜杠→正斜杠 + 小写）存取，兼容不同来源的大小写差异。
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

// 面板显隐（localStorage 记忆）与左侧模式：files / search / outline
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
// 导出进行中状态与结果提示（toast）
const exportBusy = ref(false);
const exportToast = ref("");
// 外部依赖探测结果（设置页/导出前展示）
const pandocInfo = ref<PandocInfo | null>(null);
const pdfEnginePath = ref<string | null>(null);
// 强制重渲染计数：主题切换后 +1 让 Mermaid/KaTeX 按新主题重画
const renderTick = ref(0);

// 左右分栏宽度（拖拽调整，localStorage 记忆；右侧 inverse 反向计算）
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
// 当前渲染根 DOM（导出/查找/滚动同步都以它为操作对象）
const bodyRef = computed(() => markdownRef.value?.root ?? null);

const { activeId, onScroll, jumpTo } = useScrollSpy(viewerEl, bodyRef);
const find = useFindInPage(bodyRef);

// ---- 活动标签的只读投影：Tab 状态的唯一真身在 useTabs 的 activeTab ----
// 注意这些是 computed，写入要走 activeTab.value.* 或各 save/draft 辅助函数。
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

/** 在资源管理器中显示该文件。 */
async function openInExplorer(path: string) {
  try {
    await revealItemInDir(path);
  } catch (e: any) {
    errorMsg.value = e?.message ?? String(e);
  }
}

/** 复制路径到剪贴板；非安全上下文降级为隐藏 textarea + execCommand。 */
async function copyPath(path: string) {
  if (!path) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(path);
    } else {
      const ta = document.createElement("textarea");
      ta.value = path;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    exportToast.value = t("tabs.copiedPath");
  } catch {
    exportToast.value = t("tabs.copyFailed");
  }
}
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

/**
 * 弹出未保存/外部变更确认框，返回 Promise 在用户点选后 resolve。
 * closeTab / confirmCloseAll / onFilesChanged 等调用方 await 它实现
 * 「先确认再动作」的流程。同一时刻只允许一个在飞；第二个调用直接 cancel。
 */
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

/** 对话框按钮回调统一走这里：收起弹窗并把选择交回挂起的调用方。 */
function resolveDialog(choice: UnsavedChoice) {
  showUnsavedDialog.value = false;
  const resolve = unsavedResolve;
  unsavedResolve = null;
  dialogTab.value = null;
  resolve?.(choice);
}

/** 把磁盘内容读进标签（新开或重载共用）：重置草稿/脏标记/标题，并按
 *  hash 或历史滚动位置安排渲染后的初始滚动。 */
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

/**
 * 打开文件（核心入口）：已被某标签打开则只激活它并按 hash/原位置滚动；
 * 否则新建标签读入。切换前先保存当前标签的滚动位置。
 */
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

/** 无条件从磁盘重载标签内容（脏草稿已被放弃或不存在时）。 */
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

/** 切换标签：先把出向标签的滚动存回它自己，再安排入向标签恢复。 */
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

function findNextTab(): string {
  const idx = tabs.value.findIndex((t) => t.id === activeTabId.value);
  if (idx < 0 || tabs.value.length === 0) return "";
  return tabs.value[(idx + 1) % tabs.value.length].id;
}

function findPrevTab(): string {
  const idx = tabs.value.findIndex((t) => t.id === activeTabId.value);
  if (idx < 0 || tabs.value.length === 0) return "";
  return tabs.value[(idx - 1 + tabs.value.length) % tabs.value.length].id;
}

/** 工具栏刷新：刷新文件树；正在编辑时记住编辑器可视行以便回来时对位。 */
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

/**
 * 保存标签到磁盘（Ctrl+S 核心）。写文件前后抑制 watcher 一秒，
 * 防止自己的写入触发「文件已变更」对话框。返回是否成功。
 */
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

/** 另存为：写新路径、标签改指向新文件，并记入最近/持久化标签列表。 */
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

/** 关闭单个标签：脏标签先弹确认（cancel 则不动，save 失败也不关）。 */
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

/** 逐个确认所有脏标签（关窗口/关闭全部前）。任一 cancel 即中止。 */
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

/** 关闭其他标签：逐个确认脏标签（cancel 中止），再统一移除并回到保留标签。 */
async function closeOthers(id: string) {
  const keep = tabs.value.find((x) => x.id === id);
  if (!keep || tabs.value.length <= 1) return;
  const others = tabs.value.filter((x) => x.id !== id);
  for (const tab of others) {
    if (tab.isDirty) {
      if (tab.id !== activeTabId.value) switchToTab(tab.id);
      const choice = await askUnsaved(tab, "unsaved");
      if (choice === "cancel") return;
      if (choice === "save") {
        const ok = await saveTab(tab);
        if (!ok) return;
      }
    }
  }
  for (const tab of others) removeTab(tab.id);
  activateTab(keep.id);
}

async function closeAll() {
  const ok = await confirmCloseAll();
  if (!ok) return;
  for (const tab of [...tabs.value]) removeTab(tab.id);
}

/** 标签右键「刷新」：脏时弹外部变更确认（重新加载=放弃编辑）。 */
async function refreshTab(id: string) {
  const tab = tabs.value.find((x) => x.id === id);
  if (!tab) return;
  if (tab.isDirty) {
    if (id !== activeTabId.value) switchToTab(id);
    const choice = await askUnsaved(tab, "external");
    if (choice === "cancel") return;
    if (choice === "save") {
      // "重新加载" — discard unsaved edits and reload from disk.
      await forceReloadTab(tab);
    }
    // "保留编辑" — keep current edits, do not reload.
    return;
  }
  await forceReloadTab(tab);
}

/**
 * 预览区当前对应的源码行：从上往下找最后一个 top 距容器顶 ≤16px 的
 * `[data-source-line]` 块（即当前视口顶部的块）。编辑↔预览切换时用它对位。
 */
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

/** 把预览区滚到指定源码行对应的块（找 line 的最大不超过值）。 */
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

/** 编辑↔预览切换：以源码行为锚双向保持滚动位置。 */
function toggleEditorMode() {
  const tab = activeTab.value;
  if (!tab) return;
  if (tab.isEditing) {
    // 编辑 → 预览：记下编辑器顶部可视行，渲染后滚到对应块
    tab.pendingSourceLine = editorRef.value?.getTopVisibleLine() ?? 1;
    tab.pendingScrollTop = 0;
    tab.isEditing = false;
    find.reset();
    return;
  }
  // 预览 → 编辑：记下预览当前源码行，编辑器挂载后滚到该行
  const line = getPreviewTopSourceLine();
  tab.pendingSourceLine = 0;
  tab.isEditing = true;
  find.close();
  nextTick(() => editorRef.value?.scrollToLine(line));
}

/**
 * MarkdownView 渲染完成回调：按标签的 pending 状态恢复滚动——
 * hash 锚点 > 源码行 > 像素 scrollTop > 顶部。消费后清零。
 * 切换标签/刷新/重载后的位置恢复都靠这里。
 */
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

/** 把当前滚动位置写回标签 + 按路径的历史记录（重开文件可恢复）。 */
function saveCurrentScroll() {
  const tab = activeTab.value;
  if (tab && tab.path && viewerEl.value && !tab.isEditing) {
    tab.scrollTop = viewerEl.value.scrollTop;
    saveScroll(tab.path, viewerEl.value.scrollTop);
  }
}

/** 给无扩展名/其他扩展的保存路径补 .md（新建文件对话框的容错）。 */
function withMarkdownExtension(path: string): string {
  return /\.(md|markdown|mdx|txt)$/i.test(path) ? path : `${path}.md`;
}

/** 新建文件：选路径 → 写空文件 → 以编辑模式打开（并抑制 watcher 一秒）。 */
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

/** 文件选择器打开单个 Markdown 文件。 */
async function pickFile() {
  const selected = await open({
    multiple: false,
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] },
    ],
  });
  if (typeof selected === "string") await loadFile(selected);
}

/** 选择目录并开始监听（文件树根目录切换）。 */
async function pickFolder() {
  const dir = await openFolder();
  if (dir) await startWatching(dir);
}

/** 启动目录监听：变更先刷文件树，150ms 后再分发到各标签（给树刷新让路）。 */
async function startWatching(dir: string) {
  await watcher.start(dir, async (paths) => {
    await refreshTree();
    window.setTimeout(() => {
      void onFilesChanged(paths);
    }, 150);
  });
}

/**
 * watcher 变更分发：单 watcher 匹配所有标签。
 * 抑制表命中（自己保存触发）→ 忽略；干净标签静默重载；
 * 脏标签弹外部变更确认。绝不直接 reload 覆盖未保存的草稿。
 */
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

/** 首次启动时取 argv 里的目标文件（文件关联/命令行唤起）。 */
async function getInitialOpenFile(): Promise<string> {
  try {
    const path = await invoke<string | null>("initial_open_file");
    return typeof path === "string" ? path : "";
  } catch {
    return "";
  }
}

/**
 * 启动时恢复上次的标签列表（useTabs 持久化），兼容旧的
 * 「最近一个文件」localStorage 记录；读不到的文件静默跳过。
 * initialPath（argv 带来的）最后加载并激活。
 * 设置里关闭「启动时恢复标签页」（#38）则跳过恢复，只处理 initialPath。
 */
async function restoreTabs(initialPath = "") {
  if (!readingSettings.value.restoreTabs) {
    if (initialPath) await loadFile(initialPath);
    return;
  }
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

const { themeMode, effectiveTheme } = useTheme();

// 主题按钮图标：当前模式（亮/暗/跟随系统）
const themeIcon = computed(() => {
  if (themeMode.value === "light") return "☀️";
  if (themeMode.value === "dark") return "🌙";
  return "🌗";
});

/** 主题循环切换：亮 → 暗 → 跟随系统。 */
function toggleTheme() {
  if (themeMode.value === "system") themeMode.value = "light";
  else if (themeMode.value === "light") themeMode.value = "dark";
  else themeMode.value = "system";

  // Force Mermaid/KaTeX re-render so charts follow the new theme.
  renderTick.value++;
}

// ---- 导出四件套（HTML / DOCX / PDF / PNG），共用模式：
// 编辑模式守卫 → bodyRef 校验 → exportBusy/Toast 反馈。----

/** 导出单文件 HTML。 */
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

/** 导出 DOCX（pandoc 转换，参考模板可选）。 */
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

/** 导出 PDF（Edge headless）。探测失败时弹选择框让用户指定 msedge.exe。 */
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

/** 直接调用系统打印（WebView 打印管线）。 */
function doPrint() {
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (bodyRef.value) printDocument(bodyRef.value, fileName.value);
}

/** 导出 PNG 长图（整篇所见即所得，见 exportImage.ts）。 */
async function exportImage() {
  showExportMenu.value = false;
  if (isEditing.value) {
    errorMsg.value = t("editor.previewBeforeExport");
    return;
  }
  if (!bodyRef.value || !draftContent.value) return;
  exportBusy.value = true;
  exportToast.value = t("export.generatingPng");
  try {
    const out = await exportToPng(
      bodyRef.value,
      fileName.value || "document",
      currentFile.value || undefined
    );
    if (out) exportToast.value = `${t("export.exportedPng")}: ${out}`;
    else exportToast.value = "";
  } catch (e: any) {
    errorMsg.value = `${t("export.exportFailed")}: ${e?.message ?? e}`;
    exportToast.value = "";
  } finally {
    exportBusy.value = false;
  }
}

/** 全局搜索结果点击 → 打开对应文件。 */
function onSearchOpen(path: string, _line: number) {
  void loadFile(path);
}

/** 文内 .md 相对链接点击 → 打开目标文件并跳锚点。 */
function onInternalLink(path: string, hash: string) {
  void loadFile(path, hash);
}

/** 编辑器内容变更：更新草稿 + 重算脏标记；标题抽取做 200ms 防抖。 */
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

/** 取路径的目录部分（统一成正斜杠后截取）。 */
function dirOf(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i < 0 ? "" : normalized.slice(0, i);
}

// 最近文件（过滤掉已删除的），展示在欢迎页
const recentFiltered = ref<RecentItem[]>([]);

/** 刷新最近列表：取前 10 条并并发检查文件是否还存在。 */
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

/** Ctrl+滚轮缩放：编辑态调编辑器字号，预览态调阅读字号。 */
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

/**
 * 全局键盘分发中枢（window 级 keydown）。
 * 优先级：未保存对话框打开时只响应 Esc → Esc 依次关闭查找/设置 →
 * Ctrl/Cmd 组合键按 useShortcuts 的绑定表分发（含编辑/预览两套：编辑态
 * 走 CodeMirror 的查找/替换/跳行，预览态走页内查找）。
 */
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
  } else if (combo === getBinding("close-tab")) {
    e.preventDefault();
    if (activeTabId.value) void closeTab(activeTabId.value);
  } else if (
    combo === getBinding("next-tab") ||
    combo === getBinding("next-tab-right")
  ) {
    e.preventDefault();
    if (tabs.value.length > 1) switchToTab(findNextTab());
  } else if (
    combo === getBinding("prev-tab") ||
    combo === getBinding("prev-tab-left")
  ) {
    e.preventDefault();
    if (tabs.value.length > 1) switchToTab(findPrevTab());
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

// 阅读区滚动：驱动目录高亮（scrollSpy），滚动位置 400ms 防抖落盘
let scrollSaveTimer: number | null = null;
function onViewerScroll() {
  if (isEditing.value) return;
  onScroll();
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = window.setTimeout(saveCurrentScroll, 400);
}

// 面板显隐 → localStorage 记忆
watch(showFileTree, (v) =>
  localStorage.setItem("md-reader-show-tree", v ? "1" : "0")
);
watch(showToc, (v) =>
  localStorage.setItem("md-reader-show-toc", v ? "1" : "0")
);

// 进入编辑态时移除预览引用（渲染 DOM 不存在，查找/大纲逻辑要避开）；
// 回到预览态等 DOM 就绪后重算目录高亮。
watch(isEditing, (editing) => {
  if (editing) {
    markdownRef.value = null;
    return;
  }
  nextTick(onScroll);
});

// 切标签：清错误与查找高亮，恢复目录高亮
watch(activeTabId, () => {
  errorMsg.value = "";
  find.close();
  find.clearHighlights();
  if (!activeTab.value?.isEditing) nextTick(onScroll);
});

let unlistenDrop: (() => void) | null = null;
let unlistenOpen: (() => void) | null = null;
let unlistenClose: (() => void) | null = null;

/**
 * 挂载流程（顺序敏感）：
 * 1. 应用阅读设置、探测 pandoc/PDF 引擎（异步，不阻塞）
 * 2. 恢复文件树根目录并启动监听
 * 3. 监听 Rust 事件：md-reader://open-file（文件关联/单实例/odoc）
 * 4. 窗口关闭保护：有脏标签时 preventDefault → 确认 → destroy()
 * 5. 恢复标签列表 + 排空 macOS odoc 待开队列（监听器已就位）
 * 6. 拖放打开、全局键盘/滚轮监听
 */
onMounted(async () => {
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

  // 窗口关闭保护：注意确认通过后走一次性 destroy()，不能递归 close()
  // （onCloseRequested 会再次触发，窗口就永远关不上了）。
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
  // macOS: files double-clicked before the frontend finished loading arrive as
  // RunEvent::Opened in Rust and are queued there; drain them now that the
  // open-file listener above is attached.
  try {
    const pending = await invoke<string[]>("take_pending_open_files");
    for (const path of pending) {
      if (path) await loadFile(path);
    }
  } catch {
    /* backend build without the pending-file queue — nothing to drain */
  }
  // 拖放：取第一个 Markdown 类型的文件打开
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

// 标签集合变化（开/关/另存为改路径）→ 持久化标签列表
watch(
  () => tabs.value.map((tb) => tb.path).join("\n"),
  () => persist()
);

// toast / 错误条自动消失
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

// 关掉所有文件回到欢迎页时刷新最近列表（可能有删掉的文件）
watch(hasActiveFile, (v) => {
  if (!v) void refreshRecent();
});

// 目录被挪到右侧后，「大纲」不能留在左侧，回落到文件树
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
          <button class="menu-item" :disabled="exportBusy" @click="exportImage">
            <span class="mi-label">{{ t("export.png") }}</span>
            <span class="mi-hint">{{ t("export.pngHint") }}</span>
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
        {{ themeIcon }}
      </button>
      <button
        class="btn lang"
        @click="toggleLocale"
        :title="t('app.switchLanguage')"
      >
        {{ locale === "zh-CN" ? "EN" : "中" }}
      </button>
    </header>

    <!-- 标签栏（有标签时才显示） -->
    <TabBar
      v-if="tabs.length"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      @activate="switchToTab"
      @close="closeTab"
      @close-others="closeOthers"
      @close-all="closeAll"
      @refresh="refreshTab"
      @reveal-file="openInExplorer"
      @copy-path="copyPath"
    />

    <!-- 主体三栏：左侧面板（文件/搜索/大纲，可隐藏）· 阅读区 · 右侧目录 -->
    <main class="layout">
      <aside
        v-if="showFileTree"
        class="left"
        :style="{ width: leftWidth + 'px' }"
      >
        <!-- 左侧面板切换：文件树 / 全局搜索 / 大纲（目录在左侧时才有此页） -->
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

      <!-- 阅读区：错误条 / 欢迎页 / 编辑器 / 预览 四种互斥形态 -->
      <section
        ref="viewerEl"
        class="viewer"
        :class="{ editing: isEditing }"
        @scroll.passive="onViewerScroll"
      >
        <div v-if="errorMsg" class="error" @click="errorMsg = ''">
          {{ errorMsg }}
        </div>
        <!-- 欢迎页：无打开文件时显示最近列表 -->
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
          :theme="effectiveTheme"
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

    <!-- 页内查找条（仅预览态；编辑态的查找在 CodeMirror 内部） -->
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

    <!-- 未保存/外部变更确认：按钮文案按 mode 区分（保存/放弃 vs 重载/保留） -->
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
  cursor: default;
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
  background: var(--reader-bg, var(--bg));
  min-width: 0;
  position: relative;
}
.viewer.editing {
  overflow: hidden;
  background: var(--bg);
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
