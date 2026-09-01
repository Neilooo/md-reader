<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { Tab } from "../composables/useTabs";

const props = defineProps<{
  tabs: Tab[];
  activeTabId: string;
}>();

const emit = defineEmits<{
  (e: "activate", id: string): void;
  (e: "close", id: string): void;
  (e: "closeOthers", id: string): void;
  (e: "closeAll"): void;
  (e: "refresh", id: string): void;
  (e: "revealFile", path: string): void;
  (e: "copyPath", path: string): void;
}>();

const { t } = useI18n();

const menuState = ref<{
  visible: boolean;
  x: number;
  y: number;
  id: string;
  path: string;
}>({
  visible: false,
  x: 0,
  y: 0,
  id: "",
  path: "",
});

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

function onContextMenu(e: MouseEvent, item: { id: string; path: string }) {
  if (!item.path) return;
  e.preventDefault();
  e.stopPropagation();
  menuState.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    id: item.id,
    path: item.path,
  };
}

function closeMenu() {
  menuState.value.visible = false;
}

function onClose() {
  if (menuState.value.id) emit("close", menuState.value.id);
  closeMenu();
}

function onCloseOthers() {
  if (menuState.value.id && props.tabs.length > 1) {
    emit("closeOthers", menuState.value.id);
  }
  closeMenu();
}

function onCloseAll() {
  if (props.tabs.length > 0) emit("closeAll");
  closeMenu();
}

function onRefresh() {
  if (menuState.value.id) emit("refresh", menuState.value.id);
  closeMenu();
}

function onRevealFile() {
  if (menuState.value.path) {
    emit("revealFile", menuState.value.path);
  }
  closeMenu();
}

function onCopyPath() {
  if (menuState.value.path) {
    emit("copyPath", menuState.value.path);
  }
  closeMenu();
}
</script>

<template>
  <div class="tab-bar" :class="{ 'menu-open': menuState.visible }">
    <div
      v-for="item in items"
      :key="item.id"
      class="tab-item"
      :class="{ active: item.active }"
      :title="item.path"
      @click="emit('activate', item.id)"
      @mousedown.middle.prevent="onMiddle(item.id)"
      @contextmenu.prevent="onContextMenu($event, item)"
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

    <div
      v-if="menuState.visible"
      class="context-menu"
      :style="{ left: menuState.x + 'px', top: menuState.y + 'px' }"
      @click.stop="closeMenu"
    >
      <div class="menu-item" @click="onClose">{{ t("tabs.close") }}</div>
      <div
        class="menu-item"
        :class="{ disabled: tabs.length <= 1 }"
        @click="onCloseOthers"
      >
        {{ t("tabs.closeOthers") }}
      </div>
      <div
        class="menu-item"
        :class="{ disabled: tabs.length === 0 }"
        @click="onCloseAll"
      >
        {{ t("tabs.closeAll") }}
      </div>
      <div class="menu-item" @click="onRefresh">{{ t("tabs.refresh") }}</div>
      <div class="menu-sep"></div>
      <div class="menu-item" @click="onCopyPath">
        {{ t("tabs.copyPath") }}
      </div>
      <div class="menu-item" @click="onRevealFile">
        {{ t("app.openContainingFolder") }}
      </div>
    </div>
    <div
      v-if="menuState.visible"
      class="context-menu-overlay"
      @click="closeMenu"
      @contextmenu.prevent="closeMenu"
    ></div>
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
.tab-bar.menu-open {
  overflow: visible;
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

.context-menu {
  position: fixed;
  z-index: 100;
  min-width: 180px;
  padding: 4px 0;
  background: var(--bg-toolbar);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 13px;
}
.context-menu .menu-item {
  padding: 6px 16px;
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}
.context-menu .menu-item:hover {
  background: var(--bg-btn-hover);
}
.context-menu .menu-item.disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}
.context-menu .menu-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}
</style>
