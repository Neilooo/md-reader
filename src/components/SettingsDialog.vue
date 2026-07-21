<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "vue-i18n";
import { useReadingSettings } from "../composables/useReadingSettings";
import { getCachedPandocRefDoc, setCachedPandocRefDoc } from "../composables/useExport";

const RELEASE_API = "https://api.github.com/repos/Neilooo/md-reader/releases/latest";
const RELEASE_LATEST_URL = "https://github.com/Neilooo/md-reader/releases/latest";

type UpdateStatus = "idle" | "checking" | "latest" | "available" | "error";

interface LatestRelease {
  tag_name?: string;
  html_url?: string;
}

const { t } = useI18n();
const associationBusy = ref(false);
const associationStatus = ref<"" | "success" | "error">("");
const associationMessage = ref("");
const currentVersion = ref("");
const updateStatus = ref<UpdateStatus>("idle");
const updateMessage = ref("");
const latestVersion = ref("");
const latestReleaseUrl = ref(RELEASE_LATEST_URL);
const updateBusy = computed(() => updateStatus.value === "checking");
const updateStatusClass = computed(() => ({
  success: updateStatus.value === "available" || updateStatus.value === "latest",
  error: updateStatus.value === "error",
}));

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

function parseVersion(version: string) {
  const [core, pre = ""] = normalizeVersion(version).split("-", 2);
  const nums = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
    pre,
  };
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (av[key] > bv[key]) return 1;
    if (av[key] < bv[key]) return -1;
  }
  if (av.pre === bv.pre) return 0;
  if (!av.pre) return 1;
  if (!bv.pre) return -1;
  return av.pre.localeCompare(bv.pre, undefined, { numeric: true });
}

async function loadCurrentVersion() {
  try {
    currentVersion.value = await getVersion();
  } catch {
    currentVersion.value = "";
  }
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const controller = new globalThis.AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as LatestRelease;
  } finally {
    window.clearTimeout(timer);
  }
}

async function checkForUpdates() {
  updateStatus.value = "checking";
  updateMessage.value = "";
  try {
    if (!currentVersion.value) await loadCurrentVersion();
    if (!currentVersion.value) throw new Error(t("settings.versionUnavailable"));

    const release = await fetchLatestRelease();
    const remoteTag = release.tag_name || "";
    if (!remoteTag) throw new Error("Missing tag_name");

    latestVersion.value = normalizeVersion(remoteTag);
    latestReleaseUrl.value = release.html_url || RELEASE_LATEST_URL;

    if (compareVersions(latestVersion.value, currentVersion.value) > 0) {
      updateStatus.value = "available";
      updateMessage.value = t("settings.updateAvailable", {
        version: latestVersion.value,
      });
    } else {
      updateStatus.value = "latest";
      updateMessage.value = t("settings.upToDate", {
        version: currentVersion.value,
      });
    }
  } catch (e: unknown) {
    updateStatus.value = "error";
    updateMessage.value = `${t("settings.updateCheckFailed")}: ${e instanceof Error ? e.message : String(e)}`;
    latestReleaseUrl.value = RELEASE_LATEST_URL;
  }
}

async function openReleasePage() {
  await openUrl(latestReleaseUrl.value || RELEASE_LATEST_URL);
}

const pandocRefDoc = ref(getCachedPandocRefDoc() ?? "");

async function pickPandocRefDoc() {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Word Document", extensions: ["docx"] }],
  });
  if (typeof selected === "string") {
    pandocRefDoc.value = selected;
    setCachedPandocRefDoc(selected);
  }
}

function clearPandocRefDoc() {
  pandocRefDoc.value = "";
  setCachedPandocRefDoc(null);
}

onMounted(loadCurrentVersion);

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

const {
  settings,
  fontOptions,
  setFontSize,
  setLineHeight,
  setMaxWidth,
  setFontFamily,
  setEditorFontSize,
  setTocPosition,
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
        <label>{{ t("settings.editorFontSize") }}</label>
        <input
          type="range"
          :value="settings.editorFontSize"
          min="12"
          max="24"
          step="1"
          @input="(e) => setEditorFontSize(Number((e.target as HTMLInputElement).value))"
        />
        <span class="value">{{ settings.editorFontSize }}px</span>
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

      <div class="row">
        <label>{{ t("settings.tocPosition") }}</label>
        <select
          :value="settings.tocPosition"
          @change="(e) => setTocPosition((e.target as HTMLSelectElement).value as 'left' | 'right')"
        >
          <option value="left">{{ t("settings.tocLeft") }}</option>
          <option value="right">{{ t("settings.tocRight") }}</option>
        </select>
      </div>

      <div class="association">
        <div>
          <div class="association-title">{{ t("settings.updateCheck") }}</div>
          <div class="association-hint">
            {{ t("settings.currentVersion", { version: currentVersion || "-" }) }}
          </div>
          <div
            v-if="updateMessage"
            class="association-status"
            :class="updateStatusClass"
          >
            {{ updateMessage }}
          </div>
        </div>
        <div class="update-actions">
          <button class="btn" :disabled="updateBusy" @click="checkForUpdates">
            {{ updateBusy ? t("settings.checkingUpdate") : t("settings.checkUpdate") }}
          </button>
          <button
            v-if="updateStatus === 'available' || updateStatus === 'error'"
            class="btn primary"
            @click="openReleasePage"
          >
            {{ t("settings.openReleasePage") }}
          </button>
        </div>
      </div>

      <div class="association">
        <div>
          <div class="association-title">{{ t("settings.pandocTemplate") }}</div>
          <div class="association-hint">
            <span v-if="pandocRefDoc" class="ref-doc-path" :title="pandocRefDoc">
              {{ pandocRefDoc }}
            </span>
            <span v-else>{{ t("settings.pandocTemplateHint") }}</span>
          </div>
        </div>
        <div class="update-actions">
          <button class="btn" @click="pickPandocRefDoc">
            {{ t("settings.chooseTemplate") }}
          </button>
          <button v-if="pandocRefDoc" class="btn" @click="clearPandocRefDoc">
            {{ t("settings.clearTemplate") }}
          </button>
        </div>
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
.update-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ref-doc-path {
  display: inline-block;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  direction: rtl;
  unicode-bidi: plaintext;
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
