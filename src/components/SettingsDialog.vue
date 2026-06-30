<script setup lang="ts">
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "vue-i18n";
import { useReadingSettings } from "../composables/useReadingSettings";

const { t } = useI18n();
const associationBusy = ref(false);
const associationStatus = ref<"" | "success" | "error">("");
const associationMessage = ref("");

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const {
  settings,
  fontOptions,
  setFontSize,
  setLineHeight,
  setMaxWidth,
  setFontFamily,
  reset,
} = useReadingSettings();

async function registerAssociations() {
  associationBusy.value = true;
  associationStatus.value = "";
  associationMessage.value = "";
  try {
    await invoke("register_file_associations");
    associationStatus.value = "success";
    associationMessage.value = t("settings.associationSuccess");
  } catch (e: any) {
    associationStatus.value = "error";
    associationMessage.value = `${t("settings.associationFailed")}: ${e?.message ?? e}`;
  } finally {
    associationBusy.value = false;
  }
}
</script>

<template>
  <div v-if="visible" class="overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="title">
        {{ t("settings.title") }}
        <button class="close" @click="emit('close')">✕</button>
      </div>

      <div class="row">
        <label>{{ t("settings.fontSize") }}</label>
        <input
          type="range"
          :value="settings.fontSize"
          min="12"
          max="24"
          step="1"
          @input="(e) => setFontSize(Number((e.target as HTMLInputElement).value))"
        />
        <span class="value">{{ settings.fontSize }}px</span>
      </div>

      <div class="row">
        <label>{{ t("settings.lineHeight") }}</label>
        <input
          type="range"
          :value="settings.lineHeight"
          min="1.3"
          max="2.2"
          step="0.05"
          @input="(e) => setLineHeight(Number((e.target as HTMLInputElement).value))"
        />
        <span class="value">{{ settings.lineHeight.toFixed(2) }}</span>
      </div>

      <div class="row">
        <label>{{ t("settings.maxWidth") }}</label>
        <input
          type="range"
          :value="settings.maxWidth"
          min="640"
          max="1320"
          step="20"
          @input="(e) => setMaxWidth(Number((e.target as HTMLInputElement).value))"
        />
        <span class="value">{{ settings.maxWidth }}px</span>
      </div>

      <div class="row">
        <label>{{ t("settings.fontFamily") }}</label>
        <select
          :value="settings.fontFamily"
          @change="(e) => setFontFamily((e.target as HTMLSelectElement).value)"
        >
          <option
            v-for="opt in fontOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>

      <div class="association">
        <div>
          <div class="association-title">{{ t("settings.fileAssociation") }}</div>
          <div class="association-hint">{{ t("settings.fileAssociationHint") }}</div>
          <div
            v-if="associationMessage"
            class="association-status"
            :class="associationStatus"
          >
            {{ associationMessage }}
          </div>
        </div>
        <button
          class="btn"
          :disabled="associationBusy"
          @click="registerAssociations"
        >
          {{ associationBusy ? t("settings.registering") : t("settings.registerAssociation") }}
        </button>
      </div>

      <div class="footer">
        <button class="btn" @click="reset">{{ t("settings.reset") }}</button>
        <button class="btn primary" @click="emit('close')">{{ t("settings.done") }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}
.dialog {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 20px 24px;
  min-width: 420px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
  color: var(--fg);
}
.title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
  display: flex;
  justify-content: space-between;
}
.close {
  background: transparent;
  border: none;
  color: var(--fg-muted);
  cursor: pointer;
  font-size: 14px;
}
.row {
  display: grid;
  grid-template-columns: 80px 1fr 60px;
  align-items: center;
  gap: 12px;
  margin: 10px 0;
  font-size: 13px;
}
.row label {
  color: var(--fg-muted);
}
.row .value {
  text-align: right;
  color: var(--fg-muted);
  font-variant-numeric: tabular-nums;
}
select {
  grid-column: 2 / span 2;
  padding: 4px 8px;
  background: var(--bg-btn);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.association {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.association-title {
  font-size: 13px;
  font-weight: 600;
}
.association-hint {
  margin-top: 4px;
  color: var(--fg-muted);
  font-size: 12px;
  line-height: 1.5;
}
.association-status {
  margin-top: 6px;
  font-size: 12px;
}
.association-status.success {
  color: var(--link);
}
.association-status.error {
  color: #c00;
}
.footer {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.btn {
  font-size: 13px;
  padding: 5px 14px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg);
  border-radius: 6px;
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
</style>
