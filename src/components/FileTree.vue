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
    <li v-for="(node, idx) in nodes" :key="node.path || `${node.name}:${depth || 0}:${idx}`" class="tree-item">
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
  color: var(--tree-row-color);
  user-select: none;
}
.row:hover {
  background: var(--tree-row-hover-bg);
}
.row.active {
  background: var(--tree-row-active-bg);
  color: var(--tree-row-active-color);
  box-shadow: var(--tree-row-active-shadow);
}
.caret {
  font-size: 10px;
  color: var(--tree-caret-color);
  width: 12px;
  display: inline-block;
}
.dir .name {
  font-weight: 500;
  color: var(--tree-dir-color);
}
.file .name {
  color: var(--tree-file-color);
}
.row.active .name {
  color: var(--tree-row-active-color);
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
