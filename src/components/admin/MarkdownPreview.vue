<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useTranslations } from "../../i18n";
import {
  createMermaidRenderer,
  type MermaidRenderer,
} from "../../scripts/mermaid";

const props = defineProps<{
  markdown: string;
}>();

const t = useTranslations("en");

const html = computed(() => {
  if (typeof DOMPurify.sanitize !== "function") return "";
  const rendered = marked.parse(props.markdown, {
    async: false,
    gfm: true,
    breaks: false,
  }) as string;
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
  });
});

// The admin is English-only; it reuses the article labels in that language.
const container = ref<HTMLElement | null>(null);
let renderer: MermaidRenderer | null = null;

const renderDiagrams = async (): Promise<void> => {
  await nextTick();
  if (!container.value || !container.value.isConnected) return;
  renderer ??= createMermaidRenderer({
    root: container.value,
    labels: {
      viewSource: t("article.diagramSource"),
      hideSource: t("article.diagramSourceHide"),
      error: t("article.diagramError"),
      diagram: t("article.diagramLabel"),
    },
  });
  await renderer.render();
};

onMounted(renderDiagrams);
watch(
  () => props.markdown,
  () => {
    void renderDiagrams();
  },
);
onBeforeUnmount(() => renderer?.destroy());
</script>

<template>
  <div ref="container" class="admin-preview">
    <p v-if="!markdown.trim()" class="admin-preview-empty">
      Nothing to preview yet.
    </p>
    <div v-else class="prose" v-html="html"></div>
  </div>
</template>

<style scoped>
.admin-preview {
  min-height: 360px;
  padding: 14px 16px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--card);
  overflow-wrap: anywhere;
}
.admin-preview-empty {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
</style>
