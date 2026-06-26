<script setup lang="ts">
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  visible: boolean;
  title: string;
  message: string;
  fileName: string;
  saveLabel?: string;
  discardLabel?: string;
  cancelLabel?: string;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "discard"): void;
  (e: "cancel"): void;
}>();
</script>

<template>
  <div v-if="visible" class="overlay" @click.self="emit('cancel')">
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="title">{{ title }}</div>
      <div class="file" :title="fileName">{{ fileName }}</div>
      <div class="message">{{ message }}</div>
      <div class="actions">
        <button class="btn" @click="emit('cancel')">
          {{ cancelLabel || t("editor.cancel") }}
        </button>
        <button class="btn danger" @click="emit('discard')">
          {{ discardLabel || t("editor.discardAndContinue") }}
        </button>
        <button class="btn primary" @click="emit('save')">
          {{ saveLabel || t("editor.saveAndContinue") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 60;
}
.dialog {
  width: min(520px, calc(100vw - 40px));
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
  padding: 22px 24px 18px;
}
.title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.file {
  font-size: 13px;
  color: var(--link);
  margin-bottom: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.message {
  font-size: 13px;
  line-height: 1.7;
  color: var(--fg-muted);
  margin-bottom: 20px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg);
  cursor: pointer;
}
.btn:hover {
  background: var(--bg-btn-hover);
}
.btn.primary {
  background: var(--link);
  color: #fff;
  border-color: var(--link);
}
.btn.danger {
  color: var(--mdr-danger);
}
</style>
