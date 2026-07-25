<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Tab } from "../composables/useTabs";

const props = defineProps<{
  tab: Tab;
  visible: boolean;
  onReload: () => void;
  onViewDiff: () => void;
  onIgnore: () => void;
  onAutoReload: () => void;
}>();

const emit = defineEmits<{
  (e: "reload"): void;
  (e: "view-diff"): void;
  (e: "ignore"): void;
  (e: "auto-reload"): void;
}>();

const { t } = useI18n();

const fileName = computed(() => {
  const parts = props.tab.path.split(/[\\/]/);
  return parts[parts.length - 1];
});

const timeText = computed(() => {
  if (!props.tab.staleSince) return "";
  const diff = Date.now() - props.tab.staleSince;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  return Math.floor(minutes / 60) + "小时前";
});
</script>

<template>
  <div
    v-if="visible"
    class="banner"
    role="alert"
    aria-live="polite"
  >
    <span class="banner-icon">⚠</span>
    <span class="banner-filename">{{ fileName }}</span>
    <span class="banner-message">
      {{ t("editor.externalChangedTitle") }}
      <span class="banner-time">（{{ timeText }}）</span>
    </span>
    <div class="banner-actions">
      <button
        class="btn-primary"
        data-action="reload"
        @click="onReload"
      >
        {{ t("banner.reload") }}
      </button>
      <button
        class="btn-secondary"
        data-action="view-diff"
        @click="onViewDiff"
      >
        {{ t("banner.viewDiff") }}
      </button>
      <button
        class="btn-secondary"
        data-action="ignore"
        @click="onIgnore"
      >
        {{ t("banner.ignore") }}
      </button>
      <button
        class="btn-link"
        data-action="auto-reload"
        @click="onAutoReload"
      >
        {{ t("banner.autoReload") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  background: var(--banner-bg, #fef3c7);
  border-bottom: 1px solid var(--banner-border, #f59e0b);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  animation: bannerSlideDown 0.25s ease-out;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

@keyframes bannerSlideDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.banner-icon {
  flex: 0 0 auto;
  font-size: 18px;
}

.banner-filename {
  flex: 0 0 auto;
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.banner-message {
  flex: 1 1 auto;
  font-size: 13px;
  color: var(--fg-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.banner-time {
  font-size: 12px;
  color: var(--fg-faint, #9ca3af);
}

.banner-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-primary {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--link);
  background: var(--link);
  color: #fff;
  cursor: pointer;
}

.btn-secondary {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  cursor: pointer;
}

.btn-secondary:hover {
  background: var(--bg-btn-hover);
}

.btn-link {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--fg-muted);
  cursor: pointer;
  text-decoration: underline;
}

.btn-link:hover {
  color: var(--fg);
}
</style>
