<script setup lang="ts">
import { computed, ref, nextTick } from "vue";
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
  (e: "closeLeft", id: string): void;
  (e: "closeRight", id: string): void;
  (e: "closeAll"): void;
  (e: "closeOthers", id: string): void;
}>();

const { t } = useI18n();

// 右键菜单状态
const menuState = ref<{
  visible: boolean;
  x: number;
  y: number;
  targetId: string;
}>({
  visible: false,
  x: 0,
  y: 0,
  targetId: "",
});

function basename(p: string): string {
  if (!p) return t("app.noFile");
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1];
}

function onMiddle(id: string) {
  emit("close", id);
}

/** 打开右键菜单 */
async function onContextMenu(e: MouseEvent, id: string) {
  e.preventDefault();
  menuState.value = {
    visible: true,
    x: e.clientX,
    y: e.clientY,
    targetId: id,
  };
  await nextTick();
}

/** 关闭右键菜单 */
function closeMenu() {
  menuState.value.visible = false;
}

const hasLeft = computed(() => {
  const idx = props.tabs.findIndex((t) => t.id === menuState.value.targetId);
  return idx > 0;
});

const hasRight = computed(() => {
  const idx = props.tabs.findIndex((t) => t.id === menuState.value.targetId);
  return idx < props.tabs.length - 1;
});

const hasOthers = computed(() => props.tabs.length > 1);

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
</script>

<template>
  <div
    class="tab-bar"
    :class="{ 'menu-open': menuState.visible }"
    @click="closeMenu"
    @contextmenu="closeMenu"
  >
    <div
      v-for="item in items"
      :key="item.id"
      class="tab-item"
      :class="{ active: item.active }"
      :title="item.path"
      @click="emit('activate', item.id)"
      @mousedown.middle.prevent="onMiddle(item.id)"
      @contextmenu.prevent.stop="onContextMenu($event, item.id)"
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

    <div
      v-if="menuState.visible"
      class="context-menu"
      :style="{ left: menuState.x + 'px', top: menuState.y + 'px' }"
      @click.stop="closeMenu"
    >
      <div
        :class="['menu-item', { disabled: !hasLeft }]"
        :title="hasLeft ? '' : '已经是第一个标签'"
        @click="hasLeft && emit('closeLeft', menuState.targetId)"
      >
        {{ t("tabs.closeLeft") }}
      </div>
      <div
        :class="['menu-item', { disabled: !hasRight }]"
        :title="hasRight ? '' : '已经是最后一个标签'"
        @click="hasRight && emit('closeRight', menuState.targetId)"
      >
        {{ t("tabs.closeRight") }}
      </div>
      <div
        :class="['menu-item', { disabled: !hasOthers }]"
        :title="hasOthers ? '' : '只有一个标签'"
        @click="hasOthers && emit('closeOthers', menuState.targetId)"
      >
        {{ t("tabs.closeOthers") }}
      </div>
      <div class="menu-item" @click="emit('closeAll')">
        {{ t("tabs.closeAll") }}
      </div>
    </div>
    <div
      v-if="menuState.visible"
      class="context-menu-overlay"
      @click="closeMenu"
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

/* 右键菜单 */
.context-menu {
  position: absolute;
  z-index: 100;
  min-width: 180px;
  padding: 4px 0;
  background: var(--bg-toolbar);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
  font-size: 12px;
}

.menu-item {
  padding: 6px 16px;
  color: var(--fg);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

.menu-item:hover {
  background: var(--bg-btn-hover);
}

.menu-item.disabled {
  color: var(--fg-muted);
  opacity: 0.5;
  cursor: default;
}

.menu-item.disabled:hover {
  background: transparent;
}

/* 点击其他地方关闭右键菜单 */
.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}
</style>
