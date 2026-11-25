import {
  categoryNames,
  normalizeCategory,
  type Category,
} from "../data/post-options";
import { parse, stringify } from "yaml";

export type PostLanguage = "en" | "es";

export type PostFrontmatter = {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  updated?: string; // YYYY-MM-DD
  lang: PostLanguage;
  category: Category;
  tags: string[];
  featured: boolean;
  draft: boolean;
};

export type ParsedPost = {
  frontmatter: PostFrontmatter;
  body: string;
};

export type FrontmatterErrors = Partial<Record<keyof PostFrontmatter, string>>;

export type FrontmatterValidation =
  | { ok: true; value: PostFrontmatter }
  | { ok: false; errors: FrontmatterErrors };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.valueOf())
      ? undefined
      : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? undefined
      : date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return undefined;

  const date = value.trim();
  if (!date) return undefined;
  if (DATE_PATTERN.test(date)) {
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === date
      ? date
      : undefined;
  }

  const parsed = new Date(date);
  return Number.isNaN(parsed.valueOf())
    ? undefined
    : parsed.toISOString().slice(0, 10);
}

export function parseTags(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return undefined;
  if (!value.every((tag): tag is string => typeof tag === "string")) {
    return undefined;
  }
  return value.map((tag) => tag.trim()).filter(Boolean);
}

export function validateFrontmatter(
  value: unknown,
  expectedLang: PostLanguage,
): FrontmatterValidation {
  const errors: FrontmatterErrors = {};
  if (!isRecord(value)) {
    return { ok: false, errors: { title: "Frontmatter is not an object." } };
  }

  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title) errors.title = "Title is required.";

  const description =
    typeof value.description === "string" ? value.description.trim() : "";
  if (!description) errors.description = "Description is required.";

  const date = normalizeDate(value.date);
  if (!date) errors.date = "Use a valid date (YYYY-MM-DD).";

  let updated: string | undefined;
  if (
    value.updated !== undefined &&
    value.updated !== null &&
    value.updated !== ""
  ) {
    updated = normalizeDate(value.updated);
    if (!updated) errors.updated = "Use a valid date (YYYY-MM-DD).";
  }

  const lang = value.lang ?? expectedLang;
  if (lang !== expectedLang) {
    errors.lang = `Language must match the folder (${expectedLang}).`;
  }

  const categoryValue =
    typeof value.category === "string" ? value.category : "";
  const category = normalizeCategory(categoryValue);
  if (!categoryNames.includes(category as Category)) {
    errors.category = "Choose a valid category.";
  }

  const tags = parseTags(value.tags);
  if (!tags) errors.tags = "Tags must be a list of text values.";

  const featured = value.featured === undefined ? false : value.featured;
  if (typeof featured !== "boolean") {
    errors.featured = "Featured must be true or false.";
  }

  const draft = value.draft === undefined ? false : value.draft;
  if (typeof draft !== "boolean") {
    errors.draft = "Draft must be true or false.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      title,
      description,
      date: date as string,
      ...(updated ? { updated } : {}),
      lang: expectedLang,
      category: category as Category,
      tags: tags as string[],
      featured: featured as boolean,
      draft: draft as boolean,
    },
  };
}

export function parsePostSource(
  source: string,
  lang: PostLanguage,
): ParsedPost {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) throw new Error("Post is missing frontmatter.");

  const data = parse(match[1]);
  const result = validateFrontmatter(data, lang);
  if (!result.ok) {
    const details = Object.entries(result.errors)
      .map(([field, message]) => `${field}: ${message}`)
      .join(" ");
    throw new Error(`Invalid frontmatter. ${details}`);
  }

  return {
    frontmatter: result.value,
    body: source
      .slice(match[0].length)
      .replace(/\r\n/g, "\n")
      .replace(/^\n+/, ""),
  };
}

export function serializePost(
  frontmatter: PostFrontmatter,
  body: string,
): string {
  const ordered = {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    ...(frontmatter.updated ? { updated: frontmatter.updated } : {}),
    lang: frontmatter.lang,
    category: frontmatter.category,
    tags: frontmatter.tags,
    featured: frontmatter.featured,
    draft: frontmatter.draft,
  };
  const yaml = stringify(ordered, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
    defaultKeyType: "PLAIN",
  });
  const normalizedBody = body
    .replace(/\r\n/g, "\n")
    .replace(/^\n+/, "")
    .trimEnd();

  return `---\n${yaml}---\n\n${normalizedBody}${normalizedBody ? "\n" : ""}`;
}
