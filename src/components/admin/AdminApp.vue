<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";
import {
  clearLegacySession,
  fetchSession,
  forgetSignedIn,
  rememberSignedIn,
  signOut,
} from "../../lib/admin-auth-client";
import type { AdminSessionPayload } from "../../lib/admin-auth";
import {
  deletePost,
  getPost,
  GithubApiError,
  isValidSlug,
  listPosts,
  type CreatePostPrefill,
  type CreatePostResult,
  type PostSummary,
} from "../../lib/github-content";
import { today, type PostLanguage } from "../../lib/frontmatter";
import LoginCard from "./LoginCard.vue";
import PostCreator from "./PostCreator.vue";
import PostEditor from "./PostEditor.vue";
import PostList from "./PostList.vue";

type AdminView = "list" | "edit" | "new";

const props = defineProps<{
  repo: AdminRepoConfig;
  categories: Category[];
}>();

// The access token lives only in memory; localStorage holds the non-secret
// `grimorio.admin` flag, and the real session sits in the Worker's KV.
const session = ref<AdminSessionPayload | null>(null);
const loading = ref(true);
const loginError = ref("");
const posts = ref<PostSummary[]>([]);
const loadingPosts = ref(false);
const postsError = ref("");
const view = ref<AdminView>("list");
const selectedPost = ref<PostSummary | null>(null);
const createLang = ref<PostLanguage>("en");
const createPrefill = ref<CreatePostPrefill | null>(null);
const createNotice = ref("");
const listNotice = ref("");
const deleting = ref(false);
const fallbackCategory: Category = props.categories.includes(
  "notes" as Category,
)
  ? "notes"
  : (props.categories[0] ?? "notes");

onMounted(async () => {
  clearLegacySession();
  try {
    const payload = await fetchSession();
    if (!payload) {
      return; // Unauthenticated: the login card shows below.
    }
    if (!payload.canWrite) {
      loginError.value = `GitHub did not grant write access to ${props.repo.owner}/${props.repo.repo}. Check that the app is installed on the repository and that you have write access.`;
      return;
    }
    session.value = payload;
    rememberSignedIn();
    await loadPosts();
    await openFromQuery();
  } catch (reason) {
    loginError.value =
      reason instanceof Error
        ? reason.message
        : "Could not load the admin session.";
  } finally {
    loading.value = false;
  }
});

async function loadPosts() {
  const current = session.value;
  if (!current) return;

  loadingPosts.value = true;
  postsError.value = "";
  try {
    const [en, es] = await Promise.all([
      listPosts(props.repo, current.token, "en"),
      listPosts(props.repo, current.token, "es"),
    ]);
    posts.value = [...en, ...es].sort(
      (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
    );
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      onUnauthorized();
    } else if (reason instanceof GithubApiError && reason.status === 403) {
      postsError.value = `GitHub denied access: ${reason.message}. Check that the GitHub App is installed on ${props.repo.owner}/${props.repo.repo} with Contents: Read and write.`;
    } else {
      postsError.value =
        reason instanceof Error ? reason.message : "Could not load posts.";
    }
  } finally {
    loadingPosts.value = false;
  }
}

function logout() {
  forgetSignedIn();
  session.value = null;
  posts.value = [];
  postsError.value = "";
  listNotice.value = "";
  createNotice.value = "";
  createPrefill.value = null;
  view.value = "list";
  selectedPost.value = null;
  loginError.value = "";
  void signOut().catch(() => {
    // The local state is already cleared; the server session expires on its own.
  });
  updateQuery();
}

function editPost(post: PostSummary) {
  listNotice.value = "";
  selectedPost.value = post;
  view.value = "edit";
  updateQuery(post);
}

function startCreate(lang: PostLanguage = "en") {
  listNotice.value = "";
  createNotice.value = "";
  createPrefill.value = null;
  createLang.value = lang;
  selectedPost.value = null;
  view.value = "new";
  updateQuery();
}

function backToList() {
  listNotice.value = "";
  createNotice.value = "";
  createPrefill.value = null;
  view.value = "list";
  selectedPost.value = null;
  updateQuery();
}

function onPostSaved(updated: PostSummary) {
  selectedPost.value = updated;
  posts.value = posts.value.map((post) =>
    post.lang === updated.lang && post.slug === updated.slug ? updated : post,
  );
}

async function removePost(post: PostSummary) {
  const current = session.value;
  if (!current || deleting.value) return;
  deleting.value = true;
  postsError.value = "";
  try {
    await deletePost(props.repo, current.token, post.lang, post.slug);
    posts.value = posts.value.filter(
      (candidate) =>
        candidate.lang !== post.lang || candidate.slug !== post.slug,
    );
    listNotice.value = `Deleted posts/${post.lang}/${post.slug}.md.`;
    view.value = "list";
    selectedPost.value = null;
    createPrefill.value = null;
    updateQuery();
  } catch (reason) {
    if (reason instanceof GithubApiError && reason.status === 401) {
      onUnauthorized();
      return;
    }
    if (reason instanceof GithubApiError && reason.status === 404) {
      // Already gone (deleted elsewhere): treat it as a success.
      posts.value = posts.value.filter(
        (candidate) =>
          candidate.lang !== post.lang || candidate.slug !== post.slug,
      );
      listNotice.value = `posts/${post.lang}/${post.slug}.md was already deleted.`;
      view.value = "list";
      selectedPost.value = null;
      createPrefill.value = null;
      updateQuery();
      return;
    }
    postsError.value =
      reason instanceof Error ? reason.message : "Could not delete the post.";
  } finally {
    deleting.value = false;
  }
}

async function onPostCreated(result: CreatePostResult) {
  await loadPosts();
  view.value = "list";
  selectedPost.value = null;
  createNotice.value = "";
  createPrefill.value = null;
  listNotice.value = `Created posts/${result.lang}/${result.slug}.md.`;
  updateQuery();
}

function onUnauthorized() {
  forgetSignedIn();
  session.value = null;
  posts.value = [];
  postsError.value = "";
  listNotice.value = "";
  createNotice.value = "";
  createPrefill.value = null;
  view.value = "list";
  selectedPost.value = null;
  loginError.value = "Your GitHub session expired. Connect again.";
  updateQuery();
}

function updateQuery(post?: PostSummary) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const key of ["lang", "slug", "new", "fromLang", "fromSlug"]) {
    url.searchParams.delete(key);
  }
  if (post) {
    url.searchParams.set("lang", post.lang);
    url.searchParams.set("slug", post.slug);
  }
  window.history.replaceState(null, "", url.href);
}

async function openFromQuery() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("new") === "1") {
    await openCreateFromQuery(params);
    return;
  }

  const lang = params.get("lang");
  const slug = params.get("slug");
  if (!lang || !slug) return;
  if (lang !== "en" && lang !== "es") {
    updateQuery();
    return;
  }
  const post = posts.value.find(
    (candidate) => candidate.lang === lang && candidate.slug === slug,
  );
  if (!post) {
    updateQuery();
    return;
  }
  selectedPost.value = post;
  view.value = "edit";
}

async function openCreateFromQuery(params: URLSearchParams) {
  const lang = params.get("lang");
  if (lang !== "en" && lang !== "es") {
    updateQuery();
    return;
  }

  const fromLang = params.get("fromLang");
  const fromSlug = params.get("fromSlug");
  let prefill: CreatePostPrefill | null = null;
  let notice = "";

  if (
    (fromLang === "en" || fromLang === "es") &&
    fromLang !== lang &&
    fromSlug &&
    isValidSlug(fromSlug)
  ) {
    const current = session.value;
    if (!current) return;
    try {
      const source = await getPost(
        props.repo,
        current.token,
        fromLang,
        fromSlug,
      );
      prefill = {
        lang,
        slug: fromSlug,
        title: source.frontmatter.title,
        description: source.frontmatter.description,
        date: source.frontmatter.date,
        category: source.frontmatter.category,
        tags: source.frontmatter.tags,
        featured: source.frontmatter.featured,
        body: source.body,
      };
    } catch (reason) {
      if (reason instanceof GithubApiError && reason.status === 401) {
        onUnauthorized();
        return;
      }
      prefill = {
        lang,
        slug: fromSlug,
        title: "",
        description: "",
        date: today(),
        category: fallbackCategory,
        tags: [],
        featured: false,
        body: "",
      };
      notice = "Could not load the original post. Fill in the fields manually.";
    }
  }

  createLang.value = lang;
  createPrefill.value = prefill;
  createNotice.value = notice;
  listNotice.value = "";
  selectedPost.value = null;
  view.value = "new";
}

function formatExpiration(expiresAt: number): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);
}
</script>

<template>
  <div class="admin-app">
    <header class="admin-header">
      <div>
        <p class="admin-eyebrow">Content editor</p>
        <h1>Edit posts</h1>
      </div>
      <div v-if="session" class="admin-account">
        <span class="admin-user">@{{ session.login }}</span>
        <span class="admin-expiry">
          Session expires {{ formatExpiration(session.expiresAt) }}
        </span>
        <button class="btn secondary" type="button" @click="logout">
          Log out
        </button>
      </div>
    </header>

    <p v-if="loading" class="admin-hint">Checking session...</p>
    <LoginCard v-else-if="!session" :repo="repo" :initial-error="loginError" />
    <template v-else>
      <template v-if="view === 'list'">
        <p v-if="listNotice" class="admin-success" role="status">
          {{ listNotice }}
        </p>
        <PostList
          :posts="posts"
          :loading="loadingPosts"
          :deleting="deleting"
          :error="postsError"
          @edit="editPost"
          @create="startCreate"
          @refresh="loadPosts"
          @delete="removePost"
        />
      </template>
      <PostEditor
        v-else-if="view === 'edit' && selectedPost"
        :key="`${selectedPost.lang}/${selectedPost.slug}`"
        :repo="repo"
        :token="session.token"
        :post="selectedPost"
        :categories="categories"
        :deleting="deleting"
        @saved="onPostSaved"
        @back="backToList"
        @unauthorized="onUnauthorized"
        @delete="removePost"
      />
      <template v-else-if="view === 'new'">
        <p v-if="createNotice" class="admin-error" role="alert">
          {{ createNotice }}
        </p>
        <PostCreator
          :repo="repo"
          :token="session.token"
          :categories="categories"
          :initial-lang="createLang"
          :prefill="createPrefill ?? undefined"
          @created="onPostCreated"
          @back="backToList"
          @unauthorized="onUnauthorized"
        />
      </template>
      <section v-else class="admin-view">
        <button class="btn secondary" type="button" @click="backToList">
          ← Back to posts
        </button>
        <p>Choose a post from the list.</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin-app {
  display: grid;
  gap: 24px;
}
.admin-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.admin-eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.admin-header h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.2;
}
.admin-account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.admin-user {
  color: var(--text);
  font-weight: 500;
}
.admin-expiry {
  color: var(--muted);
}
.admin-account .btn {
  font-size: 13px;
  padding: 5px 11px;
}
.admin-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
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
:global(.dark) .admin-success {
  border-color: #315640;
  background: #1d2c23;
  color: #91d3a7;
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
.admin-view {
  display: grid;
  gap: 16px;
  justify-items: start;
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
}
.admin-view p {
  margin: 0;
}
.admin-view .btn {
  font-size: 13px;
  padding: 5px 11px;
}
</style>
