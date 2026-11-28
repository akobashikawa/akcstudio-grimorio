import { test, expect } from "@playwright/test";
import { languages, ogLocales, translate, useTranslations } from "../src/i18n";
import settings from "../src/site.config.json" with { type: "json" };
import { busiestMonth, countBy, PAGE_SIZE, publishedPosts } from "./posts";

const language = "en";
const t = useTranslations(language);
const posts = publishedPosts(language);
const writingWithMarkdown = posts.find(
  (post) => post.slug === "writing-with-markdown",
)!;
const welcomePost = posts.find((post) => post.slug === "welcome")!;
const cmsPost = posts.find(
  (post) =>
    post.slug ===
    "como-desplegar-pagescms-selfhosted-gratis-vercel-neon-github",
)!;
// Fixed pages that the sitemap lists for each language: home, about, posts,
// and projects. Post pages are added on top of these.
const SITEMAP_PAGES_PER_LANGUAGE = 4;

test("Home categories and URL state after reload", async ({ page }) => {
  const categoryCounts = countBy(posts, (post) => post.category);
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator(".post-card")).toHaveCount(
    Math.min(posts.length, PAGE_SIZE),
  );
  for (const category of ["guides", "notes", "stories"] as const) {
    await page
      .getByRole("button", { name: t(`category.${category}`), exact: true })
      .click();
    const expected = categoryCounts[category] ?? 0;
    await expect(page.locator(".post-card")).toHaveCount(expected);
    await expect(
      page.locator(`.post-card:not([data-category="${category}"])`),
    ).toHaveCount(0);
  }
  await expect(page).toHaveURL(/category=stories/);
  await page.reload();
  const stories = categoryCounts.stories ?? 0;
  await expect(page.locator(".post-card")).toHaveCount(stories);
  await expect(page.locator('.post-card[data-category="stories"]')).toHaveCount(
    stories,
  );
});

test("Tags, month archives, and an unknown category", async ({ page }) => {
  const tag = "Markdown";
  const tagCount = posts.filter((post) => post.tags.includes(tag)).length;
  const { month, count: monthCount } = busiestMonth(posts);
  await page.goto(`/posts/?tag=${tag}`);
  await expect(page.locator(".post-card")).toHaveCount(tagCount);
  await page.goto(`/posts/?month=${month}`);
  // A busy month can exceed one page; page 1 shows at most PAGE_SIZE cards.
  await expect(page.locator(".post-card")).toHaveCount(
    Math.min(monthCount, PAGE_SIZE),
  );
  await expect(page.locator(".filter-summary")).toContainText(month);
  await page.goto("/posts/?category=missing&page=-5");
  await expect(page.getByText(t("post.emptyTitle"))).toBeVisible();
  await page.getByRole("button", { name: t("post.viewAll") }).click();
  await expect(page.locator(".post-card")).toHaveCount(
    Math.min(posts.length, PAGE_SIZE),
  );
});

test("Search, empty results, and focus restoration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const opener = page.getByRole("button", {
    name: t("nav.search"),
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page
    .getByRole("searchbox", { name: t("search.keywords") })
    .fill("Markdown");
  await expect(dialog.locator(".search-result")).toHaveCount(1);
  await page
    .getByRole("searchbox", { name: t("search.keywords") })
    .fill("no-such-post-9876");
  await expect(dialog.getByText(t("search.emptyTitle"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page
    .getByRole("searchbox", { name: t("search.keywords") })
    .fill("Markdown");
  await dialog.locator(".search-result").click();
  await expect(page).toHaveURL(/writing-with-markdown/);
  await expect(page.locator("#article-body")).toBeVisible();
});

test("Theme persistence across reloads and pages", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: t("nav.dark") }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("filter", "none");
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.goto("/about/");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: t("nav.light") }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("Blocked storage: themes still switch without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(Storage.prototype, "getItem", {
      value: () => {
        throw new Error("Storage blocked");
      },
    });
    Object.defineProperty(Storage.prototype, "setItem", {
      value: () => {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: t("nav.dark") }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(errors).toEqual([]);
});

test("Article contents, code blocks, and adjacent posts", async ({
  page,
  isMobile,
}) => {
  await page.goto(`/posts/${writingWithMarkdown.slug}/`);
  await expect(page.locator(".article-header h1")).toContainText("Markdown");
  await expect(page.locator("#article-body h2")).toHaveCount(
    writingWithMarkdown.headings,
  );
  await expect(page.locator("#article-body table")).toHaveCount(1);
  await expect(page.locator(".copy-code")).toHaveCount(
    writingWithMarkdown.codeBlocks,
  );
  if (isMobile) {
    await page.locator(".mobile-toc summary").click();
    await page.locator(".mobile-toc a").last().click();
  } else {
    await page.locator(".toc a").last().click();
  }
  await expect(page).toHaveURL(/#/);
  await expect(page.locator("#reading-progress")).not.toHaveAttribute(
    "style",
    "width: 0%;",
  );
  const writingIndex = posts.findIndex(
    (post) => post.slug === writingWithMarkdown.slug,
  );
  const adjacent = posts[writingIndex - 1];
  await page.locator(".adjacent-posts a").click();
  await expect(page).toHaveURL(new RegExp(`/posts/${adjacent.slug}/$`));
});

test("Mermaid diagrams render, toggle their source, and follow the theme", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/posts/${cmsPost.slug}/`);
  await expect(
    page.locator('figure[data-mermaid-state="rendered"]'),
  ).toHaveCount(cmsPost.diagrams, { timeout: 15_000 });
  // The fenced source stays hidden until the toggle reveals it.
  const sources = page.locator("pre code.language-mermaid");
  await expect(sources).toHaveCount(cmsPost.diagrams);
  for (let i = 0; i < cmsPost.diagrams; i += 1) {
    await expect(sources.nth(i)).toBeHidden();
  }
  const toggle = page.locator(".mermaid-source-toggle").first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.locator("pre code.language-mermaid").first()).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("button", { name: t("article.diagramSourceHide") })
    .click();
  await expect(page.locator("pre code.language-mermaid").first()).toBeHidden();
  // Diagrams get no copy button; plain code blocks keep theirs.
  await expect(
    page.locator("pre:has(code.language-mermaid) .copy-code"),
  ).toHaveCount(0);
  await expect(page.locator(".copy-code")).toHaveCount(cmsPost.codeBlocks);
  // The frame is re-derived from the content: the bbox must sit inside the
  // viewBox with the 8px padding (Mermaid's own viewBox is not trusted).
  const framed = await page
    .locator(".mermaid-canvas svg")
    .first()
    .evaluate((svg) => {
      const svgEl = svg as unknown as SVGSVGElement;
      const box = svgEl.getBBox();
      const viewBox = svgEl.viewBox.baseVal;
      return {
        inside:
          box.x >= viewBox.x &&
          box.y >= viewBox.y &&
          box.x + box.width <= viewBox.x + viewBox.width &&
          box.y + box.height <= viewBox.y + viewBox.height,
        padding:
          Math.abs(box.x - viewBox.x - 8) < 1 &&
          Math.abs(box.y - viewBox.y - 8) < 1,
      };
    });
  expect(framed.inside).toBe(true);
  expect(framed.padding).toBe(true);
  // Labels are SVG text: Mermaid's HTML-in-foreignObject measurement
  // produces huge broken layouts on Windows Chromium.
  await expect(
    page.locator("figure .mermaid-canvas foreignObject"),
  ).toHaveCount(0);
  // Diagrams render at natural size: the wide flowchart scrolls inside its
  // canvas at 1:1 scale instead of shrinking its text.
  const canvas = page.locator(".mermaid-canvas").first();
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const svg = node.querySelector("svg")!;
        return {
          natural:
            Math.abs(
              parseFloat(svg.getAttribute("width") ?? "0") -
                svg.viewBox.baseVal.width,
            ) < 1,
          scrollable: node.scrollWidth > node.clientWidth,
        };
      }),
    )
    .toEqual({ natural: true, scrollable: true });
  // The corrected flowchart contains every edge again.
  const svg = page
    .locator('figure[data-mermaid-state="rendered"]')
    .first()
    .locator("svg");
  for (const edge of ["1. HTTPS", "3. Read/encrypt tokens", "6. Push event"]) {
    await expect(svg).toContainText(edge);
  }
  // Switching theme re-renders both diagrams.
  await page.getByRole("button", { name: t("nav.dark") }).click();
  await expect(page.locator('figure[data-mermaid-theme="dark"]')).toHaveCount(
    cmsPost.diagrams,
    { timeout: 15_000 },
  );
  await expect(
    page.locator('figure[data-mermaid-state="rendered"] svg'),
  ).toHaveCount(cmsPost.diagrams);
  expect(errors).toEqual([]);
});

test("The admin sequence diagram exposes an accessible name", async ({
  page,
}) => {
  await page.goto("/es/posts/como-construimos-admin-de-pat-a-github-app/");
  const svg = page
    .locator("#article-body figure[data-mermaid-state='rendered'] svg")
    .first();
  await expect(svg).toBeVisible({ timeout: 15_000 });
  await expect(svg.locator("title")).toHaveText(
    "Autenticación de /admin/ con la GitHub App",
    { timeout: 15_000 },
  );
});

test("An implausible Mermaid layout falls back to the source", async ({
  page,
}) => {
  // Simulate a browser whose label measurement breaks (Windows Chromium):
  // the fake engine always returns a diagram with 20000x20000 of content.
  await page.route("**/mermaid.core.*.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: [
        "export default {",
        "  initialize() {},",
        "  render: async () => ({",
        '    svg: \'<svg viewBox="0 0 20000 20000" width="20000" height="20000"><rect width="20000" height="20000"/></svg>\',',
        "    bindFunctions: () => {},",
        "  }),",
        "};",
      ].join("\n"),
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/posts/${cmsPost.slug}/`);
  await expect(page.locator('figure[data-mermaid-state="error"]')).toHaveCount(
    cmsPost.diagrams,
    { timeout: 15_000 },
  );
  await expect(page.locator(".mermaid-error")).toHaveCount(cmsPost.diagrams);
  await expect(page.locator(".mermaid-error").first()).toHaveAttribute(
    "role",
    "status",
  );
  // No giant canvas is inserted and the fenced source stays visible.
  await expect(page.locator(".mermaid-canvas svg")).toHaveCount(0);
  await expect(page.locator("pre code.language-mermaid").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("Diagram canvases pan by dragging", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/posts/${cmsPost.slug}/`);
  await expect(
    page.locator('figure[data-mermaid-state="rendered"]'),
  ).toHaveCount(cmsPost.diagrams, { timeout: 15_000 });
  const canvases = page.locator(".mermaid-canvas");
  for (let i = 0; i < cmsPost.diagrams; i += 1) {
    await expect(canvases.nth(i)).toHaveAttribute("data-scrollable", "true");
    await expect(canvases.nth(i)).toHaveAttribute("tabindex", "0");
  }
  await expect(canvases.first()).toHaveAttribute("role", "region");
  await expect(canvases.first()).toHaveAttribute(
    "aria-label",
    t("article.diagramLabel"),
  );
  await expect(canvases.first()).toHaveCSS("touch-action", "pan-y");
  await expect(canvases.first()).toHaveCSS("cursor", "grab");

  const canvas = canvases.first();
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await expect(canvas).toHaveClass(/is-panning/);
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(centerX - 300, centerY, { steps: 8 });
  await page.mouse.up();
  await expect(canvas).not.toHaveClass(/is-panning/);
  const scroll = await canvas.evaluate((node) => ({
    left: node.scrollLeft,
    max: node.scrollWidth - node.clientWidth,
  }));
  expect(scroll.left).toBeGreaterThan(0);
  expect(scroll.left).toBeLessThanOrEqual(scroll.max);
  // The pan does not interfere with the source toggle.
  await expect(page.locator("pre code.language-mermaid").first()).toBeHidden();
  expect(errors).toEqual([]);
});

test("Diagrams that fit do not pan; scrollable ones respond to keys", async ({
  page,
}) => {
  await page.goto("/posts/writing-with-markdown/");
  await expect(
    page.locator('figure[data-mermaid-state="rendered"]'),
  ).toHaveCount(writingWithMarkdown.diagrams, { timeout: 15_000 });
  const flowchart = page.locator(".mermaid-canvas").first();
  // Affordances match the actual overflow: on mobile the counter flowchart
  // overflows, on desktop it fits the column.
  const flowchartScrollable = await flowchart.evaluate(
    (node) => node.scrollWidth > node.clientWidth,
  );
  if (flowchartScrollable) {
    await expect(flowchart).toHaveAttribute("data-scrollable", "true");
    await expect(flowchart).toHaveAttribute("tabindex", "0");
  } else {
    await expect(flowchart).not.toHaveAttribute("data-scrollable");
    await expect(flowchart).not.toHaveAttribute("tabindex");
  }
  await flowchart.scrollIntoViewIfNeeded();
  const box = (await flowchart.boundingBox())!;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX - 200, centerY, { steps: 4 });
  await page.mouse.up();
  const dragged = await flowchart.evaluate((node) => node.scrollLeft);
  if (flowchartScrollable) {
    expect(dragged).toBeGreaterThan(0);
  } else {
    expect(dragged).toBe(0);
  }

  // The sequence diagram overflows: focus + arrow keys scroll it.
  const sequence = page.locator(".mermaid-canvas").nth(1);
  await expect(sequence).toHaveAttribute("data-scrollable", "true");
  await sequence.scrollIntoViewIfNeeded();
  await sequence.focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => sequence.evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(0);
});

test("A shifted viewBox is re-derived from the rendered content", async ({
  page,
}) => {
  // Simulate Windows Chromium: Mermaid computes the frame from the wrong
  // origin (viewBox at -93) while the content sits at 12,12, clipping the
  // right and bottom edges.
  await page.route("**/mermaid.core.*.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/javascript",
      body: [
        "export default {",
        "  initialize() {},",
        "  render: async () => ({",
        '    svg: \'<svg viewBox="-93 -93 391.9774169921875 663.4000244140625" width="391.9774169921875" height="663.4000244140625"><rect x="12" y="12" width="363.9774169921875" height="615.3999633789062"/></svg>\',',
        "    bindFunctions: () => {},",
        "  }),",
        "};",
      ].join("\n"),
    }),
  );
  await page.goto(`/posts/${cmsPost.slug}/`);
  await expect(
    page.locator('figure[data-mermaid-state="rendered"]'),
  ).toHaveCount(cmsPost.diagrams, { timeout: 15_000 });
  // The content is re-framed: viewBox, width and height come from the bbox
  // with 8px of padding, so nothing is clipped and no side is empty.
  const frames = await page.locator(".mermaid-canvas svg").evaluateAll((svgs) =>
    svgs.map((raw) => {
      const svg = raw as unknown as SVGSVGElement;
      const box = svg.getBBox();
      const viewBox = svg.viewBox.baseVal;
      return {
        viewBox: [viewBox.x, viewBox.y, viewBox.width, viewBox.height],
        contentInside:
          box.x >= viewBox.x &&
          box.y >= viewBox.y &&
          box.x + box.width <= viewBox.x + viewBox.width &&
          box.y + box.height <= viewBox.y + viewBox.height,
        paddingOk:
          Math.abs(box.x - viewBox.x - 8) < 1 &&
          Math.abs(box.y - viewBox.y - 8) < 1,
        width: Number(svg.getAttribute("width")),
        height: Number(svg.getAttribute("height")),
      };
    }),
  );
  for (const frame of frames) {
    expect(frame.contentInside).toBe(true);
    expect(frame.paddingOk).toBe(true);
    expect(frame.width).toBeCloseTo(frame.viewBox[2], 0);
    expect(frame.height).toBeCloseTo(frame.viewBox[3], 0);
  }
});

test("The Mermaid engine is not requested on pages without diagrams", async ({
  page,
}) => {
  const requests: string[] = [];
  // The dynamic import emits a ~5 KB facade chunk (the preload dep map) that
  // loads everywhere; the diagram engine must stay page-gated.
  const engine = /mermaid\.core|mermaid-parser|render-.*\.js/;
  page.on("request", (request) => {
    if (engine.test(request.url())) requests.push(request.url());
  });
  await page.goto("/posts/welcome/");
  await page.goto("/about/");
  expect(requests).toEqual([]);
});

test("Posts without an outline hide the table of contents", async ({
  page,
}) => {
  const withoutOutline = posts.find((post) => post.headings === 0)!;
  await page.goto(`/posts/${withoutOutline.slug}/`);
  await expect(page.locator(".toc")).toHaveCount(0);
  await expect(page.locator(".mobile-toc")).toHaveCount(0);

  await page.goto(`/posts/${writingWithMarkdown.slug}/`);
  await expect(page.locator(".toc")).toHaveCount(1);
  await expect(page.locator(".mobile-toc")).toHaveCount(1);
});

test("Page layouts, assets, and browser errors", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const path of [
    "/",
    "/posts/",
    "/projects/",
    "/about/",
    "/posts/writing-with-markdown/",
    `/posts/${cmsPost.slug}/`,
  ]) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    const size = await page.evaluate(() => ({
      width: innerWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(size.content, path).toBeLessThanOrEqual(size.width);
    await expect(page.locator("img")).not.toHaveCount(0);
    // Bring lazy images into view; hidden ones (e.g. mobile sidebar) never load.
    await page.evaluate(async () => {
      scrollTo(0, document.body.scrollHeight);
      await Promise.all(
        [...document.images]
          .filter((image) => image.getClientRects().length > 0)
          .map((image) => image.decode().catch(() => {})),
      );
      scrollTo(0, 0);
    });
    // Only check same-origin images: remote demo images may be unreachable in CI.
    const broken = await page.locator("img").evaluateAll((images) =>
      images
        .filter((image) => image.getClientRects().length > 0)
        .filter((image) => {
          try {
            return (
              new URL((image as HTMLImageElement).src, location.href).origin ===
              location.origin
            );
          } catch {
            return false;
          }
        })
        .filter(
          (image) =>
            !(image as HTMLImageElement).complete ||
            (image as HTMLImageElement).naturalWidth === 0,
        )
        .map((image) => image.getAttribute("src")),
    );
    expect(broken).toEqual([]);
  }
  if (isMobile) {
    await page.getByRole("button", { name: t("nav.openMenu") }).click();
    await expect(
      page.getByRole("navigation", { name: t("nav.main") }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: t("nav.main") })
      .getByRole("link", { name: t("nav.projects") })
      .click();
    await expect(page).toHaveURL(/projects/);
  }
  expect(errors).toEqual([]);
});

test("Sitemap, RSS, and 404", async ({ page, request }) => {
  const feed = await request.get("/rss.xml");
  expect(feed.status()).toBe(200);
  expect((await feed.text()).match(/<item>/g)).toHaveLength(posts.length);
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  expect(await (await request.get("/robots.txt")).text()).toContain("Sitemap:");
  const response = await page.goto("/a-page-that-does-not-exist/");
  expect(response?.status()).toBe(404);
  await expect(page.getByText(t("error.heading"))).toBeVisible();
});

test("SEO metadata, official sitemap, and RSS consistency", async ({
  page,
  request,
}) => {
  await page.goto(
    "/posts/writing-with-markdown/?tracking=example#article-body",
  );
  await expect(page.locator("h1")).toHaveCount(1);
  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute("href");
  expect(canonical).toMatch(/\/posts\/writing-with-markdown\/$/);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    canonical!,
  );
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "article",
  );
  await expect(
    page.locator('meta[property="article:published_time"]'),
  ).toHaveAttribute("content", "2026-01-20T00:00:00.000Z");
  const sitemap = await request.get("/sitemap-0.xml");
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  const locations = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    if (doc.querySelector("parsererror"))
      throw new Error("Invalid sitemap XML");
    return [...doc.querySelectorAll("url > loc")].map(
      (entry) => entry.textContent!,
    );
  }, xml);
  expect(locations).toHaveLength(
    languages.reduce(
      (total, lang) =>
        total + SITEMAP_PAGES_PER_LANGUAGE + publishedPosts(lang).length,
      0,
    ),
  );
  expect(locations).toContain(canonical);
  expect(
    locations.some((url) => /\/404(?:\/|\.|$)/.test(new URL(url).pathname)),
  ).toBe(false);
  for (const url of locations) {
    expect(new URL(url).origin).toBe(new URL(canonical!).origin);
    expect((await request.get(new URL(url).pathname)).status()).toBe(200);
  }
  expect((await request.get("/sitemap-index.xml")).status()).toBe(200);
  const feed = await request.get("/rss.xml");
  const feedInfo = await page.evaluate(
    (source) => {
      const doc = new DOMParser().parseFromString(source, "application/xml");
      return {
        errors: doc.querySelectorAll("parsererror").length,
        links: [...doc.querySelectorAll("item > link")].map(
          (link) => link.textContent!,
        ),
      };
    },
    await feed.text(),
  );
  expect(feedInfo.errors).toBe(0);
  expect(feedInfo.links).toHaveLength(posts.length);
  await page.goto("/a-page-that-does-not-exist/");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
});

test("Dark theme keeps full contrast", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: t("nav.dark") }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.locator("html")).toHaveCSS("opacity", "1");
  await expect(page.locator("body")).toHaveCSS("color", "rgb(220, 223, 227)");
});

test("Reading all posts without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    baseURL,
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    const fallback = page.getByRole("region", {
      name: t("post.all"),
      exact: true,
    });
    await expect(fallback.getByRole("link")).toHaveCount(posts.length);
    await fallback.getByRole("link").last().click();
    await expect(page.locator("#article-body")).toBeVisible();
    // Mermaid diagrams keep their fenced source without JavaScript.
    await page.goto(`/posts/${cmsPost.slug}/`);
    await expect(
      page.locator("pre code.language-mermaid").first(),
    ).toBeVisible();
    await expect(page.locator("figure.mermaid-diagram")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("Configured language, localized search, metadata, and local fonts", async ({
  page,
  request,
}) => {
  const fonts: string[] = [];
  const hydrationWarnings: string[] = [];
  page.on("response", (response) => {
    if (/\.woff2(?:\?|$)/.test(response.url()) && response.ok())
      fonts.push(response.url());
  });
  page.on("console", (message) => {
    if (/hydration.*mismatch/i.test(message.text()))
      hydrationWarnings.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page).toHaveTitle(
    `${settings.site.name} · ${t("site.titleSuffix")}`,
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    ogLocales[language],
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    t("site.description"),
  );
  await expect(page.locator("h1")).toHaveText(t("hero.title"));
  expect(await page.locator("body").innerText()).not.toMatch(/\p{Script=Han}/u);

  await page
    .getByRole("button", { name: t("nav.search"), exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: t("search.keywords") })
    .fill("emphasis");
  await expect(page.getByRole("dialog").locator(".search-result")).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");

  await page.evaluate(() => document.fonts.ready);
  const family = "IBM Plex Sans Variable";
  const loaded = await page.evaluate(() =>
    [...document.fonts]
      .filter((face) => face.status === "loaded")
      .map((face) => face.family.replaceAll('"', "")),
  );
  expect(loaded).toContain(family);
  expect(fonts.length).toBeGreaterThan(0);
  expect(
    fonts.every((url) => new URL(url).origin === new URL(page.url()).origin),
  ).toBe(true);
  await page.goto(`/posts/${writingWithMarkdown.slug}/`);
  await expect(page.locator("#article-body h2").first()).toHaveCSS(
    "font-family",
    new RegExp(family),
  );

  const rss = await (await request.get("/rss.xml")).text();
  const feedInfo = await page.evaluate((source) => {
    const xml = new DOMParser().parseFromString(source, "application/xml");
    return {
      language: xml.querySelector("channel > language")?.textContent,
      title: xml.querySelector("item > title")?.textContent,
      link: xml.querySelector("item > link")?.textContent,
    };
  }, rss);
  expect(feedInfo.language).toBe(language);
  await page.goto(new URL(feedInfo.link!).pathname);
  await expect(page.locator(".article-header h1")).toHaveText(feedInfo.title!);
  expect(hydrationWarnings).toEqual([]);
});

test("Spanish routes and the language switch", async ({ page, request }) => {
  const es = (key: Parameters<typeof t>[0]) => translate("es", key);
  await page.goto("/posts/welcome/");
  await expect(
    page.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", /\/posts\/welcome\/$/);
  await expect(
    page.locator('link[rel="alternate"][hreflang="es"]'),
  ).toHaveAttribute("href", /\/es\/posts\/welcome\/$/);
  await expect(
    page.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", /\/posts\/welcome\/$/);
  const switchToSpanish = page.getByRole("link", { name: t("nav.language") });
  await expect(switchToSpanish).toHaveAttribute("href", "/es/posts/welcome/");
  await switchToSpanish.click();
  await expect(page).toHaveURL(/\/es\/posts\/welcome\/$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.locator(".article-header h1")).toContainText("Bienvenido");
  await expect(
    page.locator('link[rel="alternate"][hreflang="en"]'),
  ).toHaveAttribute("href", /\/posts\/welcome\/$/);
  await expect(
    page.locator('link[rel="alternate"][hreflang="es"]'),
  ).toHaveAttribute("href", /\/es\/posts\/welcome\/$/);
  await expect(
    page.locator('link[rel="alternate"][hreflang="x-default"]'),
  ).toHaveAttribute("href", /\/posts\/welcome\/$/);
  await page.getByRole("link", { name: es("article.back") }).click();
  await expect(page).toHaveURL(/\/es\/posts\/$/);
  await expect(page.locator(".post-feed")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const newestSpanish = publishedPosts("es")[0];
  await expect(page.locator(".post-card").first()).toContainText(
    es(`category.${newestSpanish.category}` as Parameters<typeof t>[0]),
  );
  await page.getByRole("link", { name: es("nav.language") }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const feed = await (await request.get("/es/rss.xml")).text();
  expect(feed).toContain("<language>es</language>");
  expect(feed).toContain("/es/posts/welcome/");
});

test("Structured data and translated sitemap entries", async ({
  page,
  request,
}) => {
  await page.goto(`/posts/${welcomePost.slug}/`);
  const { "@graph": graph } = JSON.parse(
    (await page
      .locator('script[type="application/ld+json"]')
      .textContent()) as string,
  );
  const byType = (type: string) =>
    graph.find((item: { "@type": string }) => item["@type"] === type);
  const post = byType("BlogPosting");
  const welcomeDate = `${welcomePost.date}T00:00:00.000Z`;
  expect(post.headline).toBe(welcomePost.title);
  expect(post.datePublished).toBe(welcomeDate);
  expect(post.dateModified).toBe(welcomeDate);
  expect(post.inLanguage).toBe("en");
  expect(post.image.width).toBe(1200);
  expect(post.author["@id"]).toBe(byType("Person")["@id"]);
  expect(byType("Person").jobTitle).toBe("Notes & learnings");
  expect(byType("WebSite").alternateName).toBeTruthy();
  expect(byType("BreadcrumbList").itemListElement).toHaveLength(3);
  await expect(
    page.locator('meta[property="og:locale:alternate"]'),
  ).toHaveAttribute("content", "es_ES");
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  const image = await request.get(
    new URL(
      (await page
        .locator('meta[property="og:image"]')
        .getAttribute("content")) as string,
    ).pathname,
  );
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toContain("image/png");

  const sitemap = await (await request.get("/sitemap-0.xml")).text();
  expect(sitemap).toContain('hreflang="es-ES"');
  expect(sitemap).toContain("/es/posts/welcome/");
  expect(sitemap).toContain(`<lastmod>${welcomeDate}</lastmod>`);
  const feed = await (await request.get("/rss.xml")).text();
  expect(feed).toContain("<content:encoded>");
  expect(feed).toContain('rel="self"');
  const llms = await (await request.get("/llms.txt")).text();
  expect(llms).toContain("/es/posts/welcome/");
});

test("Profile page and unique descriptions", async ({ page }) => {
  await page.goto("/about/");
  const { "@graph": graph } = JSON.parse(
    (await page
      .locator('script[type="application/ld+json"]')
      .textContent()) as string,
  );
  const profile = graph.find(
    (item: { "@type": string }) => item["@type"] === "ProfilePage",
  );
  expect(profile.mainEntity["@id"]).toMatch(/#person$/);
  const descriptions = new Set<string | null>();
  for (const path of ["/", "/posts/", "/about/", "/projects/"]) {
    await page.goto(path);
    descriptions.add(
      await page.locator('meta[name="description"]').getAttribute("content"),
    );
  }
  expect(descriptions.size).toBe(4);
});
