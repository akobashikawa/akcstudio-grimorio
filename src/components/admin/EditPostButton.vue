<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ADMIN_STORAGE_KEYS } from "../../lib/admin-config";

const props = defineProps<{
  lang: string;
  slug: string;
}>();

const hasToken = ref(false);
const href = `/admin/?lang=${encodeURIComponent(props.lang)}&slug=${encodeURIComponent(
  props.slug,
)}`;

onMounted(() => {
  try {
    hasToken.value = Boolean(localStorage.getItem(ADMIN_STORAGE_KEYS.token));
  } catch {
    hasToken.value = false;
  }
});
</script>

<template>
  <a v-if="hasToken" class="btn secondary edit-post-link" :href="href">
    <span class="icon-[lucide--pencil]" aria-hidden="true"></span>
    Edit
  </a>
</template>

<style scoped>
.edit-post-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
