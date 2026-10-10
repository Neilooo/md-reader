<!--
  设置对话框：两个标签页——「阅读」（阅读区/编辑器排版、背景色预设、更新
  检查、pandoc 模板、文件关联、快捷键入口）与「PDF 导出」（24 套样式模板、
  字体/颜色/页面参数 + iframe 实时预览，逻辑在 usePdfStyle / usePdfPreview）。
  阅读设置项的持久化在 useReadingSettings（plugin-store），本组件只做 UI。
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18n } from "vue-i18n";
import { useReadingSettings } from "../composables/useReadingSettings";
import { usePdfStyle } from "../composables/usePdfStyle";
import { usePdfPreview } from "../composables/usePdfPreview";
import {
  getCachedPandocRefDoc,
  setCachedPandocRefDoc,
} from "../composables/useExport";
import ShortcutsDialog from "./ShortcutsDialog.vue";

// 版本更新检查：走 GitHub Releases API（latest），不引入更新器。
const RELEASE_API =
  "https://api.github.com/repos/Neilooo/md-reader/releases/latest";
const RELEASE_LATEST_URL =
  "https://github.com/Neilooo/md-reader/releases/latest";

type UpdateStatus = "idle" | "checking" | "latest" | "available" | "error";

interface LatestRelease {
  tag_name?: string;
  html_url?: string;
}

const { t } = useI18n();
// 文件关联注册（Windows 绿色版手动触发，见后端 register_file_associations）
const associationBusy = ref(false);
const associationStatus = ref<"" | "success" | "error">("");
const associationMessage = ref("");
// 版本更新检查状态
const currentVersion = ref("");
const updateStatus = ref<UpdateStatus>("idle");
const updateMessage = ref("");
const latestVersion = ref("");
const latestReleaseUrl = ref(RELEASE_LATEST_URL);
const updateBusy = computed(() => updateStatus.value === "checking");
const updateStatusClass = computed(() => ({
  success:
    updateStatus.value === "available" || updateStatus.value === "latest",
  error: updateStatus.value === "error",
}));

/** 去掉 tag 前缀的 "v"，统一成裸版本号再比较。 */
function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, "");
}

/** 解析 "1.2.3-beta" 形态：主/次/补丁 + 预发布后缀。 */
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

/** 语义化版本比较：返回正/零/负。无预发布后缀的版本 > 有后缀的（1.0 > 1.0-rc1）。 */
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

/** 请求 GitHub Releases API，8s 超时（不翻墙可能超时，必须可中止）。 */
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

/** 检查更新：比较远端 tag 与本地版本，结果写入状态供模板展示。 */
async function checkForUpdates() {
  updateStatus.value = "checking";
  updateMessage.value = "";
  try {
    if (!currentVersion.value) await loadCurrentVersion();
    if (!currentVersion.value)
      throw new Error(t("settings.versionUnavailable"));

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

// ---- pandoc DOCX 参考模板（DOCX 导出的样式基准） ----
// 注意 ref 只在组件创建时读一次缓存；真正的选择结果立即写回 useExport
// 的模块级缓存，导出时从那边取，与对话框是否开着无关。
const pandocRefDoc = ref(getCachedPandocRefDoc() ?? "");

/** 文件选择器挑一个 .docx 作为 pandoc --reference-doc。 */
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

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ (e: "close"): void }>();

// 快捷键说明弹窗（叠加在本对话框之上，关闭设置时一并收起）
const showShortcuts = ref(false);
// 当前激活的设置标签页：reading / pdf
const settingsTab = ref<"reading" | "pdf">("reading");
watch(
  () => props.visible,
  (v) => {
    if (!v) showShortcuts.value = false;
  }
);

// ---- 阅读设置（排版项的读取/写入全部经 useReadingSettings，含持久化） ----
const {
  settings,
  fontOptions,
  setFontSize,
  setLineHeight,
  setMaxWidth,
  setFontFamily,
  setEditorFontSize,
  setEditorFontFamily,
  setTocPosition,
  setRestoreTabs,
  setReaderBgLight,
  setReaderBgDark,
  resetReaderBg,
  reset,
} = useReadingSettings();

interface ReaderBgPreset {
  i18nKey: string;
  value: string | null; // null = 恢复默认背景（跟随主题）
}

// 亮/暗主题各自的阅读区背景色预设（value 为 null 表示默认）
const lightBgPresets: ReaderBgPreset[] = [
  { i18nKey: "settings.presetDefaultLight", value: null },
  { i18nKey: "settings.presetPaper", value: "#f5f0e6" },
  { i18nKey: "settings.presetEyeCare", value: "#eaf4e2" },
  { i18nKey: "settings.presetLightYellow", value: "#fff8dc" },
];

const darkBgPresets: ReaderBgPreset[] = [
  { i18nKey: "settings.presetDefaultDark", value: null },
  { i18nKey: "settings.presetDarkSlate", value: "#1b222c" },
  { i18nKey: "settings.presetDarkWarm", value: "#151515" },
];

// 拾色器回显值：未自定义时给主题默认色（拾色器不接受空值）
const lightBgDisplay = computed(() => settings.value.readerBgLight ?? "#ffffff");
const darkBgDisplay = computed(() => settings.value.readerBgDark ?? "#0d1117");

function onLightBgInput(e: Event) {
  setReaderBgLight((e.target as HTMLInputElement).value);
}

function onDarkBgInput(e: Event) {
  setReaderBgDark((e.target as HTMLInputElement).value);
}

/** 十六进制输入框：空 = 清除自定义；非法格式回填当前值（不打断输入）。 */
function onLightBgHex(e: Event) {
  const el = e.target as HTMLInputElement;
  const v = el.value.trim();
  if (!v) {
    setReaderBgLight(null);
    return;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    setReaderBgLight(v);
  } else {
    el.value = settings.value.readerBgLight ?? "";
  }
}

function onDarkBgHex(e: Event) {
  const el = e.target as HTMLInputElement;
  const v = el.value.trim();
  if (!v) {
    setReaderBgDark(null);
    return;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(v)) {
    setReaderBgDark(v);
  } else {
    el.value = settings.value.readerBgDark ?? "";
  }
}

// ---- PDF 导出样式（模板/字体/颜色/页面参数，见 usePdfStyle） ----
const {
  settings: pdfStyle,
  templates: pdfTemplates,
  templateCategories: pdfTemplateCategories,
  fontChoices: pdfFontChoices,
  codeFontChoices: pdfCodeFontChoices,
  applyTemplate: applyPdfTemplate,
  setOption: setPdfOption,
  setDensity: setPdfDensity,
  reset: resetPdfStyle,
} = usePdfStyle();

// 模板 id → 模板对象映射，模板下拉框按分类分组渲染时按 id 取名
const pdfTemplateMap = computed<Record<string, (typeof pdfTemplates)[number]>>(
  () => {
    const m: Record<string, (typeof pdfTemplates)[number]> = {};
    for (const tpl of pdfTemplates) m[tpl.id] = tpl;
    return m;
  }
);

// PDF 样式实时预览（iframe srcdoc）：compareMode 时并排亮/暗两份
const { previewHtml, previewLight, previewDark, sampleText, compareMode } =
  usePdfPreview();

interface SystemFont {
  name: string;
  monospaced: boolean;
}

// 系统字体列表（阅读/编辑器字体的自定义选项），首次打开设置时懒加载
const systemFonts = ref<string[]>([]);

/** 经 system-fonts 插件拉取系统字体，去重 + 过滤隐藏项 + 按中文 locale 排序。 */
async function loadSystemFonts() {
  if (systemFonts.value.length) return;
  try {
    const fonts = await invoke<SystemFont[]>(
      "plugin:system-fonts|get_system_fonts"
    );
    const seen = new Set<string>();
    systemFonts.value = fonts
      .filter((f) => {
        if (!f.name || f.name.startsWith(".") || seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
      })
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, "zh-CN"));
  } catch {
    /* ignore: 字体列表拉不到就用内置选项 */
  }
}

// 每次打开设置对话框才加载字体（避免启动时无谓的 IPC 往返）
watch(
  () => props.visible,
  (v) => {
    if (v) loadSystemFonts();
  }
);

/** 调用后端注册 Windows 文件关联（绿色版 .md 双击打开）。 */
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

      <div class="tabs">
        <button
          type="button"
          class="tab"
          :class="{ active: settingsTab === 'reading' }"
          @click="settingsTab = 'reading'"
        >
          {{ t("settings.tabReading") }}
        </button>
        <button
          type="button"
          class="tab"
          :class="{ active: settingsTab === 'pdf' }"
          @click="settingsTab = 'pdf'"
        >
          {{ t("settings.tabPdf") }}
        </button>
      </div>

      <!-- ============ 「阅读」标签页 ============ -->
      <div v-show="settingsTab === 'reading'">
        <!-- 阅读区自定义背景色：亮/暗主题分别保存，含预设与恢复默认 -->
        <div class="reader-bg-block">
          <div class="reader-bg-title">{{ t("settings.readerBg") }}</div>

          <div class="reader-bg-group">
            <div class="reader-bg-label">
              {{ t("settings.readerBgLight") }}
            </div>
            <div class="reader-bg-controls">
              <input
                type="color"
                :value="lightBgDisplay"
                @input="onLightBgInput"
              />
              <input
                class="hex-input"
                type="text"
                spellcheck="false"
                :value="settings.readerBgLight ?? ''"
                placeholder="#RRGGBB"
                @change="onLightBgHex"
              />
              <button class="btn-mini" @click="setReaderBgLight(null)">
                {{ t("settings.readerBgReset") }}
              </button>
            </div>
            <div class="reader-bg-presets">
              <button
                v-for="p in lightBgPresets"
                :key="p.i18nKey"
                class="preset-chip"
                :class="{ active: settings.readerBgLight === p.value }"
                @click="setReaderBgLight(p.value)"
              >
                {{ t(p.i18nKey) }}
              </button>
            </div>
          </div>

          <div class="reader-bg-group">
            <div class="reader-bg-label">
              {{ t("settings.readerBgDark") }}
            </div>
            <div class="reader-bg-controls">
              <input
                type="color"
                :value="darkBgDisplay"
                @input="onDarkBgInput"
              />
              <input
                class="hex-input"
                type="text"
                spellcheck="false"
                :value="settings.readerBgDark ?? ''"
                placeholder="#RRGGBB"
                @change="onDarkBgHex"
              />
              <button class="btn-mini" @click="setReaderBgDark(null)">
                {{ t("settings.readerBgReset") }}
              </button>
            </div>
            <div class="reader-bg-presets">
              <button
                v-for="p in darkBgPresets"
                :key="p.i18nKey"
                class="preset-chip"
                :class="{ active: settings.readerBgDark === p.value }"
                @click="setReaderBgDark(p.value)"
              >
                {{ t(p.i18nKey) }}
              </button>
            </div>
          </div>

          <div class="reader-bg-reset-all">
            <button class="btn" @click="resetReaderBg">
              {{ t("settings.readerBgResetAll") }}
            </button>
          </div>
        </div>

        <!-- 排版项：字号 / 行高 / 页宽 / 正文字体（含系统字体）/ 目录位置 -->
        <div class="row">
          <label>{{ t("settings.fontSize") }}</label>
          <input
            type="range"
            :value="settings.fontSize"
            min="12"
            max="24"
            step="1"
            @input="
              (e) => setFontSize(Number((e.target as HTMLInputElement).value))
            "
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
            @input="
              (e) =>
                setEditorFontSize(Number((e.target as HTMLInputElement).value))
            "
          />
          <span class="value">{{ settings.editorFontSize }}px</span>
        </div>

        <div class="row">
          <label>{{ t("settings.editorFontFamily") }}</label>
          <select
            :value="settings.editorFontFamily"
            @change="
              (e) => setEditorFontFamily((e.target as HTMLSelectElement).value)
            "
          >
            <option value="mono">{{ t("settings.mono") }}</option>
            <option disabled>────────</option>
            <option v-for="name in systemFonts" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("settings.lineHeight") }}</label>
          <input
            type="range"
            :value="settings.lineHeight"
            min="1.3"
            max="2.2"
            step="0.05"
            @input="
              (e) => setLineHeight(Number((e.target as HTMLInputElement).value))
            "
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
            @input="
              (e) => setMaxWidth(Number((e.target as HTMLInputElement).value))
            "
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
            <option disabled>────────</option>
            <option v-for="name in systemFonts" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("settings.tocPosition") }}</label>
          <select
            :value="settings.tocPosition"
            @change="
              (e) =>
                setTocPosition(
                  (e.target as HTMLSelectElement).value as 'left' | 'right'
                )
            "
          >
            <option value="left">{{ t("settings.tocLeft") }}</option>
            <option value="right">{{ t("settings.tocRight") }}</option>
          </select>
        </div>

        <!-- 启动时恢复标签页（#38）：关闭后重启是空白欢迎页，
             双击文件启动 / 手动打开不受影响 -->
        <div class="row">
          <label>{{ t("settings.restoreTabs") }}</label>
          <div class="toggle-group" :title="t('settings.restoreTabsHint')">
            <button
              type="button"
              class="seg"
              :class="{ active: settings.restoreTabs }"
              @click="setRestoreTabs(true)"
            >
              {{ t("settings.on") }}
            </button>
            <button
              type="button"
              class="seg"
              :class="{ active: !settings.restoreTabs }"
              @click="setRestoreTabs(false)"
            >
              {{ t("settings.off") }}
            </button>
          </div>
        </div>

        <!-- 以下为操作卡片：更新检查 / pandoc 模板 / 文件关联 / 快捷键 -->
        <div class="association">
          <div>
            <div class="association-title">{{ t("settings.updateCheck") }}</div>
            <div class="association-hint">
              {{
                t("settings.currentVersion", { version: currentVersion || "-" })
              }}
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
              {{
                updateBusy
                  ? t("settings.checkingUpdate")
                  : t("settings.checkUpdate")
              }}
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
            <div class="association-title">
              {{ t("settings.pandocTemplate") }}
            </div>
            <div class="association-hint">
              <span
                v-if="pandocRefDoc"
                class="ref-doc-path"
                :title="pandocRefDoc"
              >
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
            <div class="association-title">
              {{ t("settings.fileAssociation") }}
            </div>
            <div class="association-hint">
              {{ t("settings.fileAssociationHint") }}
            </div>
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
            {{
              associationBusy
                ? t("settings.registering")
                : t("settings.registerAssociation")
            }}
          </button>
        </div>

        <div class="association">
          <div>
            <div class="association-title">{{ t("shortcuts.title") }}</div>
            <div class="association-hint">{{ t("shortcuts.hint") }}</div>
          </div>
          <button class="btn" @click="showShortcuts = true">
            {{ t("shortcuts.view") }}
          </button>
        </div>

        <div class="reading-reset">
          <button class="btn" @click="reset">{{ t("settings.reset") }}</button>
        </div>
      </div>

      <!-- ============ 「PDF 导出」标签页 ============ -->
      <div v-show="settingsTab === 'pdf'" class="section">
        <div class="section-title">{{ t("pdfStyle.title") }}</div>
        <div class="association-hint">{{ t("pdfStyle.previewNote") }}</div>

        <!-- 实时预览：可切换亮/暗并排对比；预览文本可自定义 -->
        <div class="preview-label">
          {{ t("pdfStyle.preview") }}
          <button
            type="button"
            class="compare-toggle"
            :class="{ active: compareMode }"
            @click="compareMode = !compareMode"
          >
            {{ t("pdfStyle.compare") }}
          </button>
        </div>
        <textarea
          v-model="sampleText"
          class="preview-input"
          :placeholder="t('pdfStyle.sampleText')"
          rows="3"
          spellcheck="false"
        ></textarea>
        <template v-if="compareMode">
          <div class="preview-compare">
            <div class="preview-col">
              <div class="preview-col-title">{{ t("pdfStyle.light") }}</div>
              <iframe
                class="pdf-preview"
                :srcdoc="previewLight"
                title="Light preview"
              ></iframe>
            </div>
            <div class="preview-col">
              <div class="preview-col-title">{{ t("pdfStyle.dark") }}</div>
              <iframe
                class="pdf-preview"
                :srcdoc="previewDark"
                title="Dark preview"
              ></iframe>
            </div>
          </div>
        </template>
        <iframe
          v-else
          class="pdf-preview"
          :srcdoc="previewHtml"
          title="PDF style preview"
        ></iframe>

        <!-- 模板按三个分类分组（简约/经典/个性），选中 custom 时单独成组 -->
        <div class="row">
          <label>{{ t("pdfStyle.template") }}</label>
          <select
            :value="pdfStyle.templateId"
            @change="
              (e) =>
                applyPdfTemplate((e.target as HTMLSelectElement).value)
            "
          >
            <optgroup
              v-for="cat in pdfTemplateCategories"
              :key="cat.id"
              :label="t(cat.i18nKey)"
            >
              <option
                v-for="tid in cat.items"
                :key="tid"
                :value="tid"
              >
                {{ t(pdfTemplateMap[tid].i18nKey) }}
              </option>
            </optgroup>
            <optgroup
              v-if="pdfStyle.templateId === 'custom'"
              :label="t('pdfStyle.custom')"
            >
              <option value="custom">{{ t("pdfStyle.custom") }}</option>
            </optgroup>
          </select>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.bodyFont") }}</label>
          <select
            :value="pdfStyle.bodyFont"
            @change="
              (e) =>
                setPdfOption('bodyFont', (e.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="f in pdfFontChoices"
              :key="f.value"
              :value="f.value"
            >
              {{ f.label }}
            </option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.headingFont") }}</label>
          <select
            :value="pdfStyle.headingFont"
            @change="
              (e) =>
                setPdfOption(
                  'headingFont',
                  (e.target as HTMLSelectElement).value
                )
            "
          >
            <option
              v-for="f in pdfFontChoices"
              :key="f.value"
              :value="f.value"
            >
              {{ f.label }}
            </option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.codeFont") }}</label>
          <select
            :value="pdfStyle.codeFont"
            @change="
              (e) =>
                setPdfOption('codeFont', (e.target as HTMLSelectElement).value)
            "
          >
            <option
              v-for="f in pdfCodeFontChoices"
              :key="f.value"
              :value="f.value"
            >
              {{ f.label }}
            </option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.fontSize") }}</label>
          <input
            type="range"
            :value="pdfStyle.fontSize"
            min="12"
            max="24"
            step="1"
            @input="
              (e) =>
                setPdfOption('fontSize', Number((e.target as HTMLInputElement).value))
            "
          />
          <span class="value">{{ pdfStyle.fontSize }}px</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.lineHeight") }}</label>
          <input
            type="range"
            :value="pdfStyle.lineHeight"
            min="1.3"
            max="2.4"
            step="0.05"
            @input="
              (e) =>
                setPdfOption(
                  'lineHeight',
                  Number((e.target as HTMLInputElement).value)
                )
            "
          />
          <span class="value">{{ pdfStyle.lineHeight.toFixed(2) }}</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.density") }}</label>
          <div class="density-group">
            <button
              type="button"
              class="seg"
              :class="{ active: pdfStyle.density === 'compact' }"
              @click="setPdfDensity('compact')"
            >
              {{ t("pdfStyle.compact") }}
            </button>
            <button
              type="button"
              class="seg"
              :class="{ active: pdfStyle.density === 'standard' }"
              @click="setPdfDensity('standard')"
            >
              {{ t("pdfStyle.standard") }}
            </button>
            <button
              type="button"
              class="seg"
              :class="{ active: pdfStyle.density === 'loose' }"
              @click="setPdfDensity('loose')"
            >
              {{ t("pdfStyle.loose") }}
            </button>
          </div>
        </div>

        <!-- 自定义颜色五件套：正文/标题/链接/代码块背景/页面背景 -->
        <div class="row">
          <label>{{ t("pdfStyle.textColor") }}</label>
          <input
            type="color"
            class="color-input"
            :value="pdfStyle.textColor"
            @input="
              (e) =>
                setPdfOption('textColor', (e.target as HTMLInputElement).value)
            "
          />
          <span class="value mono">{{ pdfStyle.textColor }}</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.headingColor") }}</label>
          <input
            type="color"
            class="color-input"
            :value="pdfStyle.headingColor"
            @input="
              (e) =>
                setPdfOption(
                  'headingColor',
                  (e.target as HTMLInputElement).value
                )
            "
          />
          <span class="value mono">{{ pdfStyle.headingColor }}</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.linkColor") }}</label>
          <input
            type="color"
            class="color-input"
            :value="pdfStyle.linkColor"
            @input="
              (e) =>
                setPdfOption('linkColor', (e.target as HTMLInputElement).value)
            "
          />
          <span class="value mono">{{ pdfStyle.linkColor }}</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.codeBg") }}</label>
          <input
            type="color"
            class="color-input"
            :value="pdfStyle.codeBg"
            @input="
              (e) =>
                setPdfOption('codeBg', (e.target as HTMLInputElement).value)
            "
          />
          <span class="value mono">{{ pdfStyle.codeBg }}</span>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.bgColor") }}</label>
          <input
            type="color"
            class="color-input"
            :value="pdfStyle.bgColor"
            @input="
              (e) =>
                setPdfOption('bgColor', (e.target as HTMLInputElement).value)
            "
          />
          <span class="value mono">{{ pdfStyle.bgColor }}</span>
        </div>

        <!-- 页面参数：纸张尺寸 + 横竖向 + 页边距 -->
        <div class="row">
          <label>{{ t("pdfStyle.pageSize") }}</label>
          <select
            class="sub-select"
            :value="pdfStyle.pageSize"
            @change="
              (e) =>
                setPdfOption('pageSize', (e.target as HTMLSelectElement).value as 'A4' | 'Letter')
            "
          >
            <option value="A4">{{ t("pdfStyle.a4") }}</option>
            <option value="Letter">{{ t("pdfStyle.letter") }}</option>
          </select>
          <select
            class="sub-select"
            :value="pdfStyle.orientation"
            @change="
              (e) =>
                setPdfOption(
                  'orientation',
                  (e.target as HTMLSelectElement).value as 'portrait' | 'landscape'
                )
            "
          >
            <option value="portrait">{{ t("pdfStyle.portrait") }}</option>
            <option value="landscape">{{ t("pdfStyle.landscape") }}</option>
          </select>
        </div>

        <div class="row">
          <label>{{ t("pdfStyle.pageMargin") }}</label>
          <input
            type="range"
            :value="pdfStyle.pageMargin"
            min="5"
            max="40"
            step="1"
            @input="
              (e) =>
                setPdfOption(
                  'pageMargin',
                  Number((e.target as HTMLInputElement).value)
                )
            "
          />
          <span class="value">{{ pdfStyle.pageMargin }}mm</span>
        </div>

        <div class="section-actions">
          <button class="btn" @click="resetPdfStyle">
            {{ t("pdfStyle.reset") }}
          </button>
        </div>
      </div>

      <div class="footer">
        <button class="btn primary" @click="emit('close')">
          {{ t("settings.done") }}
        </button>
      </div>
    </div>
    <ShortcutsDialog :visible="showShortcuts" @close="showShortcuts = false" />
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
  min-width: 460px;
  max-width: 640px;
  max-height: 90vh;
  overflow-y: auto;
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
.sub-select {
  grid-column: auto;
  min-width: 96px;
}
.density-group {
  grid-column: 2 / span 2;
  display: flex;
  gap: 6px;
}
.toggle-group {
  grid-column: 2 / span 2;
  display: flex;
  gap: 6px;
  max-width: 180px;
}
.seg {
  flex: 1;
  font-size: 13px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg);
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.seg:hover {
  background: var(--bg-btn-hover);
}
.seg.active {
  background: var(--link);
  color: #fff;
  border-color: var(--link);
}
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.tab {
  padding: 8px 14px;
  font-size: 13px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--fg-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.tab:hover {
  color: var(--fg);
}
.tab.active {
  color: var(--link);
  border-bottom-color: var(--link);
  font-weight: 600;
}
.reading-reset {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.reader-bg-block {
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-btn);
}
.reader-bg-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--fg);
  margin-bottom: 10px;
}
.reader-bg-group + .reader-bg-group {
  margin-top: 12px;
}
.reader-bg-label {
  font-size: 12px;
  color: var(--fg-muted);
  margin-bottom: 6px;
}
.reader-bg-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}
.reader-bg-controls input[type="color"] {
  width: 34px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-btn);
  cursor: pointer;
}
.hex-input {
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--fg);
  background: var(--bg-btn);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.btn-mini {
  font-size: 12px;
  padding: 4px 10px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg-muted);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}
.btn-mini:hover {
  background: var(--bg-btn-hover);
  color: var(--fg);
}
.reader-bg-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.preset-chip {
  font-size: 12px;
  padding: 3px 10px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg-muted);
  border-radius: 999px;
  cursor: pointer;
}
.preset-chip:hover {
  background: var(--bg-btn-hover);
  color: var(--fg);
}
.preset-chip.active {
  color: var(--link);
  border-color: var(--link);
  background: var(--bg-active);
}
.reader-bg-reset-all {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.preview-label {
  margin-top: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--fg-muted);
}
.preview-input {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  color: var(--fg);
  background: var(--bg-btn);
  border: 1px solid var(--border);
  border-radius: 6px;
  resize: vertical;
}
.compare-toggle {
  margin-left: 10px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 10px;
  border: 1px solid var(--border);
  background: var(--bg-btn);
  color: var(--fg-muted);
  border-radius: 999px;
  cursor: pointer;
}
.compare-toggle:hover {
  background: var(--bg-btn-hover);
}
.compare-toggle.active {
  background: var(--link);
  color: #fff;
  border-color: var(--link);
}
.preview-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 8px;
}
.preview-col-title {
  font-size: 11px;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.pdf-preview {
  width: 100%;
  height: 280px;
  margin-top: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
}
.color-input {
  grid-column: 2;
  width: 48px;
  height: 26px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.section {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 4px;
}
.section-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
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
