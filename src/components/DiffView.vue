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

/**
 * 基于 LCS（最长公共子序列）计算行级差异。
 * 相比逐行下标比较，能正确处理中间插入/删除，避免产生错误的增删行。
 */
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const m = a.length;
  const n = b.length;

  // 超大文件保护：超过阈值时退化为整体替换，避免 O(m*n) 内存膨胀卡死
  if (m * n > 4_000_000) {
    const lines: DiffLine[] = [];
    for (const line of a) lines.push({ type: "removed", text: line });
    for (const line of b) lines.push({ type: "added", text: line });
    return lines;
  }

  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0)
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: "unchanged", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "removed", text: a[i] });
      i++;
    } else {
      result.push({ type: "added", text: b[j] });
      j++;
    }
  }
  while (i < m) result.push({ type: "removed", text: a[i++] });
  while (j < n) result.push({ type: "added", text: b[j++] });
  return result;
}

const diffLines = computed<DiffLine[]>(() => {
  if (!props.visible) return [];
  return computeDiff(props.oldContent, props.newContent);
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
