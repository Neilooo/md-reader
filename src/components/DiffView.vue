<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  oldContent: string;
  newContent: string;
  fileName: string;
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const { t } = useI18n();

interface DiffLine {
  type: "added" | "removed" | "unchanged";
  text: string;
}

const diffLines = computed<DiffLine[]>(() => {
  if (!props.visible) return [];

  const oldLines = props.oldContent.split("\n");
  const newLines = props.newContent.split("\n");
  const lines: DiffLine[] = [];

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    const oldText = i < oldLines.length ? oldLines[i] : "";
    const newText = i < newLines.length ? newLines[i] : "";

    if (oldText === newText) {
      lines.push({ type: "unchanged", text: newText });
    } else if (i < newLines.length && i < oldLines.length) {
      // Same index but different content: show both
      lines.push({ type: "added", text: newText });
      lines.push({ type: "removed", text: oldText });
    } else if (i < newLines.length) {
      // New line exists but old doesn't
      lines.push({ type: "added", text: newText });
    } else {
      // Old line exists but new doesn't
      lines.push({ type: "removed", text: oldText });
    }
  }

  return lines;
});

const hasChanges = computed(() =>
  diffLines.value.some((l) => l.type === "added" || l.type === "removed")
);

function onClose() {
  emit("close");
}
</script>

<template>
  <div v-if="visible" class="diff-overlay" @click="onClose">
    <div class="diff-view" @click.stop>
      <div class="diff-header">
        <h3 class="diff-title">{{ t("diff.title") }}</h3>
        <span class="diff-filename">{{ fileName }}</span>
        <button
          class="diff-close"
          data-action="close"
          @click="onClose"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="diff-content">
        <div v-if="!hasChanges" class="diff-empty">
          {{ t("diff.noChanges") }}
        </div>
        <div v-else class="diff-lines">
          <div
            v-for="(line, idx) in diffLines"
            :key="idx"
            :class="['diff-line', line.type]"
          >
            <span class="diff-sign">
              {{ line.type === "added" ? "+" : line.type === "removed" ? "−" : " " }}
            </span>
            <span class="diff-text">{{ line.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-overlay {
  position: fixed;
  inset: 0;
  z-index: 101;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.diff-view {
  width: min(700px, 90vw);
  max-height: 80vh;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.diff-header {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 12px;
}

.diff-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.diff-filename {
  flex: 1 1 auto;
  font-size: 13px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: right;
}

.diff-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}

.diff-close:hover {
  background: var(--bg-btn-hover);
  color: var(--fg);
}

.diff-content {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px 0;
}

.diff-empty {
  padding: 20px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
}

.diff-lines {
  font-family: var(--reader-font-family, monospace);
  font-size: 13px;
  line-height: 1.5;
}

.diff-line {
  display: flex;
  align-items: stretch;
}

.diff-line.added {
  background: rgba(34, 197, 94, 0.12);
}

.diff-line.removed {
  background: rgba(239, 68, 68, 0.12);
}

.diff-sign {
  flex: 0 0 24px;
  text-align: center;
  color: var(--fg-muted);
  user-select: none;
}

.diff-line.added .diff-sign {
  color: #16a34a;
}

.diff-line.removed .diff-sign {
  color: #dc2626;
}

.diff-text {
  flex: 1 1 auto;
  padding: 0 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
