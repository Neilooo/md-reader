<script setup lang="ts">
import { ref } from "vue";
import type { TreeNode } from "../composables/useFileTree";

defineProps<{
  nodes: TreeNode[];
  currentPath: string;
  depth?: number;
}>();

const emit = defineEmits<{
  (e: "open", path: string): void;
}>();

const collapsed = ref<Record<string, boolean>>({});

function toggle(key: string) {
  collapsed.value[key] = !collapsed.value[key];
}
</script>

<template>
  <ul class="tree" :class="{ root: !depth }">
    <li v-for="node in nodes" :key="node.path || node.name" class="tree-item">
      <template v-if="node.isDir">
        <div
          class="row dir"
          :style="{ paddingLeft: (depth || 0) * 12 + 8 + 'px' }"
          @click="toggle(node.name + ':' + (depth || 0))"
        >
          <span class="caret">
            {{ collapsed[node.name + ":" + (depth || 0)] ? "▶" : "▼" }}
          </span>
          <span class="name">{{ node.name }}</span>
        </div>
        <FileTree
          v-if="!collapsed[node.name + ':' + (depth || 0)] && node.children"
          :nodes="node.children"
          :current-path="currentPath"
          :depth="(depth || 0) + 1"
          @open="(p) => emit('open', p)"
        />
      </template>
      <template v-else>
        <div
          class="row file"
          :class="{ active: currentPath === node.path }"
          :style="{ paddingLeft: (depth || 0) * 12 + 22 + 'px' }"
          :title="node.path"
          @click="emit('open', node.path)"
        >
          <span class="name">{{ node.name }}</span>
        </div>
      </template>
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
}
.tree.root {
  padding: 4px 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px 3px 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg);
  user-select: none;
}
.row:hover {
  background: var(--bg-btn-hover);
}
.row.active {
  background: var(--bg-active);
  color: var(--link);
}
.caret {
  font-size: 10px;
  color: var(--fg-muted);
  width: 12px;
  display: inline-block;
}
.dir .name {
  font-weight: 500;
  color: var(--fg);
}
.file .name {
  color: var(--fg);
}
:global(:root[data-theme="dark"]) .row {
  gap: 5px;
  padding: 4px 8px;
  color: #d8dee9;
  border-left: 2px solid transparent;
}
:global(:root[data-theme="dark"]) .row:hover {
  background: var(--mdr-panel-soft);
}
:global(:root[data-theme="dark"]) .row.active {
  background: color-mix(in srgb, var(--mdr-accent-gold) 18%, transparent);
  color: #fff7e8;
  border-left-color: var(--mdr-accent-gold);
}
:global(:root[data-theme="dark"]) .caret {
  color: var(--mdr-panel-muted);
}
:global(:root[data-theme="dark"]) .dir .name {
  font-weight: 600;
  color: #f1f5f9;
}
:global(:root[data-theme="dark"]) .file .name {
  color: #d8dee9;
}
:global(:root[data-theme="dark"]) .row.active .name {
  color: #fff7e8;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
