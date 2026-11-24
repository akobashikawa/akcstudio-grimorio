<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Category } from "../../data/post-options";
import type { AdminRepoConfig } from "../../lib/admin-config";
import {
  clearStoredSession,
  loadStoredSession,
  storeSession,
} from "../../lib/admin-session";
import {
  GithubApiError,
  listPosts,
  validateToken,
  type AdminSession,
  type CreatePostResult,
  type PostSummary,
} from "../../lib/github-content";
import PostCreator from "./PostCreator.vue";
import PostEditor from "./PostEditor.vue";
import PostList from "./PostList.vue";
import TokenLogin from "./TokenLogin.vue";

type AdminView = "list" | "edit" | "new";

const props = defineProps<{
  repo: AdminRepoConfig;
  categories: Category[];
}>();

const session = ref<AdminSession | null>(null);
const checking = ref(true);
const loginError = ref("");
const posts = ref<PostSummary[]>([]);
const loadingPosts = ref(false);
const postsError = ref("");
const view = ref<AdminView>("list");
const selectedPost = ref<PostSummary | null>(null);

onMounted(async () => {
  const stored = loadStoredSession();
  if (!stored) {
    checking.value = false;
    return;
  }

  try {
    const result = await validateToken(props.repo, stored.token);
    if (!result.canWrite) {
      clearStoredSession();
      loginError.value =
        "This token does not have write access to the repository.";
      return;
    }
    const next: AdminSession = {
      token: stored.token,
      user: result.user,
      expires: result.expires,
    };
    storeSession(next);
    session.value = next;
    await loadPosts();
  } catch (reason) {
    clearStoredSession();
    loginError.value =
      reason instanceof GithubApiError && reason.status === 401
        ? "Your stored GitHub token expired. Connect again."
        : reason instanceof Error
          ? reason.message
          : "Could not validate the saved token.";
  } finally {
    checking.value = false;
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
      clearStoredSession();
      session.value = null;
      loginError.value = "Your GitHub token expired. Connect again.";
    } else {
      postsError.value =
        reason instanceof Error ? reason.message : "Could not load posts.";
    }
  } finally {
    loadingPosts.value = false;
  }
}

async function onAuthenticated(next: AdminSession) {
  session.value = next;
  loginError.value = "";
  view.value = "list";
  selectedPost.value = null;
  await loadPosts();
}

function logout() {
  clearStoredSession();
  session.value = null;
  posts.value = [];
  postsError.value = "";
  view.value = "list";
  selectedPost.value = null;
  loginError.value = "";
}

function editPost(post: PostSummary) {
  selectedPost.value = post;
  view.value = "edit";
}

function startCreate() {
  selectedPost.value = null;
  view.value = "new";
}

function backToList() {
  view.value = "list";
  selectedPost.value = null;
}

function onPostSaved(updated: PostSummary) {
  selectedPost.value = updated;
  posts.value = posts.value.map((post) =>
    post.lang === updated.lang && post.slug === updated.slug ? updated : post,
  );
}

async function onPostCreated(result: CreatePostResult) {
  await loadPosts();
  const created =
    posts.value.find(
      (post) => post.lang === "en" && post.slug === result.slug,
    ) ?? posts.value.find((post) => post.slug === result.slug);
  if (created) {
    selectedPost.value = created;
    view.value = "edit";
  } else {
    view.value = "list";
  }
}

function onUnauthorized() {
  clearStoredSession();
  session.value = null;
  posts.value = [];
  postsError.value = "";
  view.value = "list";
  selectedPost.value = null;
  loginError.value = "Your GitHub token expired. Connect again.";
}

function formatExpiration(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
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
        <span class="admin-user">@{{ session.user }}</span>
        <span v-if="session.expires" class="admin-expiry">
          Token expires {{ formatExpiration(session.expires) }}
        </span>
        <button class="btn secondary" type="button" @click="logout">
          Log out
        </button>
      </div>
    </header>

    <p v-if="checking" class="admin-hint">Checking saved token...</p>
    <TokenLogin
      v-else-if="!session"
      :repo="repo"
      :initial-error="loginError"
      @authenticated="onAuthenticated"
    />
    <template v-else>
      <PostList
        v-if="view === 'list'"
        :posts="posts"
        :loading="loadingPosts"
        :error="postsError"
        @edit="editPost"
        @create="startCreate"
        @refresh="loadPosts"
      />
      <PostEditor
        v-else-if="view === 'edit' && selectedPost"
        :key="`${selectedPost.lang}/${selectedPost.slug}`"
        :repo="repo"
        :token="session.token"
        :post="selectedPost"
        :categories="categories"
        @saved="onPostSaved"
        @back="backToList"
        @unauthorized="onUnauthorized"
      />
      <PostCreator
        v-else-if="view === 'new'"
        :repo="repo"
        :token="session.token"
        :categories="categories"
        @created="onPostCreated"
        @back="backToList"
        @unauthorized="onUnauthorized"
      />
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
