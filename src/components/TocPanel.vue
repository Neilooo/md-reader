<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { Heading } from "../composables/useMarkdown";

const { t } = useI18n();

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

const collapsed = ref<Set<number>>(new Set());

watch(
  () => props.headings,
  () => {
    collapsed.value = new Set();
  }
);

const visibleIndices = computed(() => {
  const result: number[] = [];
  const stack: { index: number; level: number }[] = [];
  for (let i = 0; i < props.headings.length; i++) {
    const h = props.headings[i];
    while (stack.length > 0 && stack[stack.length - 1].level >= h.level) {
      stack.pop();
    }
    if (!stack.some((s) => collapsed.value.has(s.index))) {
      result.push(i);
    }
    stack.push({ index: i, level: h.level });
  }
  return result;
});

function hasChildren(index: number): boolean {
  return (
    index < props.headings.length - 1 &&
    props.headings[index + 1].level > props.headings[index].level
  );
}

function toggleCollapse(index: number) {
  const next = new Set(collapsed.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  collapsed.value = next;
}

function expandAll() {
  collapsed.value = new Set();
}

function collapseAll() {
  const top = new Set<number>();
  for (let i = 0; i < props.headings.length; i++) {
    if (props.headings[i].level > minLevel.value && hasChildren(i)) {
      top.add(i);
    }
  }
  collapsed.value = top;
}
</script>

<template>
  <div class="toc">
    <div class="toc-title">
      <span>{{ t("toc.title") }}</span>
      <span v-if="headings.length" class="toc-actions">
        <button class="toc-action" @click="expandAll" :title="t('toc.expandAll')">
          ⊕
        </button>
        <button class="toc-action" @click="collapseAll" :title="t('toc.collapseAll')">
          ⊖
        </button>
      </span>
    </div>
    <div v-if="!headings.length" class="empty">{{ t("toc.empty") }}</div>
    <ul v-else class="toc-list">
      <li
        v-for="idx in visibleIndices"
        :key="headings[idx].id + headings[idx].text"
        class="toc-item"
        :class="{ active: activeId === headings[idx].id }"
        :style="{ paddingLeft: (headings[idx].level - minLevel) * 12 + 4 + 'px' }"
        :title="headings[idx].text"
        @click="emit('jump', headings[idx].id)"
      >
        <span
          v-if="hasChildren(idx)"
          class="toc-toggle"
          @click.stop="toggleCollapse(idx)"
        >
          {{ collapsed.has(idx) ? "▶" : "▼" }}
        </span>
        <span v-else class="toc-toggle-spacer"></span>
        <span class="toc-text">{{ headings[idx].text }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.toc {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: 13px;
}
.toc-title {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--fg-muted);
  padding: 4px 12px 8px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.toc-actions {
  margin-left: auto;
  display: flex;
  gap: 2px;
}
.toc-action {
  padding: 0 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--fg-muted);
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
}
.toc-action:hover {
  color: var(--fg);
  background: var(--bg-btn-hover);
}
.toc-list {
  flex: 1 1 auto;
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  min-height: 0;
}
.toc-item {
  display: flex;
  align-items: center;
  padding: 3px 8px 3px 4px;
  cursor: pointer;
  color: var(--toc-item-color);
  border-left: 2px solid transparent;
  transition: color 0.12s, background-color 0.12s, box-shadow 0.12s;
}
.toc-item:hover {
  color: var(--toc-hover-color);
  background: var(--toc-hover-bg);
}
.toc-item.active {
  color: var(--toc-active-color);
  border-left-color: var(--toc-active-line);
  background: var(--toc-active-bg);
  box-shadow: var(--toc-active-shadow);
  font-weight: 600;
}
.toc-toggle {
  flex: 0 0 16px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  font-size: 10px;
}
.toc-toggle-spacer {
  flex: 0 0 16px;
}
.toc-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  padding: 8px 12px;
  color: var(--fg-muted);
  font-size: 12px;
}
</style>
