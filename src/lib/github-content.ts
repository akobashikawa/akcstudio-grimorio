import type { Category } from "../data/post-options";
import type { AdminRepoConfig } from "./admin-config";
import {
  createPostFrontmatter,
  parsePostSource,
  serializePost,
  today,
  validateFrontmatter,
  type PostFrontmatter,
  type PostLanguage,
} from "./frontmatter";

const API_BASE = "https://api.github.com";
const CONTENT_ROOT = "src/content/posts";

export const POST_LANGUAGES: PostLanguage[] = ["en", "es"];
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

export type AdminSession = {
  token: string;
  user: string;
  expires?: string;
};

export type TokenValidation = AdminSession & {
  canWrite: boolean;
};

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
  slug: string;
  title: string;
  date: string;
  category: Category;
  tags: string[];
};

export type CreatePostResult = {
  slug: string;
  commitSha: string;
  files: { lang: PostLanguage; path: string; sha: string }[];
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

type RepoResponse = {
  permissions?: { push?: boolean };
};

type UserResponse = {
  login: string;
};

type GitRefResponse = {
  object: { sha: string };
};

type GitCommitResponse = {
  sha: string;
  tree: { sha: string };
};

type GitObjectResponse = {
  sha: string;
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
    throw new GithubApiError(
      response.status,
      await readErrorMessage(response),
    );
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

export async function createPostPair(
  config: AdminRepoConfig,
  token: string,
  input: CreatePostInput,
): Promise<CreatePostResult> {
  if (!isValidSlug(input.slug)) {
    throw new Error(
      "Slug must be lowercase kebab-case, for example: my-first-post.",
    );
  }

  const files = POST_LANGUAGES.map((lang) => {
    const frontmatter = createPostFrontmatter({ ...input, lang });
    const validation = validateFrontmatter(frontmatter, lang);
    if (!validation.ok) {
      const details = Object.entries(validation.errors)
        .map(([field, message]) => `${field}: ${message}`)
        .join(" ");
      throw new Error(`Invalid frontmatter. ${details}`);
    }
    return {
      lang,
      path: postPath(lang, input.slug),
      content: serializePost(validation.value, ""),
    };
  });

  await Promise.all(
    files.map(async (file) => {
      const response = await githubFetch(
        contentsPath(config, file.path),
        token,
        {},
        { allowNotFound: true },
      );
      await response.text();
      if (response.status !== 404) {
        throw new GithubApiError(
          409,
          `A post with slug "${input.slug}" already exists in ${file.lang}.`,
        );
      }
    }),
  );

  const root = repoPath(config);
  const ref = await githubJson<GitRefResponse>(
    `${root}/git/ref/heads/${config.branch}`,
    token,
  );
  const head = await githubJson<GitCommitResponse>(
    `${root}/git/commits/${ref.object.sha}`,
    token,
  );

  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await githubJson<GitObjectResponse>(
        `${root}/git/blobs`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ content: file.content, encoding: "utf-8" }),
        },
      );
      return { ...file, sha: blob.sha };
    }),
  );

  const tree = await githubJson<GitObjectResponse>(`${root}/git/trees`, token, {
    method: "POST",
    body: JSON.stringify({
      base_tree: head.tree.sha,
      tree: blobs.map(({ path, sha }) => ({
        path,
        mode: "100644",
        type: "blob",
        sha,
      })),
    }),
  });

  const commit = await githubJson<GitObjectResponse>(
    `${root}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: `cms: create ${files
          .map((file) => `posts/${file.lang}/${input.slug}.md`)
          .join(" and ")}`,
        tree: tree.sha,
        parents: [ref.object.sha],
      }),
    },
  );

  await githubJson<GitRefResponse>(
    `${root}/git/refs/heads/${config.branch}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );

  return {
    slug: input.slug,
    commitSha: commit.sha,
    files: blobs.map(({ lang, path, sha }) => ({ lang, path, sha })),
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
