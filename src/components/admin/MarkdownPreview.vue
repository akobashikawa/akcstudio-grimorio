<script setup lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import { computed } from "vue";

const props = defineProps<{
  markdown: string;
}>();

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
</script>

<template>
  <div class="admin-preview">
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
