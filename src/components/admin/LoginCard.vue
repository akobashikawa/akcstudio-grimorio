<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AdminRepoConfig } from "../../lib/admin-config";

const props = defineProps<{
  repo: AdminRepoConfig;
  initialError?: string;
}>();

// Deep links such as /admin/?lang=es&slug=x survive the GitHub round trip
// through the `next` parameter, which the callback whitelists.
const next = ref("/admin/");

onMounted(() => {
  if (typeof window === "undefined") return;
  next.value = window.location.pathname + window.location.search;
});

const loginUrl = computed(() => {
  const params = new URLSearchParams({ next: next.value });
  return `/api/auth/login/?${params.toString()}`;
});
</script>

<template>
  <section class="login-card">
    <h2>Connect with GitHub</h2>
    <p class="login-copy">
      Sign in to edit posts in
      <strong>{{ repo.owner }}/{{ repo.repo }}</strong
      >. The session lives on the server; no token is stored in this browser.
    </p>
    <a class="btn" :href="loginUrl">
      Connect with GitHub<span class="icon-[lucide--arrow-up-right]"></span>
    </a>
    <p v-if="initialError" class="admin-error" role="alert">
      {{ initialError }}
    </p>
  </section>
</template>

<style scoped>
.login-card {
  display: grid;
  gap: 14px;
  justify-items: start;
  padding: 22px 24px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.login-card h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.login-copy {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
}
.login-card .btn {
  font-size: 14px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.login-card .admin-error {
  width: 100%;
}
</style>
