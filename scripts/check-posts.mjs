#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const languages = ["en", "es"];
const defaultLanguage = "en";
const problems = [];
const warnings = [];
let unpaired = 0;

const postsDir = (lang) => join(root, "src/content/posts", lang);
const postFile = (lang, name) => join(postsDir(lang), name);

function posts(lang) {
  const dir = postsDir(lang);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && !name.startsWith("_"))
    .sort();
}

function frontmatter(file) {
  const source = readFileSync(file, "utf8");
  return /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? "";
}

function field(frontmatterSource, name) {
  const value = new RegExp(`^${name}:\\s*(.+?)\\s*$`, "m").exec(
    frontmatterSource,
  )?.[1];
  return value?.replace(/^["']|["']$/g, "").trim();
}

const collection = Object.fromEntries(
  languages.map((lang) => [lang, posts(lang)]),
);
const slugs = Object.fromEntries(
  languages.map((lang) => [
    lang,
    new Set(collection[lang].map((name) => name.replace(/\.md$/, ""))),
  ]),
);

for (const lang of languages) {
  const other = languages.find((candidate) => candidate !== lang);
  for (const name of collection[lang]) {
    const slug = name.replace(/\.md$/, "");
    const file = postFile(lang, name);
    const path = relative(root, file);
    const data = frontmatter(file);
    if (!slugs[other].has(slug) && field(data, "draft") !== "true") {
      unpaired += 1;
      warnings.push(`${path}: no ${other} translation yet`);
    }
    const declared = field(data, "lang");
    if (!declared) {
      if (lang !== defaultLanguage) {
        problems.push(
          `${path}: missing "lang: ${lang}" (the default is ${defaultLanguage})`,
        );
      }
    } else if (declared !== lang) {
      problems.push(
        `${path}: lang is "${declared}" but the file is in ${lang}/`,
      );
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      warnings.push(`${path}: slug is not lowercase kebab-case`);
    }
  }
}

for (const slug of new Set([...slugs.en, ...slugs.es])) {
  if (!slugs.en.has(slug) || !slugs.es.has(slug)) continue;
  const drafts = languages.map((lang) => {
    const value = field(frontmatter(postFile(lang, `${slug}.md`)), "draft");
    return { lang, draft: value === "true" };
  });
  if (drafts.some(({ draft }) => draft) && drafts.some(({ draft }) => !draft)) {
    const states = drafts
      .map(({ lang, draft }) => `${lang}:${draft ? "draft" : "published"}`)
      .join(", ");
    warnings.push(`posts/${slug}.md: draft state differs (${states})`);
  }
}

for (const warning of warnings) console.warn(`warning: ${warning}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  console.error(`\n${problems.length} post problem(s) found.`);
  process.exit(1);
}
const total = collection.en.length + collection.es.length;
const suffix = unpaired > 0 ? ` (${unpaired} without translation)` : "";
console.log(
  `✓ ${total} post files validated across ${languages.join("/")}${suffix}.`,
);
