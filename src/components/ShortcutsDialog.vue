<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import { useShortcuts } from "../composables/useShortcuts";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const { t } = useI18n();
const {
  defs,
  getBinding,
  setBinding,
  resetBinding,
  resetAll,
  isCustom,
  normalizeEvent,
  formatBinding,
  isValidCombo,
  isModifierKey,
} = useShortcuts();

const recordingId = ref<string | null>(null);
const conflictMsg = ref("");

const categories = [
  { key: "global", label: "shortcuts.categoryGlobal" },
  { key: "find", label: "shortcuts.categoryFind" },
  { key: "editor", label: "shortcuts.categoryEditor" },
] as const;

const grouped = computed(() =>
  categories.map((cat) => ({
    ...cat,
    items: defs.filter((d) => d.category === cat.key),
  }))
);

function startRecording(id: string) {
  recordingId.value = id;
  conflictMsg.value = "";
}

function cancelRecording() {
  recordingId.value = null;
  conflictMsg.value = "";
}

function onRecordKey(e: KeyboardEvent) {
  if (!props.visible) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === "Escape") {
    if (recordingId.value) cancelRecording();
    else emit("close");
    return;
  }

  if (!recordingId.value) return;

  if (isModifierKey(e.key)) return;

  const combo = normalizeEvent(e);
  if (!isValidCombo(combo)) {
    conflictMsg.value = t("shortcuts.invalid");
    return;
  }

  const result = setBinding(recordingId.value, combo);
  if (!result.ok) {
    conflictMsg.value = t("shortcuts.conflict", { name: result.conflict });
  } else {
    recordingId.value = null;
    conflictMsg.value = "";
  }
}

onMounted(() => {
  window.addEventListener("keydown", onRecordKey, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onRecordKey, true);
});
</script>

<template>
  <div v-if="visible" class="sc-overlay" @click.self="emit('close')">
    <div class="sc-dialog">
      <div class="sc-title">
        {{ t("shortcuts.title") }}
        <button class="sc-close" @click="emit('close')">✕</button>
      </div>
      <div class="sc-content">
        <div v-for="cat in grouped" :key="cat.key" class="sc-category">
          <div class="sc-cat-title">{{ t(cat.label) }}</div>
          <div v-for="item in cat.items" :key="item.id" class="sc-item">
            <div class="sc-row">
              <span class="sc-desc">{{ t(`shortcuts.${item.descKey}`) }}</span>
              <div class="sc-binding">
                <button
                  v-if="!item.readonly"
                  class="sc-key"
                  :class="{ recording: recordingId === item.id }"
                  @click="startRecording(item.id)"
                >
                  {{
                    recordingId === item.id
                      ? t("shortcuts.recording")
                      : formatBinding(getBinding(item.id))
                  }}
                </button>
                <span v-else class="sc-key readonly">{{
                  item.defaultBinding
                }}</span>
                <button
                  v-if="!item.readonly && isCustom(item.id)"
                  class="sc-reset"
                  :title="t('shortcuts.reset')"
                  @click="resetBinding(item.id)"
                >
                  ↺
                </button>
              </div>
            </div>
            <div
              v-if="recordingId === item.id && conflictMsg"
              class="sc-conflict"
            >
              {{ conflictMsg }}
            </div>
          </div>
        </div>
      </div>
      <div class="sc-footer">
        <button class="sc-btn" @click="resetAll">
          {{ t("shortcuts.resetAll") }}
        </button>
        <button class="sc-btn primary" @click="emit('close')">
          {{ t("shortcuts.done") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sc-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
}
.sc-dialog {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 460px;
  max-width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  color: var(--fg);
}
.sc-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.sc-close {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 14px;
}
.sc-close:hover {
  color: var(--fg);
}
.sc-content {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.sc-category {
  margin-bottom: 16px;
}
.sc-cat-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.sc-item {
  margin-bottom: 2px;
}
.sc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}
.sc-desc {
  color: var(--fg);
}
.sc-binding {
  display: flex;
  align-items: center;
  gap: 6px;
}
.sc-key {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  padding: 3px 10px;
  min-width: 72px;
  text-align: center;
  background: var(--bg-btn);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.sc-key:hover {
  border-color: var(--link);
}
.sc-key.recording {
  border-color: var(--link);
  color: var(--link);
  animation: pulse 1s infinite;
}
.sc-key.readonly {
  cursor: default;
  opacity: 0.6;
}
.sc-key.readonly:hover {
  border-color: var(--border);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
.sc-reset {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
  border-radius: 3px;
}
.sc-reset:hover {
  color: var(--fg);
  background: var(--bg-btn);
}
.sc-conflict {
  font-size: 11px;
  color: #c00;
  margin-top: 2px;
  text-align: right;
  padding-right: 28px;
}
.sc-footer {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.sc-btn {
  font-size: 13px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg);
  border-radius: 6px;
  cursor: pointer;
}
.sc-btn:hover {
  background: var(--bg-btn-hover);
}
.sc-btn.primary {
  background: var(--link);
  color: #fff;
  border-color: var(--link);
}
</style>
