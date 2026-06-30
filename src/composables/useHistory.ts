import { ref } from "vue";

const STORAGE_RECENT = "md-reader-recent";
const STORAGE_SCROLL = "md-reader-scroll-positions";
const MAX_RECENT = 20;

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

const MAX_SCROLL_ENTRIES = 100;

function saveScroll(path: string, top: number) {
  if (!path) return;
  scrollMap.value[path] = top;
  // Evict oldest entries if over the limit
  const keys = Object.keys(scrollMap.value);
  if (keys.length > MAX_SCROLL_ENTRIES) {
    const recentPaths = new Set(recent.value.map((r) => r.path));
    // Remove entries not in recent list first
    for (const k of keys) {
      if (!recentPaths.has(k)) {
        delete scrollMap.value[k];
        if (Object.keys(scrollMap.value).length <= MAX_SCROLL_ENTRIES) break;
      }
    }
  }
  localStorage.setItem(STORAGE_SCROLL, JSON.stringify(scrollMap.value));
}

function getScroll(path: string): number {
  return scrollMap.value[path] || 0;
}

export function useHistory() {
  return { recent, pushRecent, clearRecent, saveScroll, getScroll };
}
