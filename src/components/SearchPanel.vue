<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { searchInFiles, type SearchMatch } from "../composables/useGlobalSearch";

const { t } = useI18n();

const props = defineProps<{
  visible: boolean;
  rootDir: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "open", path: string, line: number): void;
}>();

const query = ref("");
const caseSensitive = ref(false);
const loading = ref(false);
const results = ref<SearchMatch[]>([]);
const error = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

const grouped = computed(() => {
  const map: Record<string, SearchMatch[]> = {};
  for (const m of results.value) {
    (map[m.rel_path] ||= []).push(m);
  }
  return Object.entries(map).map(([rel, matches]) => ({ rel, matches }));
});

async function run() {
  error.value = "";
  if (!props.rootDir) {
    error.value = t("search.openFolderFirst");
    results.value = [];
    return;
  }
  const q = query.value.trim();
  if (!q) {
    results.value = [];
    return;
  }
  loading.value = true;
  try {
    results.value = await searchInFiles(
      props.rootDir,
      q,
      caseSensitive.value,
      500
    );
  } catch (e: any) {
    error.value = String(e?.message ?? e);
    results.value = [];
  } finally {
    loading.value = false;
  }
}

let debounceTimer: number | null = null;
function onInput() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(run, 220);
}

function onKey(evt: KeyboardEvent) {
  if (evt.key === "Escape") emit("close");
  else if (evt.key === "Enter") run();
}

function highlight(text: string, q: string): string {
  if (!q) return escapeHtml(text);
  const flags = caseSensitive.value ? "g" : "gi";
  const escQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escQ, flags);
  // Split on matches, escape each segment, wrap matches in <mark>
  const parts: string[] = [];
  let last = 0;
  text.replace(re, (m, offset) => {
    parts.push(escapeHtml(text.slice(last, offset)));
    parts.push(`<mark>${escapeHtml(m)}</mark>`);
    last = offset + m.length;
    return m;
  });
  parts.push(escapeHtml(text.slice(last)));
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    }
  }
);
</script>

<template>
  <div v-if="visible" class="search-panel">
    <div class="header">
      <input
        ref="inputRef"
        v-model="query"
        type="text"
        :placeholder="t('search.placeholder')"
        class="input"
        @input="onInput"
        @keydown="onKey"
      />
      <button
        class="ic"
        :class="{ active: caseSensitive }"
        @click="(caseSensitive = !caseSensitive), run()"
        :title="t('find.caseSensitive')"
      >
        Aa
      </button>
      <button class="ic" @click="emit('close')" :title="t('find.close') + ' (Esc)'">✕</button>
    </div>
    <div class="status">
      <span v-if="loading">{{ t("search.searching") }}</span>
      <span v-else-if="error" class="error">{{ error }}</span>
      <span v-else-if="query.trim() && results.length === 0">{{ t("search.noMatches") }}</span>
      <span v-else-if="results.length > 0">
        {{ results.length }} {{ t("search.matches") }} · {{ grouped.length }} {{ t("search.files") }}
      </span>
      <span v-else class="muted">{{ t("search.typeToSearch") }}</span>
    </div>
    <div class="results">
      <div v-for="g in grouped" :key="g.rel" class="group">
        <div class="group-title" :title="g.rel">{{ g.rel }}</div>
        <div
          v-for="m in g.matches"
          :key="m.path + ':' + m.line + ':' + m.column"
          class="item"
          @click="emit('open', m.path, m.line)"
        >
          <span class="ln">L{{ m.line }}</span>
          <span class="preview" v-html="highlight(m.preview, query)"></span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-toolbar);
}
.header {
  display: flex;
  gap: 4px;
  padding: 8px;
  border-bottom: 1px solid var(--border);
}
.input {
  flex: 1 1 auto;
  padding: 4px 8px;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
  font-size: 13px;
}
.input:focus {
  border-color: var(--link);
}
.ic {
  font-size: 12px;
  padding: 3px 8px;
  background: transparent;
  color: var(--fg);
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
}
.ic:hover {
  background: var(--bg-btn-hover);
}
.ic.active {
  background: var(--bg-active);
  color: var(--link);
}
.status {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--fg-muted);
  border-bottom: 1px solid var(--border);
}
.status .error {
  color: #c00;
}
.status .muted {
  color: var(--fg-muted);
}
.results {
  flex: 1 1 auto;
  overflow: auto;
  font-size: 12px;
}
.group {
  margin: 4px 0;
}
.group-title {
  padding: 4px 12px;
  color: var(--link);
  font-weight: 500;
  background: var(--bg-toolbar);
  position: sticky;
  top: 0;
  z-index: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-bottom: 1px solid var(--border);
}
.item {
  display: flex;
  gap: 8px;
  padding: 4px 12px 4px 20px;
  cursor: pointer;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
}
.item:hover {
  background: var(--bg-btn-hover);
}
.ln {
  color: var(--fg-muted);
  flex: 0 0 auto;
}
.preview {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
:deep(mark) {
  background: #ffd84d;
  color: #000;
  padding: 0 1px;
  border-radius: 2px;
}
</style>
