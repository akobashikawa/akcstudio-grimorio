<script setup lang="ts">
import { reactive, ref } from "vue";
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";
import {
  createPostPair,
  GithubApiError,
  isValidSlug,
  type CreatePostResult,
} from "../../lib/github-content";
import { normalizeDate, parseTags, today } from "../../lib/frontmatter";

const props = defineProps<{
  repo: AdminRepoConfig;
  token: string;
  categories: Category[];
}>();

const emit = defineEmits<{
  created: [result: CreatePostResult];
  back: [];
  unauthorized: [];
}>();

const defaultCategory = props.categories.includes("notes" as Category)
  ? "notes"
  : (props.categories[0] ?? "notes");
const slugPlaceholder = "<slug>";

const form = reactive({
  slug: "",
  title: "",
  date: today(),
  category: defaultCategory as string,
  tags: "",
});

const saving = ref(false);
const error = ref("");
const fieldErrors = reactive<Record<string, string>>({
  slug: "",
  title: "",
  date: "",
  category: "",
  tags: "",
});

function clearErrors() {
  for (const key of Object.keys(fieldErrors)) fieldErrors[key] = "";
}

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
      return "The repository changed while creating the post. Try again.";
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

function validate(): boolean {
  clearErrors();
  const slug = form.slug.trim();
  if (!slug) {
    fieldErrors.slug = "Slug is required.";
  } else if (!isValidSlug(slug)) {
    fieldErrors.slug =
      "Use lowercase letters, numbers and hyphens, for example: my-first-post.";
  } else if (props.categories.includes(slug as Category)) {
    fieldErrors.slug = "Slug must differ from a category name.";
  }

  if (!form.title.trim()) fieldErrors.title = "Title is required.";
  if (!normalizeDate(form.date)) {
    fieldErrors.date = "Use a valid date (YYYY-MM-DD).";
  }
  if (!props.categories.includes(form.category as Category)) {
    fieldErrors.category = "Choose a valid category.";
  }
  if (parseTags(form.tags) === undefined) {
    fieldErrors.tags = "Tags must be comma-separated text values.";
  }

  return !Object.values(fieldErrors).some(Boolean);
}

async function submit() {
  error.value = "";
  if (!validate()) {
    error.value = "Fix the highlighted fields before creating the post.";
    return;
  }

  saving.value = true;
  try {
    const result = await createPostPair(props.repo, props.token, {
      slug: form.slug.trim(),
      title: form.title.trim(),
      date: normalizeDate(form.date) as string,
      category: form.category as Category,
      tags: parseTags(form.tags) ?? [],
    });
    emit("created", result);
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      emit("unauthorized");
      return;
    }
    error.value = errorMessage(reason);
    if (reason instanceof GithubApiError && reason.status === 409) {
      fieldErrors.slug = error.value;
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
      This creates both the English and Spanish files in one commit. Both start
      as drafts with a pending description and an empty body.
    </p>

    <form class="admin-form" @submit.prevent="submit">
      <div class="admin-field-grid">
        <label class="admin-field">
          <span>Slug</span>
          <input
            v-model="form.slug"
            type="text"
            placeholder="my-first-post"
            autocomplete="off"
            spellcheck="false"
            :class="{ invalid: fieldErrors.slug }"
          />
          <small v-if="fieldErrors.slug" class="admin-field-error">
            {{ fieldErrors.slug }}
          </small>
        </label>

        <label class="admin-field">
          <span>Title</span>
          <input
            v-model="form.title"
            type="text"
            :class="{ invalid: fieldErrors.title }"
          />
          <small v-if="fieldErrors.title" class="admin-field-error">
            {{ fieldErrors.title }}
          </small>
        </label>

        <label class="admin-field">
          <span>Date</span>
          <input
            v-model="form.date"
            type="date"
            :class="{ invalid: fieldErrors.date }"
          />
          <small v-if="fieldErrors.date" class="admin-field-error">
            {{ fieldErrors.date }}
          </small>
        </label>

        <label class="admin-field">
          <span>Category</span>
          <select
            v-model="form.category"
            :class="{ invalid: fieldErrors.category }"
          >
            <option
              v-for="category in categories"
              :key="category"
              :value="category"
            >
              {{ category }}
            </option>
          </select>
          <small v-if="fieldErrors.category" class="admin-field-error">
            {{ fieldErrors.category }}
          </small>
        </label>

        <label class="admin-field">
          <span>Tags</span>
          <input
            v-model="form.tags"
            type="text"
            placeholder="Astro, Markdown"
            :class="{ invalid: fieldErrors.tags }"
          />
          <small class="admin-field-help">Comma-separated.</small>
          <small v-if="fieldErrors.tags" class="admin-field-error">
            {{ fieldErrors.tags }}
          </small>
        </label>
      </div>

      <div class="admin-paths">
        <p>Files to create:</p>
        <code>src/content/posts/en/{{ form.slug || slugPlaceholder }}.md</code>
        <code>src/content/posts/es/{{ form.slug || slugPlaceholder }}.md</code>
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
.admin-creator-lede {
  max-width: 72ch;
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}
.admin-form {
  display: grid;
  gap: 16px;
}
.admin-field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.admin-field input:focus,
.admin-field select:focus {
  border-color: var(--accent);
  outline: 2px solid color-mix(in srgb, var(--accent) 28%, transparent);
  outline-offset: 1px;
}
.admin-field .invalid {
  border-color: #b42318;
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
}
</style>
