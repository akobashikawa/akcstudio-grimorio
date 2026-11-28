import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import type { Language } from "../src/i18n";

const postsDirectory = fileURLToPath(
  new URL("../src/content/posts", import.meta.url),
);

// Posts per page used by PostFeed.vue; keep in sync with its `pageSize`.
export const PAGE_SIZE = 5;

export type PostFixture = {
  slug: string;
  title: string;
  description: string;
  /** ISO date (YYYY-MM-DD) from the frontmatter. */
  date: string;
  category: string;
  tags: string[];
  featured: boolean;
  draft: boolean;
  /** Number of `##` headings in the body. */
  headings: number;
  /** Number of fenced Mermaid blocks in the body. */
  diagrams: number;
  /** Number of fenced code blocks excluding Mermaid (they get a copy button). */
  codeBlocks: number;
};

type Frontmatter = {
  title?: unknown;
  description?: unknown;
  date?: unknown;
  category?: unknown;
  tags?: unknown;
  featured?: unknown;
  draft?: unknown;
};

// The `yaml` core schema keeps date-like scalars as strings, matching how
// `astro:content` exposes them to the site code.
function parseFrontmatter(source: string): {
  data: Frontmatter;
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);
  if (!match) throw new Error("Post is missing frontmatter");
  return {
    data: (parse(match[1]) ?? {}) as Frontmatter,
    body: source.slice(match[0].length),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePost(lang: Language, file: string): PostFixture {
  const slug = file.replace(/\.md$/, "");
  const { data, body } = parseFrontmatter(
    readFileSync(join(postsDirectory, lang, file), "utf8"),
  );
  const fences = body.match(/^```\S*/gm) ?? [];
  const diagrams = fences.filter((fence) => fence === "```mermaid").length;
  return {
    slug,
    title: text(data.title),
    description: text(data.description),
    date: text(data.date),
    category: text(data.category),
    // Pages CMS writes tags as a block list; the schema also accepts inline
    // arrays. Both arrive as a string[].
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    featured: data.featured === true,
    draft: data.draft === true,
    headings: (body.match(/^## /gm) ?? []).length,
    diagrams,
    codeBlocks: fences.length / 2 - diagrams,
  };
}

/** Published posts for a language, newest first (same order as getPosts()). */
export function publishedPosts(lang: Language): PostFixture[] {
  return readdirSync(join(postsDirectory, lang))
    .filter((file) => file.endsWith(".md") && !file.startsWith("_"))
    .map((file) => parsePost(lang, file))
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function countBy(
  posts: PostFixture[],
  key: (post: PostFixture) => string,
): Record<string, number> {
  return posts.reduce<Record<string, number>>((counts, post) => {
    const value = key(post);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

/** Month (YYYY-MM) with the most posts, used to exercise the archive filter. */
export function busiestMonth(posts: PostFixture[]) {
  const [month, count] = Object.entries(
    countBy(posts, (post) => post.date.slice(0, 7)),
  ).sort((a, b) => b[1] - a[1])[0];
  return { month, count };
}
