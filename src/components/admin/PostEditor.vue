<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";
import {
  GithubApiError,
  getPost,
  savePost,
  type PostSummary,
} from "../../lib/github-content";
import {
  parseTags,
  validateFrontmatter,
  type FrontmatterErrors,
  type PostFrontmatter,
} from "../../lib/frontmatter";
import MarkdownPreview from "./MarkdownPreview.vue";

const props = defineProps<{
  repo: AdminRepoConfig;
  token: string;
  post: PostSummary;
  categories: Category[];
}>();

const emit = defineEmits<{
  saved: [post: PostSummary];
  back: [];
  unauthorized: [];
}>();

const form = reactive({
  title: "",
  description: "",
  date: "",
  updated: "",
  category: "notes" as string,
  tags: "",
  featured: false,
  draft: true,
  body: "",
});

const sha = ref("");
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const saveError = ref("");
const conflict = ref(false);
const savedMessage = ref("");
const errors = ref<FrontmatterErrors>({});
const bodyMode = ref<"write" | "preview">("write");

function errorMessage(reason: unknown): string {
  if (reason instanceof GithubApiError) {
    if (reason.status === 404) {
      return "This post no longer exists on GitHub.";
    }
    if (reason.status === 403) {
      return `GitHub denied access: ${reason.message}. The token needs Contents: Read and write and access to ${props.repo.owner}/${props.repo.repo}. If it already has that, log out and reconnect.`;
    }
    return reason.message;
  }
  if (reason instanceof TypeError) {
    return "Could not reach GitHub. Check your connection and try again.";
  }
  return reason instanceof Error ? reason.message : "Something went wrong.";
}

function fill(frontmatter: PostFrontmatter, body: string, fileSha: string) {
  form.title = frontmatter.title;
  form.description = frontmatter.description;
  form.date = frontmatter.date;
  form.updated = frontmatter.updated ?? "";
  form.category = frontmatter.category;
  form.tags = frontmatter.tags.join(", ");
  form.featured = frontmatter.featured;
  form.draft = frontmatter.draft;
  form.body = body;
  sha.value = fileSha;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  saveError.value = "";
  conflict.value = false;
  savedMessage.value = "";
  errors.value = {};
  try {
    const file = await getPost(
      props.repo,
      props.token,
      props.post.lang,
      props.post.slug,
    );
    fill(file.frontmatter, file.body, file.sha);
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      emit("unauthorized");
      return;
    }
    loadError.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function save() {
  saveError.value = "";
  savedMessage.value = "";
  conflict.value = false;

  const candidate: PostFrontmatter = {
    title: form.title,
    description: form.description,
    date: form.date,
    ...(form.updated ? { updated: form.updated } : {}),
    lang: props.post.lang,
    category: form.category as Category,
    tags: parseTags(form.tags) ?? [],
    featured: form.featured,
    draft: form.draft,
  };
  const validation = validateFrontmatter(candidate, props.post.lang);
  if (!validation.ok) {
    errors.value = validation.errors;
    saveError.value = "Fix the highlighted fields before saving.";
    return;
  }

  errors.value = {};
  saving.value = true;
  try {
    const result = await savePost(props.repo, props.token, {
      lang: props.post.lang,
      slug: props.post.slug,
      sha: sha.value,
      frontmatter: validation.value,
      body: form.body,
    });
    sha.value = result.sha;
    form.updated = result.frontmatter.updated ?? "";
    savedMessage.value = `Saved. Commit ${result.commitSha.slice(0, 7)}.`;
    emit("saved", {
      lang: props.post.lang,
      slug: props.post.slug,
      title: result.frontmatter.title,
      date: result.frontmatter.date,
      category: result.frontmatter.category,
      draft: result.frontmatter.draft,
      updated: result.frontmatter.updated,
      sha: result.sha,
    });
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      emit("unauthorized");
      return;
    }
    if (reason instanceof GithubApiError && reason.status === 409) {
      conflict.value = true;
      saveError.value =
        "This post changed on GitHub after you opened it. Reload the latest version before saving.";
      return;
    }
    if (reason instanceof GithubApiError && reason.status === 404) {
      saveError.value =
        "This post no longer exists on GitHub. Go back to the list.";
      return;
    }
    saveError.value = errorMessage(reason);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="admin-editor" aria-labelledby="admin-editor-title">
    <div class="admin-editor-head">
      <div>
        <p class="admin-eyebrow">{{ post.lang }}/{{ post.slug }}</p>
        <h2 id="admin-editor-title">Edit post</h2>
      </div>
      <button class="btn secondary" type="button" @click="emit('back')">
        ← Back to posts
      </button>
    </div>

    <p v-if="loading" class="admin-hint">Loading post...</p>
    <div v-else-if="loadError" class="admin-editor-error">
      <p class="admin-error" role="alert">{{ loadError }}</p>
      <button class="btn secondary" type="button" @click="load">
        Try again
      </button>
    </div>

    <form v-else class="admin-form" @submit.prevent="save">
      <label class="admin-field">
        <span>Title</span>
        <input
          v-model="form.title"
          type="text"
          :class="{ invalid: errors.title }"
        />
        <small v-if="errors.title" class="admin-field-error">
          {{ errors.title }}
        </small>
      </label>

      <label class="admin-field">
        <span>Description</span>
        <textarea
          v-model="form.description"
          rows="2"
          :class="{ invalid: errors.description }"
        ></textarea>
        <small v-if="errors.description" class="admin-field-error">
          {{ errors.description }}
        </small>
      </label>

      <div class="admin-field-grid">
        <label class="admin-field">
          <span>Date</span>
          <input
            v-model="form.date"
            type="date"
            :class="{ invalid: errors.date }"
          />
          <small v-if="errors.date" class="admin-field-error">
            {{ errors.date }}
          </small>
        </label>
        <label class="admin-field">
          <span>Category</span>
          <select v-model="form.category" :class="{ invalid: errors.category }">
            <option
              v-for="category in categories"
              :key="category"
              :value="category"
            >
              {{ category }}
            </option>
          </select>
          <small v-if="errors.category" class="admin-field-error">
            {{ errors.category }}
          </small>
        </label>
        <label class="admin-field">
          <span>Updated (automatic)</span>
          <input :value="form.updated || 'Set on save'" type="text" readonly />
        </label>
      </div>

      <label class="admin-field">
        <span>Tags</span>
        <input
          v-model="form.tags"
          type="text"
          placeholder="Astro, Markdown"
          :class="{ invalid: errors.tags }"
        />
        <small class="admin-field-help">Comma-separated.</small>
        <small v-if="errors.tags" class="admin-field-error">
          {{ errors.tags }}
        </small>
      </label>

      <div class="admin-checks">
        <label>
          <input v-model="form.featured" type="checkbox" />
          Featured
        </label>
        <label>
          <input v-model="form.draft" type="checkbox" />
          Draft (hidden from the site)
        </label>
      </div>

      <div class="admin-body-field">
        <div class="admin-body-head">
          <label for="admin-body">Body</label>
          <div class="admin-body-tabs" role="group" aria-label="Body view">
            <button
              type="button"
              :class="{ active: bodyMode === 'write' }"
              :aria-pressed="bodyMode === 'write'"
              @click="bodyMode = 'write'"
            >
              Write
            </button>
            <button
              type="button"
              :class="{ active: bodyMode === 'preview' }"
              :aria-pressed="bodyMode === 'preview'"
              @click="bodyMode = 'preview'"
            >
              Preview
            </button>
          </div>
        </div>
        <textarea
          v-if="bodyMode === 'write'"
          id="admin-body"
          v-model="form.body"
          class="admin-body"
          rows="22"
          spellcheck="true"
        ></textarea>
        <MarkdownPreview v-else :markdown="form.body" />
        <small class="admin-field-help">
          Markdown. Switch to Preview to check the rendered result.
        </small>
      </div>

      <p v-if="saveError" class="admin-error" role="alert">{{ saveError }}</p>
      <p v-if="savedMessage" class="admin-success" role="status">
        {{ savedMessage }}
      </p>

      <div class="admin-form-actions">
        <button class="btn" type="submit" :disabled="saving">
          {{ saving ? "Saving..." : "Save changes" }}
        </button>
        <button
          v-if="conflict"
          class="btn secondary"
          type="button"
          @click="load"
        >
          Reload latest version
        </button>
        <button class="btn secondary" type="button" @click="emit('back')">
          Back to posts
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.admin-editor {
  display: grid;
  gap: 18px;
}
.admin-editor-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.admin-eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: uppercase;
}
.admin-editor-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
.admin-editor-head .btn {
  font-size: 13px;
  padding: 5px 11px;
}
.admin-form {
  display: grid;
  gap: 16px;
}
.admin-field-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.admin-field {
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 12px;
}
.admin-field > span {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}
.admin-field input,
.admin-field textarea,
.admin-field select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--card);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.admin-field textarea {
  resize: vertical;
}
.admin-field input:focus,
.admin-field textarea:focus,
.admin-field select:focus {
  border-color: var(--accent);
  outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  outline-offset: 1px;
}
.admin-field input[readonly] {
  background: var(--surface);
  color: var(--muted);
}
.admin-field .invalid {
  border-color: #b42318;
}
.admin-body-field {
  display: grid;
  gap: 6px;
}
.admin-body-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.admin-body-head > label {
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
}
.admin-body-tabs {
  display: inline-flex;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
}
.admin-body-tabs button {
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.admin-body-tabs button + button {
  border-left: 1px solid var(--line);
}
.admin-body-tabs button:hover {
  color: var(--text);
}
.admin-body-tabs button.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.admin-body {
  min-height: 360px;
  font-family: var(--font-mono) !important;
  font-size: 13px !important;
  line-height: 1.6;
  tab-size: 2;
}
.admin-field-help {
  color: var(--muted);
  font-size: 12px;
}
.admin-field-error {
  color: #b42318;
  font-size: 12px;
}
:global(.dark) .admin-field-error {
  color: #ff9b8f;
}
.admin-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  color: var(--text);
  font-size: 14px;
}
.admin-checks label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.admin-checks input {
  width: 16px;
  height: 16px;
}
.admin-hint {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.admin-editor-error {
  display: grid;
  gap: 10px;
  justify-items: start;
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
.admin-success {
  margin: 0;
  padding: 12px 14px;
  border: 1px solid #b7dcc4;
  border-radius: var(--radius);
  background: #eef8f1;
  color: #22633a;
  font-size: 14px;
}
:global(.dark) .admin-error {
  border-color: #623b37;
  background: #2c211f;
  color: #ff9b8f;
}
:global(.dark) .admin-success {
  border-color: #315640;
  background: #1d2c23;
  color: #91d3a7;
}
.admin-form-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 4px;
}
.admin-form-actions .btn {
  font-size: 14px;
}
@media (max-width: 760px) {
  .admin-field-grid {
    grid-template-columns: 1fr;
  }
}
</style>
