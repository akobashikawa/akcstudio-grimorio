<script setup lang="ts">
import { computed, ref } from "vue";
import type { PostSummary } from "../../lib/github-content";

type LanguageFilter = "all" | "en" | "es";

const props = defineProps<{
  posts: PostSummary[];
  loading: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  edit: [post: PostSummary];
  create: [];
  refresh: [];
}>();

const query = ref("");
const language = ref<LanguageFilter>("all");

const languageOptions: { value: LanguageFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
];

const counts = computed(() => ({
  all: props.posts.length,
  en: props.posts.filter((post) => post.lang === "en").length,
  es: props.posts.filter((post) => post.lang === "es").length,
}));

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return props.posts.filter((post) => {
    if (language.value !== "all" && post.lang !== language.value) return false;
    if (!needle) return true;
    return `${post.title} ${post.slug}`.toLowerCase().includes(needle);
  });
});

const emptyMessage = computed(() =>
  props.posts.length === 0
    ? "No posts found in the repository."
    : "No posts match the current filters.",
);
</script>

<template>
  <section class="admin-list" aria-labelledby="admin-list-title">
    <div class="admin-list-toolbar">
      <div>
        <h2 id="admin-list-title">Posts</h2>
        <p class="admin-list-count">
          {{ posts.length }} {{ posts.length === 1 ? "post" : "posts" }}
        </p>
      </div>
      <div class="admin-list-actions">
        <button
          class="btn secondary"
          type="button"
          :disabled="loading"
          @click="emit('refresh')"
        >
          Refresh
        </button>
        <button class="btn" type="button" @click="emit('create')">
          New post
        </button>
      </div>
    </div>

    <div class="admin-list-controls">
      <div
        class="admin-filters"
        role="group"
        aria-label="Filter posts by language"
      >
        <button
          v-for="option in languageOptions"
          :key="option.value"
          class="admin-filter"
          :class="{ active: language === option.value }"
          type="button"
          :aria-pressed="language === option.value"
          @click="language = option.value"
        >
          {{ option.label }}
          <span aria-hidden="true">{{ counts[option.value] }}</span>
        </button>
      </div>

      <label class="admin-search">
        <span>Search posts</span>
        <input
          v-model="query"
          type="search"
          placeholder="Title or slug"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    </div>

    <p v-if="loading" class="admin-hint">Loading posts...</p>
    <p v-else-if="error" class="admin-error" role="alert">{{ error }}</p>
    <p v-else-if="filtered.length === 0" class="admin-empty">
      {{ emptyMessage }}
    </p>
    <ul v-else class="admin-post-list">
      <li v-for="post in filtered" :key="`${post.lang}/${post.slug}`">
        <button
          class="admin-post-row"
          type="button"
          @click="emit('edit', post)"
        >
          <span class="admin-post-main">
            <strong>{{ post.title }}</strong>
            <span class="admin-post-slug">{{ post.lang }}/{{ post.slug }}</span>
          </span>
          <span class="admin-post-meta">
            <span
              class="admin-badge"
              :class="post.draft ? 'is-draft' : 'is-live'"
            >
              {{ post.draft ? "Draft" : "Published" }}
            </span>
            <span>{{ post.date }}</span>
            <span class="admin-post-category">{{ post.category }}</span>
          </span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.admin-list {
  display: grid;
  gap: 16px;
}
.admin-list-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.admin-list-toolbar h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 600;
}
.admin-list-count {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
}
.admin-list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.admin-list-actions .btn {
  font-size: 13px;
  padding: 6px 12px;
}
.admin-list-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}
.admin-filters {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}
.admin-filter {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.admin-filter + .admin-filter {
  border-left: 1px solid var(--line);
}
.admin-filter:hover {
  color: var(--text);
}
.admin-filter.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.admin-filter span {
  font-size: 11px;
  opacity: 0.75;
}
.admin-search {
  display: grid;
  gap: 5px;
  width: min(280px, 100%);
  color: var(--muted);
  font-size: 12px;
}
.admin-search input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--card);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.admin-search input:focus {
  border-color: var(--accent);
  outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  outline-offset: 1px;
}
.admin-post-list {
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  list-style: none;
}
.admin-post-list li + li {
  border-top: 1px solid var(--line);
}
.admin-post-row {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.admin-post-row:hover {
  background: var(--surface);
}
.admin-post-main {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.admin-post-main strong {
  overflow: hidden;
  font-size: 15px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-post-slug {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
}
.admin-post-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
}
.admin-badge {
  padding: 2px 8px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
}
.admin-badge.is-draft {
  border-color: transparent;
  background: var(--accent-soft);
  color: var(--accent);
}
.admin-post-category {
  text-transform: capitalize;
}
.admin-hint,
.admin-empty {
  margin: 0;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
}
.admin-error {
  margin: 0;
  padding: 14px 16px;
  border: 1px solid #e7b4ae;
  border-radius: var(--radius);
  background: #fdf2f1;
  color: #b42318;
  font-size: 14px;
}
:global(.dark) .admin-error {
  border-color: #623b37;
  background: #2c211f;
  color: #ff9b8f;
}
@media (max-width: 640px) {
  .admin-post-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
