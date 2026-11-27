import type { Category } from "../data/post-options";
import type { AdminRepoConfig } from "./admin-config";
import {
  parsePostSource,
  serializePost,
  today,
  validateFrontmatter,
  type PostFrontmatter,
  type PostLanguage,
} from "./frontmatter";

const API_BASE = "https://api.github.com";
const CONTENT_ROOT = "src/content/posts";

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class GithubApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export type TokenValidation = {
  token: string;
  user: string;
  expires?: string;
  canWrite: boolean;
};

export type WriteAccessResult =
  { canWrite: true } | { canWrite: false; status: number; message: string };

export type PostFile = {
  lang: PostLanguage;
  slug: string;
  path: string;
  sha: string;
  frontmatter: PostFrontmatter;
  body: string;
};

export type PostSummary = {
  lang: PostLanguage;
  slug: string;
  title: string;
  date: string;
  category: string;
  draft: boolean;
  updated?: string;
  sha: string;
};

export type SavePostInput = {
  lang: PostLanguage;
  slug: string;
  sha: string;
  frontmatter: PostFrontmatter;
  body: string;
};

export type SavePostResult = {
  sha: string;
  commitSha: string;
  frontmatter: PostFrontmatter;
};

export type CreatePostInput = {
  lang: PostLanguage;
  slug: string;
  frontmatter: PostFrontmatter;
  body: string;
};

export type CreatePostResult = {
  lang: PostLanguage;
  slug: string;
  path: string;
  sha: string;
  commitSha: string;
};

// Values used to prefill the creator when a translation is missing.
export type CreatePostPrefill = {
  lang: PostLanguage;
  slug: string;
  title: string;
  description: string;
  date: string;
  category: Category;
  tags: string[];
  featured: boolean;
  body: string;
};

type ContentsItem = {
  type: "file" | "dir";
  name: string;
  path: string;
  sha: string;
};

type ContentsFile = ContentsItem & {
  type: "file";
  content?: string;
  encoding?: string;
};

type ContentsPutResponse = {
  content: { sha: string };
  commit: { sha: string };
};

type ContentsDeleteResponse = {
  commit: { sha: string };
};

type RepoResponse = {
  permissions?: { push?: boolean };
};

type UserResponse = {
  login: string;
};

type GitObjectResponse = {
  sha: string;
};

export type DeletePostResult = {
  lang: PostLanguage;
  slug: string;
  path: string; // src/content/posts/{lang}/{slug}.md
  commitSha: string;
};

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export function postPath(lang: PostLanguage, slug: string): string {
  return `${CONTENT_ROOT}/${lang}/${slug}.md`;
}

export function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { message?: unknown };
    if (typeof data.message === "string" && data.message.trim()) {
      return data.message;
    }
  } catch {
    // GitHub occasionally returns plain text or HTML for proxy failures.
  }
  return text.trim() || `GitHub request failed (${response.status}).`;
}

async function githubFetch(
  path: string,
  token: string,
  init: RequestInit = {},
  options: { allowNotFound?: boolean } = {},
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  // GitHub requires a User-Agent. Browsers send one automatically (and ignore
  // this override: it is a forbidden header name), but Cloudflare Workers'
  // fetch() does not, so the server-side session code needs it explicitly.
  headers.set("User-Agent", "akcstudio-grimorio-admin");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers,
    ...(method === "GET" ? { cache: "no-store" as const } : {}),
  });

  if (options.allowNotFound && response.status === 404) return response;
  if (!response.ok) {
    throw new GithubApiError(response.status, await readErrorMessage(response));
  }
  return response;
}

async function githubJson<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await githubFetch(path, token, init);
  return (await response.json()) as T;
}

function repoPath(config: AdminRepoConfig): string {
  return `/repos/${config.owner}/${config.repo}`;
}

function contentsPath(config: AdminRepoConfig, path: string): string {
  return `${repoPath(config)}/contents/${path}?ref=${encodeURIComponent(
    config.branch,
  )}`;
}

export async function validateToken(
  config: AdminRepoConfig,
  token: string,
): Promise<TokenValidation> {
  const [repoResponse, userResponse] = await Promise.all([
    githubFetch(repoPath(config), token),
    githubFetch("/user", token),
  ]);
  const repo = (await repoResponse.json()) as RepoResponse;
  const user = (await userResponse.json()) as UserResponse;
  const expires =
    repoResponse.headers.get("github-authentication-token-expiration") ??
    userResponse.headers.get("github-authentication-token-expiration") ??
    undefined;

  return {
    token,
    user: user.login,
    expires: expires || undefined,
    canWrite: repo.permissions?.push === true,
  };
}

// `permissions.push` describes the user's role, not necessarily what the
// token is allowed to do. The only reliable capability check is a write call.
// This creates an unreferenced blob (no commit and no ref update); GitHub
// garbage-collects it later.
export async function verifyWriteAccess(
  config: AdminRepoConfig,
  token: string,
): Promise<WriteAccessResult> {
  try {
    await githubJson<GitObjectResponse>(
      `${repoPath(config)}/git/blobs`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          content: "opencode-admin-write-check",
          encoding: "utf-8",
        }),
      },
    );
    return { canWrite: true };
  } catch (reason) {
    if (
      reason instanceof GithubApiError &&
      (reason.status === 401 || reason.status === 403 || reason.status === 404)
    ) {
      return {
        canWrite: false,
        status: reason.status,
        message: reason.message,
      };
    }
    throw reason;
  }
}

export async function listPosts(
  config: AdminRepoConfig,
  token: string,
  lang: PostLanguage,
): Promise<PostSummary[]> {
  const items = await githubJson<ContentsItem[]>(
    contentsPath(config, `${CONTENT_ROOT}/${lang}`),
    token,
  );
  const files = items.filter(
    (item) =>
      item.type === "file" &&
      item.name.endsWith(".md") &&
      !item.name.startsWith("_"),
  );

  const posts = await Promise.all(
    files.map(async (item) => {
      const slug = item.name.replace(/\.md$/, "");
      try {
        const post = await getPost(config, token, lang, slug);
        return summarize(post);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not read posts/${lang}/${slug}.md: ${message}`);
      }
    }),
  );

  return posts.sort(
    (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
  );
}

export async function getPost(
  config: AdminRepoConfig,
  token: string,
  lang: PostLanguage,
  slug: string,
): Promise<PostFile> {
  const path = postPath(lang, slug);
  const file = await githubJson<ContentsFile>(
    contentsPath(config, path),
    token,
  );
  if (file.type !== "file" || typeof file.content !== "string") {
    throw new Error(`GitHub did not return file content for ${path}.`);
  }
  const parsed = parsePostSource(decodeBase64(file.content), lang);
  return {
    lang,
    slug,
    path,
    sha: file.sha,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
  };
}

export async function savePost(
  config: AdminRepoConfig,
  token: string,
  input: SavePostInput,
): Promise<SavePostResult> {
  const validation = validateFrontmatter(input.frontmatter, input.lang);
  if (!validation.ok) {
    const details = Object.entries(validation.errors)
      .map(([field, message]) => `${field}: ${message}`)
      .join(" ");
    throw new Error(`Invalid frontmatter. ${details}`);
  }

  const frontmatter = { ...validation.value, updated: today() };
  const response = await githubJson<ContentsPutResponse>(
    `${repoPath(config)}/contents/${postPath(input.lang, input.slug)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `cms: update posts/${input.lang}/${input.slug}.md`,
        content: encodeBase64(serializePost(frontmatter, input.body)),
        branch: config.branch,
        sha: input.sha,
      }),
    },
  );

  return {
    sha: response.content.sha,
    commitSha: response.commit.sha,
    frontmatter,
  };
}

export async function createPost(
  config: AdminRepoConfig,
  token: string,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  if (!isValidSlug(input.slug)) {
    throw new Error(
      "Slug must be lowercase kebab-case, for example: my-first-post.",
    );
  }

  const validation = validateFrontmatter(input.frontmatter, input.lang);
  if (!validation.ok) {
    const details = Object.entries(validation.errors)
      .map(([field, message]) => `${field}: ${message}`)
      .join(" ");
    throw new Error(`Invalid frontmatter. ${details}`);
  }

  const path = postPath(input.lang, input.slug);
  const existing = await githubFetch(
    contentsPath(config, path),
    token,
    {},
    { allowNotFound: true },
  );
  await existing.text();
  if (existing.status !== 404) {
    throw new GithubApiError(
      409,
      `A post with slug "${input.slug}" already exists in ${input.lang}.`,
    );
  }

  const response = await githubJson<ContentsPutResponse>(
    `${repoPath(config)}/contents/${path}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({
        message: `cms: create posts/${input.lang}/${input.slug}.md`,
        content: encodeBase64(serializePost(validation.value, input.body)),
        branch: config.branch,
      }),
    },
  );

  return {
    lang: input.lang,
    slug: input.slug,
    path,
    sha: response.content.sha,
    commitSha: response.commit.sha,
  };
}

/**
 * Delete a single post file. DELETE needs the current blob sha, so the file is
 * read first; a 404 on that read means the post is already gone and is
 * surfaced as a GithubApiError(404) for the caller to treat as success.
 */
export async function deletePost(
  config: AdminRepoConfig,
  token: string,
  lang: PostLanguage,
  slug: string,
): Promise<DeletePostResult> {
  const path = postPath(lang, slug);
  const file = await githubFetch(
    contentsPath(config, path),
    token,
    {},
    { allowNotFound: true },
  );
  if (file.status === 404) {
    throw new GithubApiError(
      404,
      `posts/${lang}/${slug}.md does not exist (it was already deleted).`,
    );
  }
  const { sha } = (await file.json()) as ContentsFile;

  const response = await githubJson<ContentsDeleteResponse>(
    `${repoPath(config)}/contents/${path}`,
    token,
    {
      method: "DELETE",
      body: JSON.stringify({
        message: `cms: delete posts/${lang}/${slug}.md`,
        sha,
        branch: config.branch,
      }),
    },
  );

  return {
    lang,
    slug,
    path,
    commitSha: response.commit.sha,
  };
}

function summarize(post: PostFile): PostSummary {
  return {
    lang: post.lang,
    slug: post.slug,
    title: post.frontmatter.title,
    date: post.frontmatter.date,
    category: post.frontmatter.category,
    draft: post.frontmatter.draft,
    updated: post.frontmatter.updated,
    sha: post.sha,
  };
}
