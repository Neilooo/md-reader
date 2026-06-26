<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Tab } from "../composables/useTabs";

const props = defineProps<{
  tabs: Tab[];
  activeTabId: string;
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
      <span class="name">{{ item.name }}</span>
      <button
        class="close"
        :title="t('tabs.close')"
        @click.stop="emit('close', item.id)"
      >
        ×
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
.close {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  line-height: 14px;
  text-align: center;
  font-size: 14px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  opacity: 0.6;
}
.close:hover {
  opacity: 1;
  background: var(--bg-btn-hover);
}
</style>
