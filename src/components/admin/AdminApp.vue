<script setup lang="ts">
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";

defineProps<{
  repo: AdminRepoConfig;
  categories: Category[];
}>();
</script>

<template>
  <div class="admin-app">
    <header class="admin-intro">
      <p class="admin-eyebrow">Content editor</p>
      <h1>Edit posts</h1>
      <p class="admin-lede">
        Connect a GitHub fine-grained token with
        <strong>Contents: Read and write</strong> access to
        <code>{{ repo.owner }}/{{ repo.repo }}</code
        >. The token stays in this browser.
      </p>
    </header>

    <form class="admin-login" @submit.prevent>
      <label for="admin-token">GitHub token</label>
      <input
        id="admin-token"
        class="admin-input"
        type="password"
        placeholder="github_pat_..."
        autocomplete="off"
        spellcheck="false"
      />
      <button class="btn" type="submit">Connect with GitHub</button>
      <p class="admin-hint">
        A fine-grained token with Contents: Read and write is required.
      </p>
    </form>
  </div>
</template>

<style scoped>
.admin-app {
  display: grid;
  gap: 24px;
}
.admin-eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.admin-intro h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
}
.admin-lede {
  max-width: 66ch;
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.65;
}
.admin-lede code {
  color: var(--text);
}
.admin-login {
  display: grid;
  gap: 10px;
  max-width: 560px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin-login label {
  font-size: 14px;
  font-weight: 500;
}
.admin-input {
  width: 100%;
  padding: 9px 11px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--card);
  color: var(--text);
  font: inherit;
}
.admin-input:focus {
  border-color: var(--accent);
  outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  outline-offset: 1px;
}
.admin-login .btn {
  justify-self: start;
}
.admin-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}
</style>
