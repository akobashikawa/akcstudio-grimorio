#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const languages = ["en", "es"];

function fail(message) {
  console.error(`new-post: ${message}`);
  process.exit(1);
}

function usage() {
  console.log(`Usage: pnpm new-post <slug> [options]

Creates the English and Spanish Markdown files for a new post.

Options:
  -c, --category <name>  One of: ${categories.join(", ")} (default: notes)
      --date <YYYY-MM-DD> Post date (default: today)
      --title <text>      Initial title (default: derived from the slug)
      --published         Create the post with draft: false
  -h, --help              Show this help`);
}

function categoriesFromSource() {
  const path = join(root, "src/data/post-options.ts");
  const source = readFileSync(path, "utf8");
  const block = /export const categoryNames = \[([^\]]*)\]/.exec(source);
  if (!block) fail(`could not read categoryNames from ${path}`);
  const names = [...block[1].matchAll(/["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (names.length === 0) fail("categoryNames in post-options.ts is empty");
  return names;
}

function parseArgs(argv) {
  const options = { category: "notes", draft: true };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const equals = arg.indexOf("=");
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : arg.slice(equals + 1);
    const value = () => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        fail(`${flag} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (flag) {
      case "-c":
      case "--category":
        options.category = value();
        break;
      case "--date":
        options.date = value();
        break;
      case "--title":
        options.title = value();
        break;
      case "--published":
        options.draft = false;
        break;
      case "-h":
      case "--help":
        options.help = true;
        break;
      default:
        if (flag.startsWith("-")) fail(`unknown option: ${flag}`);
        positional.push(arg);
    }
  }
  if (options.help) return options;
  if (positional.length !== 1) fail("pass exactly one slug");
  options.slug = positional[0];
  return options;
}

function today() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function titleFromSlug(slug) {
  const words = slug.split("-").filter(Boolean);
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

const categories = categoriesFromSource();
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  usage();
  process.exit(0);
}

const { slug } = options;
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
  fail("slug must be lowercase kebab-case, for example: my-first-post");
}
if (categories.includes(slug)) {
  fail(`"${slug}" is a category name; pick a different slug`);
}

const date = options.date ?? today();
const parsedDate = new Date(`${date}T00:00:00Z`);
if (
  !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
  Number.isNaN(parsedDate.valueOf()) ||
  parsedDate.toISOString().slice(0, 10) !== date
) {
  fail(`invalid date "${date}", expected YYYY-MM-DD`);
}
if (!categories.includes(options.category)) {
  fail(
    `unknown category "${options.category}", expected one of: ${categories.join(", ")}`,
  );
}

const title = options.title?.trim() || titleFromSlug(slug);
const files = languages.map((lang) => ({
  lang,
  file: join(root, "src/content/posts", lang, `${slug}.md`),
}));

for (const { file } of files) {
  if (existsSync(file)) {
    fail(
      `${relative(process.cwd(), file)} already exists; choose another slug or edit it directly`,
    );
  }
}

const frontmatter = (lang) => `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(
  lang === "es" ? "Descripción pendiente." : "Pending description.",
)}
date: ${date}
lang: ${lang}
category: ${options.category}
tags: []
featured: false
draft: ${options.draft}
---

${lang === "es" ? "Escribe aquí el contenido del post." : "Write the post body here."}
`;

for (const { lang, file } of files) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, frontmatter(lang), { flag: "wx" });
  console.log(`created ${relative(process.cwd(), file)}`);
}

console.log(`
Next:
  1. Fill in the title, description and body in both files.
  2. Set "draft: false" when the post is ready to publish.
  3. Run pnpm dev (or pnpm build) to preview it.`);
