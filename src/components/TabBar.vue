<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Tab } from "../composables/useTabs";

const props = defineProps<{
  tabs: Tab[];
  activeTabId: string;
  autoReload: string[];
}>();

const emit = defineEmits<{
  (e: "activate", id: string): void;
  (e: "close", id: string): void;
}>();

const { t } = useI18n();

const items = computed(() =>
  props.tabs.map((tab) => ({
    id: tab.id,
    name: basename(tab.path),
    path: tab.path,
    isDirty: tab.isDirty,
    isStale:
      tab.staleSince !== null &&
      !tab.isDirty &&
      !props.autoReload.includes(tab.path.replace(/\\/g, "/").toLowerCase()),
    active: tab.id === props.activeTabId,
  }))
);

function basename(p: string): string {
  if (!p) return t("app.noFile");
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

function onMiddle(id: string) {
  emit("close", id);
}
</script>

<template>
  <div class="tab-bar">
    <div
      v-for="item in items"
      :key="item.id"
      class="tab-item"
      :class="{ active: item.active }"
      :title="item.path"
      @click="emit('activate', item.id)"
      @mousedown.middle.prevent="onMiddle(item.id)"
    >
      <span v-if="item.isDirty" class="dot"></span>
      <span v-if="item.isStale" class="stale-warning">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
      </span>
      <span class="name">{{ item.name }}</span>
      <button
        class="close"
        :title="t('tabs.close')"
        @click.stop="emit('close', item.id)"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--shell-sidebar-bg);
  border-bottom: 1px solid var(--shell-toolbar-border);
  scrollbar-width: thin;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 6px 12px;
  max-width: 200px;
  font-size: 12px;
  color: var(--shell-tab-color);
  background: transparent;
  border-right: 1px solid var(--shell-sidebar-border);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.tab-item:hover {
  color: var(--shell-tab-hover-color);
}
.tab-item.active {
  color: var(--shell-tab-active-color);
  background: var(--bg);
  border-bottom-color: var(--shell-tab-active-border);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
.dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--shell-tab-active-border);
}
.stale-warning {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  color: var(--banner-warning, #f59e0b);
}
.close {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s, background-color 0.15s;
}
.close:hover {
  opacity: 1;
  background: var(--bg-btn-hover);
}
</style>
