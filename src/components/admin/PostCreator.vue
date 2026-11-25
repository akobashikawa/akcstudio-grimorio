<script setup lang="ts">
import { reactive, ref } from "vue";
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";
import {
  createPost,
  GithubApiError,
  isValidSlug,
  type CreatePostPrefill,
  type CreatePostResult,
} from "../../lib/github-content";
import {
  parseTags,
  today,
  validateFrontmatter,
  type FrontmatterErrors,
  type PostFrontmatter,
  type PostLanguage,
} from "../../lib/frontmatter";
import { slugify } from "../../lib/slug";
import MarkdownPreview from "./MarkdownPreview.vue";

const props = defineProps<{
  repo: AdminRepoConfig;
  token: string;
  categories: Category[];
  initialLang?: PostLanguage;
  prefill?: CreatePostPrefill;
}>();

const emit = defineEmits<{
  created: [result: CreatePostResult];
  back: [];
  unauthorized: [];
}>();

const defaultCategory = props.categories.includes("notes" as Category)
  ? "notes"
  : (props.categories[0] ?? "notes");
const initialCategory = props.prefill?.category;
const category =
  initialCategory && props.categories.includes(initialCategory)
    ? initialCategory
    : defaultCategory;
const slugPlaceholder = "<slug>";

const form = reactive({
  lang: (props.prefill?.lang ?? props.initialLang ?? "en") as string,
  slug: props.prefill?.slug ?? "",
  title: props.prefill?.title ?? "",
  description: props.prefill?.description ?? "",
  date: props.prefill?.date ?? today(),
  category: category as string,
  tags: props.prefill?.tags.join(", ") ?? "",
  featured: props.prefill?.featured ?? false,
  draft: true,
  body: props.prefill?.body ?? "",
});

const saving = ref(false);
const error = ref("");
const slugError = ref("");
const errors = ref<FrontmatterErrors>({});
const bodyMode = ref<"write" | "preview">("write");

function errorMessage(reason: unknown): string {
  if (reason instanceof GithubApiError) {
    if (reason.status === 401) {
      return "Your GitHub token expired. Connect again.";
    }
    if (reason.status === 403) {
      return `GitHub denied access: ${reason.message}. The token needs Contents: Read and write and access to ${props.repo.owner}/${props.repo.repo}. If it already has that, log out and reconnect.`;
    }
    if (reason.status === 409) {
      return reason.message || "A post with this slug already exists.";
    }
    if (reason.status === 422) {
      return "GitHub rejected the file. Check the fields and try again.";
    }
    return reason.message;
  }
  if (reason instanceof TypeError) {
    return "Could not reach GitHub. Check your connection and try again.";
  }
  return reason instanceof Error
    ? reason.message
    : "Could not create the post.";
}

function generateSlug() {
  if (!form.title.trim()) return;
  form.slug = slugify(form.title);
  slugError.value = "";
}

function validate(): PostFrontmatter | undefined {
  error.value = "";
  errors.value = {};
  slugError.value = "";

  const slug = form.slug.trim();
  if (!slug) {
    slugError.value = "Slug is required.";
  } else if (!isValidSlug(slug)) {
    slugError.value =
      "Use lowercase letters, numbers and hyphens, for example: my-first-post.";
  } else if (props.categories.includes(slug as Category)) {
    slugError.value = "Slug must differ from a category name.";
  }

  const tags = parseTags(form.tags);
  const lang = form.lang as PostLanguage;
  const validation = validateFrontmatter(
    {
      title: form.title,
      description: form.description,
      date: form.date,
      lang,
      category: form.category as Category,
      tags: tags ?? [],
      featured: form.featured,
      draft: form.draft,
    },
    lang,
  );

  if (!validation.ok) errors.value = validation.errors;
  if (tags === undefined) {
    errors.value = {
      ...errors.value,
      tags: "Tags must be comma-separated text values.",
    };
  }

  if (slugError.value || !validation.ok || tags === undefined) {
    error.value = "Fix the highlighted fields before creating the post.";
    return undefined;
  }
  return validation.value;
}

async function submit() {
  const frontmatter = validate();
  if (!frontmatter) return;

  saving.value = true;
  try {
    const result = await createPost(props.repo, props.token, {
      lang: frontmatter.lang,
      slug: form.slug.trim(),
      frontmatter,
      body: form.body,
    });
    emit("created", result);
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      emit("unauthorized");
      return;
    }
    error.value = errorMessage(reason);
    if (reason instanceof GithubApiError && reason.status === 409) {
      slugError.value = error.value;
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="admin-creator" aria-labelledby="admin-creator-title">
    <div class="admin-creator-head">
      <div>
        <p class="admin-eyebrow">New content</p>
        <h2 id="admin-creator-title">New post</h2>
      </div>
      <button class="btn secondary" type="button" @click="emit('back')">
        ← Back to posts
      </button>
    </div>

    <p class="admin-creator-lede">
      Creates one Markdown file in the selected language. No file is created for
      the other language, so this post can stay untranslated.
    </p>
    <p v-if="prefill" class="admin-creator-note">
      Prefilled from the existing version. Review and translate the content
      before publishing.
    </p>

    <form class="admin-form" @submit.prevent="submit">
      <div class="admin-field-grid">
        <label class="admin-field">
          <span>Language</span>
          <select v-model="form.lang">
            <option value="en">English</option>
            <option value="es">Spanish</option>
          </select>
        </label>

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
            <option v-for="item in categories" :key="item" :value="item">
              {{ item }}
            </option>
          </select>
          <small v-if="errors.category" class="admin-field-error">
            {{ errors.category }}
          </small>
        </label>
      </div>

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

      <div class="admin-field">
        <label class="admin-field-label" for="admin-creator-slug">Slug</label>
        <div class="admin-slug-row">
          <input
            id="admin-creator-slug"
            v-model="form.slug"
            type="text"
            placeholder="my-first-post"
            autocomplete="off"
            spellcheck="false"
            :class="{ invalid: slugError }"
          />
          <button
            class="btn secondary"
            type="button"
            :disabled="!form.title.trim()"
            @click="generateSlug"
          >
            Generate from title
          </button>
        </div>
        <small class="admin-field-help">
          Lowercase letters, numbers and hyphens.
        </small>
        <small v-if="slugError" class="admin-field-error">
          {{ slugError }}
        </small>
      </div>

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
          <label for="admin-creator-body">Body</label>
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
          id="admin-creator-body"
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

      <div class="admin-paths">
        <p>File to create:</p>
        <code>
          src/content/posts/{{ form.lang }}/{{
            form.slug || slugPlaceholder
          }}.md
        </code>
      </div>

      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>

      <div class="admin-form-actions">
        <button class="btn" type="submit" :disabled="saving">
          {{ saving ? "Creating..." : "Create post" }}
        </button>
        <button class="btn secondary" type="button" @click="emit('back')">
          Cancel
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.admin-creator {
  display: grid;
  gap: 18px;
}
.admin-creator-head {
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
.admin-creator-head h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
.admin-creator-head .btn {
  font-size: 13px;
  padding: 5px 11px;
}
.admin-creator-lede,
.admin-creator-note {
  max-width: 72ch;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}
.admin-creator-note {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
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
.admin-field > span,
.admin-field-label {
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
.admin-field .invalid {
  border-color: #b42318;
}
.admin-slug-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.admin-slug-row input {
  flex: 1;
  min-width: 0;
}
.admin-slug-row .btn {
  flex: 0 0 auto;
  font-size: 13px;
  padding: 5px 11px;
  white-space: nowrap;
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
.admin-paths {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin-paths p {
  margin: 0 0 2px;
  color: var(--muted);
  font-size: 12px;
}
.admin-paths code {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
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
  .admin-slug-row {
    flex-direction: column;
  }
}
</style>
