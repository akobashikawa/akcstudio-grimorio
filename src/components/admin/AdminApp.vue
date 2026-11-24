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
  validateToken,
  type AdminSession,
} from "../../lib/github-content";
import TokenLogin from "./TokenLogin.vue";

const props = defineProps<{
  repo: AdminRepoConfig;
  categories: Category[];
}>();

const session = ref<AdminSession | null>(null);
const checking = ref(true);
const loginError = ref("");

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

function onAuthenticated(next: AdminSession) {
  session.value = next;
  loginError.value = "";
}

function logout() {
  clearStoredSession();
  session.value = null;
  loginError.value = "";
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
    <section v-else class="admin-placeholder">
      <p>
        Connected to <code>{{ repo.owner }}/{{ repo.repo }}</code
        >. The post list arrives in the next step.
      </p>
    </section>
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
.admin-placeholder {
  padding: 18px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-size: 14px;
}
.admin-placeholder p {
  margin: 0;
}
</style>
