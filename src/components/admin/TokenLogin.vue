<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AdminRepoConfig } from "../../lib/admin-config";
import { markWriteVerified, storeSession } from "../../lib/admin-session";
import {
  GithubApiError,
  validateToken,
  verifyWriteAccess,
  type AdminSession,
} from "../../lib/github-content";

const props = defineProps<{
  repo: AdminRepoConfig;
  initialError?: string;
}>();

const emit = defineEmits<{
  authenticated: [session: AdminSession];
}>();

const token = ref("");
const error = ref(props.initialError ?? "");
const loading = ref(false);
const tokenInput = ref<HTMLInputElement | null>(null);

const tokenUrl = computed(() => {
  const params = new URLSearchParams({
    name: "AKC Studio admin",
    description: `Edit posts in ${props.repo.owner}/${props.repo.repo}`,
    expires_in: "90",
    contents: "write",
  });
  params.set("target_name", props.repo.owner);
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
});

onMounted(() => tokenInput.value?.focus());

function errorMessage(reason: unknown): string {
  if (reason instanceof GithubApiError) {
    if (reason.status === 401) {
      return "Invalid or expired token. Generate a new one and try again.";
    }
    if (reason.status === 403) {
      return `GitHub denied access: ${reason.message}. Create a fine-grained token with Contents: Read and write and select ${props.repo.owner}/${props.repo.repo} under Only select repositories.`;
    }
    if (reason.status === 404) {
      return `This token cannot access ${props.repo.owner}/${props.repo.repo}. Check the repository selection.`;
    }
    return reason.message;
  }
  if (reason instanceof TypeError) {
    return "Could not reach GitHub. Check your connection and try again.";
  }
  return reason instanceof Error
    ? reason.message
    : "Could not validate the token.";
}

async function submit() {
  const value = token.value.trim();
  if (!value) {
    error.value = "Enter a GitHub token.";
    return;
  }

  loading.value = true;
  error.value = "";
  try {
    const result = await validateToken(props.repo, value);
    if (!result.canWrite) {
      error.value = "This token does not have write access to the repository.";
      return;
    }
    const write = await verifyWriteAccess(props.repo, value);
    if (!write.canWrite) {
      error.value = `GitHub denied a write check: ${write.message}. Create a fine-grained token with Contents: Read and write and select ${props.repo.owner}/${props.repo.repo} under Only select repositories.`;
      return;
    }
    const session: AdminSession = {
      token: result.token,
      user: result.user,
      expires: result.expires,
    };
    storeSession(session);
    markWriteVerified();
    token.value = "";
    emit("authenticated", session);
  } catch (reason) {
    error.value = errorMessage(reason);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <section class="admin-login" aria-labelledby="admin-login-title">
    <h2 id="admin-login-title">Connect with GitHub</h2>
    <p class="admin-login-lede">
      Changes are committed directly to
      <code>{{ repo.owner }}/{{ repo.repo }}</code
      >. You need a fine-grained token with
      <strong>Contents: Read and write</strong>.
    </p>

    <ol class="admin-steps">
      <li>
        <a :href="tokenUrl" target="_blank" rel="noopener"
          >Open the token creation page</a
        >. The name, expiration and Contents permission are prefilled.
      </li>
      <li>
        Under <strong>Repository access</strong>, choose
        <strong>Only select repositories</strong> and select
        <code>{{ repo.repo }}</code
        >. GitHub cannot preselect this step from a link.
      </li>
      <li>Generate the token, copy it and paste it below.</li>
    </ol>

    <form class="admin-token-form" @submit.prevent="submit">
      <label for="admin-token">GitHub token</label>
      <input
        id="admin-token"
        ref="tokenInput"
        v-model="token"
        class="admin-input"
        type="password"
        placeholder="github_pat_..."
        autocomplete="off"
        spellcheck="false"
        :disabled="loading"
      />
      <p v-if="error" class="admin-error" role="alert">{{ error }}</p>
      <button class="btn" type="submit" :disabled="loading">
        {{ loading ? "Checking..." : "Save token" }}
      </button>
    </form>

    <p class="admin-hint">
      The token is stored only in this browser (<code>localStorage</code>). You
      can revoke it from GitHub at any time.
    </p>
  </section>
</template>

<style scoped>
.admin-login {
  display: grid;
  gap: 14px;
  max-width: 680px;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin-login h2 {
  margin: 0;
  font-size: 21px;
  font-weight: 600;
}
.admin-login-lede {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}
.admin-login-lede code {
  color: var(--text);
}
.admin-steps {
  margin: 0;
  padding-left: 22px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.65;
}
.admin-steps li + li {
  margin-top: 6px;
}
.admin-steps code {
  color: var(--text);
}
.admin-token-form {
  display: grid;
  gap: 10px;
  max-width: 520px;
}
.admin-token-form label {
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
.admin-token-form .btn {
  justify-self: start;
}
.admin-error {
  margin: 0;
  color: #b42318;
  font-size: 14px;
}
:global(.dark) .admin-error {
  color: #ff9b8f;
}
.admin-hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}
</style>
