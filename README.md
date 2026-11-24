# AKC Studio - Grimorio

Blog con Astro y Grimorio.

---

A fast, bilingual blog theme for Astro, built for writing of any kind: guides, notes, essays, or a dev log. English and Spanish out of the box, light/dark themes, full-text search, and social images generated at build time. No client-side framework runs the page: Vue powers only the few interactive islands, everything else ships as static HTML.

**[Live site](https://akcstudio-grimorio.akobashikawa.workers.dev)** · built with [Astro](https://astro.build), [Vue](https://vuejs.org) and [Tailwind CSS](https://tailwindcss.com).

> Grimorio ships with example posts, projects, and copy so you can see every feature working. Replace them with your own — see [Make it yours](#make-it-yours).

## Features

- **Bilingual.** English at `/`, Spanish at `/es/`, with a language switch that keeps you on the same page. Change the default or add/drop a language from one config file.
- **Writing-first.** Markdown posts with categories, tags, a monthly archive, and pagination. Pair a post across languages by giving both files the same name.
- **Search.** Client-side full-text search over every post, opened with `Ctrl` / `⌘ + K`.
- **Light and dark.** Theme toggle that respects the system preference and `prefers-reduced-motion`, with no flash on load.
- **Generated images.** Each post gets a 1200×630 social card and a wide hero banner rendered from its title and category at build time — no design work per post. Drop an image in `src/assets/banners/` to override the banner for a specific post.
- **SEO without the busywork.** Per-page canonical URLs, `hreflang`, Open Graph and Twitter tags, JSON-LD structured data, a `sitemap.xml` with real `lastmod` dates, per-language RSS, `robots.txt`, and an `llms.txt` summary for AI crawlers.
- **Fast by default.** Static output, inlined critical CSS, hover prefetching, and self-hosted fonts. A clean build scores 100 across the board in Lighthouse.
- **Tested.** A Playwright suite covers navigation, search, theming, i18n, and metadata on both desktop and mobile viewports.

## Tech stack

Astro 7 · Vue 3 (islands only) · Tailwind CSS 4 · TypeScript · Satori + Sharp for image generation · Cloudflare Workers (`@astrojs/cloudflare` + Wrangler) · Playwright for tests.

## Quick start

You need **Node.js 24** (22.12 minimum) and **pnpm 10.33**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://localhost:4321>.

| Command               | What it does                             |
| --------------------- | ---------------------------------------- |
| `pnpm dev`            | Start the dev server                     |
| `pnpm build`          | Type-check, then build to `dist/client/` |
| `pnpm run deploy`     | Build and deploy to Cloudflare Workers   |
| `pnpm smoke`          | Smoke-test the build or a deployed URL   |
| `pnpm new-post`       | Scaffold a bilingual post draft          |
| `pnpm preview`        | Serve the production build locally       |
| `pnpm check`          | Type-check Astro, Vue, and TypeScript    |
| `pnpm test`           | Build and run the browser tests          |
| `pnpm test:a11y`      | Run the axe accessibility checks         |
| `pnpm format`         | Format the codebase with Prettier        |
| `pnpm generate-types` | Regenerate Cloudflare binding types      |

## Project structure

```
src/
├─ assets/            Logo/avatar (and optional per-post banner overrides)
├─ components/        Vue islands + Astro layout pieces
├─ content/posts/     Your posts, as es/ and en/ Markdown
├─ data/              Category and projects data
├─ i18n/              UI strings (es.json, en.json) + language config
├─ layouts/           Base and blog layouts
├─ lib/               Image generation, post helpers
├─ pages/             Routes, feeds, sitemap, OG/banner endpoints
└─ styles/global.css  Theme colors and base styles
public/               Favicons, fonts, static SVGs
```

## Content types

The site has two content sources, each with its own format and publishing flow:

| Type         | Format                 | Where                                            | Publishing flow                                                                                         |
| ------------ | ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Posts**    | Markdown collection    | `src/content/posts/en/`, `src/content/posts/es/` | Scaffold with `pnpm new-post`, edit the frontmatter and body, set `draft: false`, then build and deploy |
| **Projects** | Typed TypeScript array | `src/data/projects.ts`                           | Add or edit an object in `getProjects()`, then build and deploy                                         |

Only posts go through Astro's content collections and schema validation. Projects are a plain data module, so they have no drafts, dates, or pairing rules. Everything else (site name, navigation, UI copy, theme colors) is configuration rather than content; see [Make it yours](#make-it-yours).

## Make it yours

Everything you'll normally touch lives in a handful of files:

| What                          | Where                                              |
| ----------------------------- | -------------------------------------------------- |
| Site name, author, nav, links | `src/site.config.json`                             |
| All interface text            | `src/i18n/es.json`, `src/i18n/en.json`             |
| Avatar and logo               | `src/assets/akcstudio-logo.png`                    |
| Theme colors                  | `src/styles/global.css` (`:root` and `:root.dark`) |
| Posts                         | `src/content/posts/es/`, `src/content/posts/en/`   |
| Projects page                 | `src/data/projects.ts`                             |
| Production domain             | `SITE_URL` in `.env` (see `.env.example`)          |

After cloning, delete the example posts in `src/content/posts/` and the favicons in `public/` you want to replace, then set your domain so the canonical URLs, feeds, sitemap, and social images point at the right place.

### Writing a post

Create `src/content/posts/<lang>/<slug>.md`. Use the **same slug** in `es/` and `en/` so the language switch links the two versions.

Scaffold both files at once:

```sh
pnpm new-post my-post --category guides
```

It creates `en/my-post.md` and `es/my-post.md` as drafts with the same slug. The command also accepts `--date`, `--title`, and `--published`.

```yaml
---
title: "My post"
description: "One or two sentences. Used for SEO and the social card."
date: 2026-09-20
lang: en # must match the folder
category: notes # guides | notes | stories
tags: ["Guides", "Astro"]
featured: false # featured posts are highlighted on the home page
draft: false # drafts are excluded from the build
updated: 2026-10-01 # optional: last-reviewed date, used in the sitemap
---
```

`pnpm check` (and therefore `pnpm build`) runs `pnpm check:posts`: every post must have a counterpart in the other language, and its `lang` must match the folder.

The body is standard Markdown: headings, tables, fenced code (with a copy button and syntax highlighting), blockquotes, and images all work. For diagrams, drop an SVG in `public/` and reference it with a `<figure class="diagram">`.

### Adding a project

Projects are listed from a typed array in `src/data/projects.ts`; there is no Markdown file or CMS. Add an object to the array returned by `getProjects()`:

```ts
{
  name: "My project",
  description: es
    ? "Qué hace y por qué es interesante."
    : "What it does and why it is interesting.",
  url: "https://github.com/you/my-project",
  icon: "icon-[lucide--code-2]",
  tech: ["Astro", "Cloudflare"],
  status: es ? "En producción" : "Live",
}
```

- `description` and `status` carry one value per language, picked with the `es` flag.
- `url` opens in a new tab, so it works for repositories, demos, or store listings.
- `icon` is an Iconify class; the `lucide` and `simple-icons` sets are installed.
- `tech` renders as small pills under the description.
- The order in the array is the order of the cards (two columns on desktop, one on mobile).
- The page is served at `/projects/` and `/es/projects/`. Its copy lives in the `projects.*` keys of `src/i18n/*.json`, and the navigation entry in `src/site.config.json`.
- There is no draft flag or date: a project shows up on the next build.

### Publishing content

Both content types are baked in at build time, so publishing means building and deploying:

1. `pnpm dev` to preview the change locally.
2. `pnpm check` (also part of `pnpm build`) to validate types, post pairing, and frontmatter.
3. Commit and push to `master` for the deploy workflow, or run `pnpm run deploy` locally.

Only posts with `draft: false` are included in the build; projects have no draft state and ship on the next build.

### Renaming categories

The three example categories are `guides`, `notes`, and `stories`. To change them, edit the list in `src/data/post-options.ts`, the enum in `src/content.config.ts`, and the `category.*` labels in both `src/i18n/*.json`.

### Changing languages

Languages are declared in `src/i18n/index.ts` (`languages` and `defaultLanguage`). To run the site in a single language, keep one entry; to swap the default, change `defaultLanguage`. Keep the sitemap locales in `astro.config.mjs` in sync.

## Deployment

The site renders to static HTML, so the output in `dist/client/` can be served by any static host. This repo is configured for **Cloudflare Workers** through the `@astrojs/cloudflare` adapter and `wrangler.jsonc`: the build writes the static assets and the Worker entrypoint, and Wrangler picks both up automatically.

Set `SITE_URL` to your production origin before building so canonical URLs, feeds, the sitemap, and social images point at the right place.

### Cloudflare Workers

1. Deploy:

   ```sh
   pnpm run deploy
   ```

   This type-checks, builds, and runs `wrangler deploy`. Use `pnpm run` because `pnpm deploy` is a reserved pnpm command for workspaces. The first deploy provisions the bindings declared by the adapter and prints a `*.workers.dev` URL.

2. Set `SITE_URL=https://yourdomain.com` in your local `.env` (or as the `SITE_URL` repository variable for CI), add your custom domain, and redeploy.

To run the built site against the Cloudflare runtime locally:

```sh
pnpm build
pnpm exec wrangler dev
```

### Continuous deployment

The repo includes `.github/workflows/deploy.yml`: every push to `master` (or a manual run) builds, deploys with Wrangler, and smoke-tests the production URL. Add these repository secrets under **Settings → Secrets and variables → Actions**:

| Secret                  | Value                                               |
| ----------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with **Workers Scripts: Edit** permission |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID                          |

Optionally set the `SITE_URL` repository variable to override the default production origin. While the secrets are missing, the workflow builds and skips the deploy with a warning annotation instead of failing.

If you prefer Workers Builds, connect the repository in the Cloudflare dashboard instead and disable `.github/workflows/deploy.yml` so pushes are not deployed twice:

| Field          | Value                       |
| -------------- | --------------------------- |
| Build command  | `pnpm build`                |
| Deploy command | `pnpm exec wrangler deploy` |

Both options read the Node version from `.node-version` and pnpm from `package.json`.

### Smoke tests

`pnpm smoke` starts `wrangler dev` with the built output and checks the main pages, feeds, sitemap, OG images, and the bilingual 404 pages. Pass a URL to test a deployment instead:

```sh
pnpm build && pnpm smoke
pnpm smoke https://akcstudio-grimorio.akobashikawa.workers.dev
```

The quality-check workflow runs the local variant on every push and pull request, and the deploy workflow runs it against production after each deploy.

### Accessibility checks

`tests/a11y.spec.ts` runs axe on the main pages in both languages and on the two 404 pages, covering WCAG 2.0/2.1 A and AA plus best practices. `pnpm test:a11y` runs only those checks; they are also part of `pnpm test:e2e` and CI.

### 404 page

Unknown URLs return `404.html` with a 404 status thanks to `assets.not_found_handling: "404-page"` in `wrangler.jsonc`; without that setting the Worker answers with an empty body. Because Workers looks for a literal `404.html`, the `localized-404` integration in `astro.config.mjs` also writes `es/404.html` (a copy of `es/404/index.html`), so misses under `/es/` stay in Spanish.

### Other hosts

Because the output is static, you can still upload `dist/client/` to Netlify, Vercel, GitHub Pages, or a plain bucket. If you never deploy to Cloudflare, you can remove the adapter and `wrangler.jsonc`.

### Cloudflare binding types

`worker-configuration.d.ts` contains the generated types for the bindings in `wrangler.jsonc`. Regenerate it after changing the Wrangler config:

```sh
pnpm generate-types
```

## Dependency updates

`.github/dependabot.yml` opens grouped pull requests every Monday:

| Group               | Packages                                            |
| ------------------- | --------------------------------------------------- |
| `astro`             | `astro`, `@astrojs/*`, `unifont`                    |
| `cloudflare`        | `wrangler`, `@cloudflare/*`, `miniflare`, `workerd` |
| `vite-and-tailwind` | `vite`, `tailwindcss`, `@tailwindcss/*`             |
| `minor-and-patch`   | everything else, minor and patch releases           |

A grouped PR carries a single lockfile change, so the coupled packages (Astro with its adapter and renderer, Tailwind with its Vite plugin) move together. Major bumps outside those groups arrive as individual PRs. GitHub Actions updates are grouped separately and run monthly.

Dependabot only proposes versions that are at least three days old (its release cooldown), and it runs pnpm with `--config.minimum-release-age=4320`. If the lockfile already pins something younger than that, the update job fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for every dependency. That is not a configuration error: wait until the package is three days old and re-run the job from **Insights → Dependency graph → Dependabot → Check for updates**.

Every PR runs the quality-check workflow (type-check, post pairing, `pnpm audit --audit-level=high`, build, smoke test, browser tests, and axe accessibility checks), which is also what keeps the lockfile free of known vulnerabilities.

## Credits

Grimorio is based on [Kanade-Astro](https://github.com/sudoriaa/Kanade-Astro) by sudoriaa, reworked and extended (design, i18n defaults, content, and features).

IBM Plex Sans and IBM Plex Mono are used under the SIL Open Font License; the license texts live in `public/fonts/licenses/`.

The example post images are photos from [Unsplash](https://unsplash.com) (via Lorem Picsum), free to use under the Unsplash License. Replace them with your own in `public/covers/`.

## License

[MIT](./LICENSE).
