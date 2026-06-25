<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from "vue";
import {
  renderMarkdown,
  renderMath,
  renderMermaid,
} from "../composables/useMarkdown";
import { rewriteImagesAndLinks } from "../composables/useLinkRewriter";

const props = defineProps<{
  source: string;
  currentFile: string;
  rootDir: string;
}>();
const emit = defineEmits<{
  (e: "rendered", el: HTMLElement): void;
  (e: "internal-link", path: string, hash: string): void;
}>();

const html = ref<string>("");
const root = ref<HTMLElement | null>(null);

async function update() {
  html.value = renderMarkdown(props.source);
  await nextTick();
  if (root.value) {
    rewriteImagesAndLinks(
      root.value,
      { currentFile: props.currentFile, rootDir: props.rootDir },
      (path, hash) => emit("internal-link", path, hash)
    );
    await renderMath(root.value);
    await renderMermaid(root.value);
    emit("rendered", root.value);
  }
}

onMounted(update);
watch(() => props.source, update);
watch(() => props.currentFile, update);

defineExpose({ root });
</script>

<template>
  <article ref="root" class="markdown-body" v-html="html"></article>
</template>

<style scoped>
.markdown-body {
  padding: 32px 48px 80px;
  max-width: var(--reader-max-width, 900px);
  margin: 0 auto;
  line-height: var(--reader-line-height, 1.75);
  font-size: var(--reader-font-size, 16px);
  font-family: var(--reader-font-family, inherit);
  color: var(--fg);
}

:root[data-theme="dark"] .markdown-body {
  padding: 38px 54px 88px;
  max-width: var(--reader-max-width, 820px);
  margin: 30px auto 70px;
  line-height: var(--reader-line-height, 1.72);
  background: var(--mdr-paper);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.32);
}
</style>
