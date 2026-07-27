<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import type { TreeNode } from "../composables/useFileTree";

const props = withDefaults(
  defineProps<{
    nodes: TreeNode[];
    currentPath: string;
    depth?: number;
    scrollContainer?: HTMLElement | null;
  }>(),
  {
    depth: 0,
    scrollContainer: null,
  }
);

const emit = defineEmits<{
  (e: "open", path: string): void;
}>();

const collapsed = ref<Record<string, boolean>>({});

function toggle(key: string) {
  collapsed.value[key] = !collapsed.value[key];
}

/** 递归展开目标文件路径上的所有父目录 */
function expandAncestors(nodes: TreeNode[], target: string) {
  for (const node of nodes) {
    if (node.isDir) {
      if (target.startsWith(node.path)) {
        collapsed.value[node.path] = false;
        if (node.children) expandAncestors(node.children, target);
      }
    }
  }
}

/** currentPath 变化时：先折叠所有目录，再展开目标文件路径上的父目录，最后滚动定位 */
watch(
  () => props.currentPath,
  (newPath) => {
    if (!newPath) return;

    // 折叠所有目录（重置状态）
    function collapseAll(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.isDir) {
          collapsed.value[node.path] = true;
          if (node.children) collapseAll(node.children);
        }
      }
    }
    collapseAll(props.nodes);

    // 展开目标路径上的父目录
    expandAncestors(props.nodes, newPath);

    nextTick(() => {
      setTimeout(() => {
        const container = props.scrollContainer;
        if (container) {
          const active = container.querySelector(".row.file.active") as HTMLElement | null;
          if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 50);
    });
  }
);
</script>

<template>
  <ul class="tree" :class="{ root: !depth }">
    <li v-for="node in nodes" :key="node.path || node.name" class="tree-item">
      <template v-if="node.isDir">
        <div
          class="row dir"
          :class="{ 'is-collapsed': collapsed[node.path] }"
          :style="{ paddingLeft: (depth || 0) * 12 + 8 + 'px' }"
          @click="toggle(node.path)"
        >
          <span class="caret">
            <svg v-if="collapsed[node.path]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 6 15 12 9 18"/>
            </svg>
            <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
          <span class="name">{{ node.name }}</span>
        </div>
        <FileTree
          v-if="!collapsed[node.path] && node.children"
          :nodes="node.children"
          :current-path="currentPath"
          :depth="(depth || 0) + 1"
          :scroll-container="scrollContainer"
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
  display: flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  color: var(--tree-caret-color);
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
