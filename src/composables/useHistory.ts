import { ref } from "vue";

const STORAGE_RECENT = "md-reader-recent";
const STORAGE_SCROLL = "md-reader-scroll-positions";
const MAX_RECENT = 20;
const MAX_SCROLL_ENTRIES = 100;

export interface RecentItem {
  path: string;
  name: string;
  ts: number;
}

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_RECENT);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function loadScrollMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_SCROLL);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

const recent = ref<RecentItem[]>(loadRecent());
const scrollMap = ref<Record<string, number>>(loadScrollMap());

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

function pushRecent(path: string) {
  if (!path) return;
  const list = recent.value.filter((x) => x.path !== path);
  list.unshift({ path, name: basename(path), ts: Date.now() });
  recent.value = list.slice(0, MAX_RECENT);
  localStorage.setItem(STORAGE_RECENT, JSON.stringify(recent.value));
}

function clearRecent() {
  recent.value = [];
  localStorage.setItem(STORAGE_RECENT, "[]");
}

function saveScroll(path: string, top: number) {
  if (!path) return;
  scrollMap.value[path] = top;
  const recentPaths = new Set(recent.value.map((x) => x.path));
  for (const key of Object.keys(scrollMap.value)) {
    if (Object.keys(scrollMap.value).length <= MAX_SCROLL_ENTRIES) break;
    if (!recentPaths.has(key)) delete scrollMap.value[key];
  }
  localStorage.setItem(STORAGE_SCROLL, JSON.stringify(scrollMap.value));
}

function getScroll(path: string): number {
  return scrollMap.value[path] || 0;
}

export function useHistory() {
  return { recent, pushRecent, clearRecent, saveScroll, getScroll };
}
