import { ref, computed } from "vue";
import type { Heading } from "./useMarkdown";

const STORAGE_TABS = "md-reader-tabs";

export interface Tab {
  id: string;
  path: string;
  content: string;
  draftContent: string;
  isDirty: boolean;
  isEditing: boolean;
  headings: Heading[];
  scrollTop: number;
  pendingHash: string;
  pendingScrollTop: number;
}

interface PersistedTabs {
  paths: string[];
  activePath: string;
}

const tabs = ref<Tab[]>([]);
const activeTabId = ref<string>("");

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `tab-${Date.now()}-${idSeq}`;
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

const activeTab = computed<Tab | null>(
  () => tabs.value.find((t) => t.id === activeTabId.value) ?? null
);

function findTabByPath(path: string): Tab | undefined {
  return tabs.value.find((t) => samePath(t.path, path));
}

function createTab(path: string): Tab {
  return {
    id: nextId(),
    path,
    content: "",
    draftContent: "",
    isDirty: false,
    isEditing: false,
    headings: [],
    scrollTop: 0,
    pendingHash: "",
    pendingScrollTop: 0,
  };
}

function activateTab(id: string) {
  if (tabs.value.some((t) => t.id === id)) {
    activeTabId.value = id;
    persist();
  }
}

function removeTab(id: string) {
  const idx = tabs.value.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const wasActive = activeTabId.value === id;
  tabs.value.splice(idx, 1);
  if (wasActive) {
    const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? null;
    activeTabId.value = next ? next.id : "";
  }
  persist();
}

function persist() {
  const data: PersistedTabs = {
    paths: tabs.value.map((t) => t.path),
    activePath: activeTab.value?.path ?? "",
  };
  localStorage.setItem(STORAGE_TABS, JSON.stringify(data));
}

function loadPersisted(): PersistedTabs | null {
  try {
    const raw = localStorage.getItem(STORAGE_TABS);
    if (raw) return JSON.parse(raw) as PersistedTabs;
  } catch {
    /* ignore */
  }
  return null;
}

export function useTabs() {
  return {
    tabs,
    activeTabId,
    activeTab,
    findTabByPath,
    createTab,
    activateTab,
    removeTab,
    persist,
    loadPersisted,
  };
}
