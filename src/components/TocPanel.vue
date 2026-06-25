<script setup lang="ts">
import { computed } from "vue";
import type { Heading } from "../composables/useMarkdown";

const props = defineProps<{
  headings: Heading[];
  activeId: string;
}>();

const emit = defineEmits<{
  (e: "jump", id: string): void;
}>();

const minLevel = computed(() =>
  props.headings.length
    ? Math.min(...props.headings.map((h) => h.level))
    : 1
);
</script>

<template>
  <div class="toc">
    <div class="toc-title">大纲</div>
    <div v-if="!headings.length" class="empty">（无标题）</div>
    <ul v-else class="toc-list">
      <li
        v-for="h in headings"
        :key="h.id + h.text"
        class="toc-item"
        :class="{ active: activeId === h.id }"
        :style="{ paddingLeft: (h.level - minLevel) * 12 + 8 + 'px' }"
        :title="h.text"
        @click="emit('jump', h.id)"
      >
        {{ h.text }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.toc {
  padding: 8px 0;
  font-size: 13px;
}
.toc-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--fg-muted);
  padding: 4px 12px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.toc-item {
  padding: 3px 8px;
  cursor: pointer;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border-left: 2px solid transparent;
}
.toc-item:hover {
  background: var(--bg-btn-hover);
}
.toc-item.active {
  color: var(--link);
  border-left-color: var(--link);
  background: var(--bg-active);
}
:global(:root[data-theme="dark"]) .toc {
  color: var(--fg);
}
:global(:root[data-theme="dark"]) .toc-item {
  padding: 4px 8px;
  color: var(--fg-muted);
  transition: color 0.12s, background-color 0.12s, border-color 0.12s;
}
:global(:root[data-theme="dark"]) .toc-item:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--mdr-accent-teal) 8%, transparent);
}
:global(:root[data-theme="dark"]) .toc-item.active {
  color: var(--fg);
  border-left-color: var(--mdr-accent-teal);
  background: color-mix(in srgb, var(--mdr-accent-teal) 14%, transparent);
  font-weight: 600;
}
.empty {
  padding: 8px 12px;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
