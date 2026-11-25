export const SLUG_MAX_LENGTH = 60;

// Derives a URL-safe slug from a title: diacritics removed, lowercase, groups
// of non-alphanumeric characters collapsed into single hyphens.
export function slugify(title: string): string {
  const normalized = title
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length <= SLUG_MAX_LENGTH) return normalized;

  const clipped = normalized.slice(0, SLUG_MAX_LENGTH);
  const boundary = clipped.lastIndexOf("-");
  const shortened = boundary > 0 ? clipped.slice(0, boundary) : clipped;
  return shortened.replace(/-+$/, "");
}
