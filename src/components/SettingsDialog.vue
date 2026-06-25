<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { useReadingSettings } from "../composables/useReadingSettings";

const { t } = useI18n();

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
