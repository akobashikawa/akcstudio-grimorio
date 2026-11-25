import { expect, test, type Page } from "@playwright/test";

const OWNER = "akobashikawa";
const REPO = "akcstudio-grimorio";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, OPTIONS",
  "access-control-allow-headers":
    "authorization, x-github-api-version, content-type, accept",
  "access-control-expose-headers": "github-authentication-token-expiration",
};
const jsonResponse = (
  body: unknown,
  extra: Record<string, string> = {},
  status = 200,
) => ({
  status,
  headers: { ...CORS, "content-type": "application/json", ...extra },
  body: JSON.stringify(body),
});

test("Admin shows the login view and is not indexed", async ({ page }) => {
  await page.goto("/admin/");

  await expect(
    page.getByRole("heading", { name: "Edit posts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect with GitHub", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("GitHub token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save token" })).toBeVisible();

  const tokenLink = page.getByRole("link", {
    name: /Open the token creation page/,
  });
  await expect(tokenLink).toHaveAttribute(
    "href",
    /github\.com\/settings\/personal-access-tokens\/new/,
  );
  await expect(tokenLink).toHaveAttribute("href", /contents=write/);
  await expect(tokenLink).toHaveAttribute("href", /target_name=akobashikawa/);

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("Admin is blocked in robots.txt", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(await response.text()).toContain("Disallow: /admin/");
});

test("Admin rejects a token that cannot write", async ({ page }) => {
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      // The user has push access; only the token's write scope is missing.
      return route.fulfill(jsonResponse({ permissions: { push: true } }));
    }
    if (url.pathname === "/user") {
      return route.fulfill(jsonResponse({ login: "reader" }));
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/repos/${OWNER}/${REPO}/git/blobs`
    ) {
      return route.fulfill(
        jsonResponse(
          { message: "Resource not accessible by personal access token" },
          {},
          403,
        ),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await page.goto("/admin/");
  await page.getByLabel("GitHub token").fill("read-only-token");
  await page.getByRole("button", { name: "Save token" }).click();

  await expect(page.getByRole("alert")).toContainText(/write check/i);
  await expect(page.getByRole("alert")).toContainText(
    /Contents: Read and write/,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("grimorio.github.token")),
  ).toBeNull();
});

test("Admin accepts a write-capable token and caches the write check", async ({
  page,
}) => {
  let blobCalls = 0;
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return route.fulfill(
        jsonResponse(
          { permissions: { push: true } },
          {
            "github-authentication-token-expiration": "2027-01-01 00:00:00 UTC",
          },
        ),
      );
    }
    if (url.pathname === "/user") {
      return route.fulfill(jsonResponse({ login: "tester" }));
    }
    if (
      request.method() === "POST" &&
      url.pathname === `/repos/${OWNER}/${REPO}/git/blobs`
    ) {
      blobCalls += 1;
      return route.fulfill(jsonResponse({ sha: "blob" }, {}, 201));
    }
    if (
      url.pathname ===
        `/repos/${OWNER}/${REPO}/contents/src/content/posts/en` ||
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await page.goto("/admin/");
  await page.getByLabel("GitHub token").fill("write-token");
  await page.getByRole("button", { name: "Save token" }).click();

  await expect(page.getByText("@tester")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("grimorio.github.token")),
  ).toBe("write-token");
  expect(
    await page.evaluate(() =>
      localStorage.getItem("grimorio.github.writeVerified"),
    ),
  ).toBe("1");
  expect(blobCalls).toBe(1);

  await page.reload();
  await expect(page.getByText("@tester")).toBeVisible();
  expect(blobCalls).toBe(1);
});

test("New post creates one file in the chosen language", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.github.token", "write-token");
    localStorage.setItem("grimorio.github.user", "tester");
    localStorage.setItem("grimorio.github.writeVerified", "1");
  });

  const contents = `/repos/${OWNER}/${REPO}/contents/src/content/posts`;
  const puts: {
    lang: string;
    slug: string;
    body: Record<string, unknown>;
  }[] = [];

  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return route.fulfill(jsonResponse({ permissions: { push: true } }));
    }
    if (url.pathname === "/user") {
      return route.fulfill(jsonResponse({ login: "tester" }));
    }
    if (
      url.pathname === `${contents}/en` ||
      url.pathname === `${contents}/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (
      request.method() === "GET" &&
      /\/contents\/src\/content\/posts\/(en|es)\/[^/]+$/.test(url.pathname)
    ) {
      return route.fulfill({ status: 404, headers: CORS, body: "{}" });
    }
    if (request.method() === "PUT" && url.pathname.startsWith(`${contents}/`)) {
      const parts = url.pathname.split("/");
      const slug = (parts.pop() ?? "").replace(/\.md$/, "");
      const lang = parts.pop() ?? "";
      puts.push({
        lang,
        slug,
        body: JSON.parse(request.postData() ?? "{}") as Record<string, unknown>,
      });
      return route.fulfill(
        jsonResponse(
          { content: { sha: "file-sha" }, commit: { sha: "commit-sha" } },
          {},
          201,
        ),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page.getByRole("button", { name: "Spanish", exact: true }).click();
  await page.getByRole("button", { name: "New post", exact: true }).click();
  await expect(page.getByLabel("Language")).toHaveValue("es");
  await page.getByRole("button", { name: /Back to posts/ }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "New post", exact: true }).click();

  await expect(page.getByLabel("Language")).toHaveValue("en");
  await page.getByLabel("Title").fill("Canción de otoño");
  await page.getByRole("button", { name: "Generate from title" }).click();
  await expect(page.getByLabel("Slug")).toHaveValue("cancion-de-otono");
  await page.getByLabel("Description").fill("Una canción de otoño.");
  await page.getByLabel("Body", { exact: true }).fill("Cuerpo de prueba.");

  await page.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Created posts/en/cancion-de-otono.md.",
  );
  await expect(
    page.getByRole("heading", { name: "Posts", exact: true }),
  ).toBeVisible();

  expect(puts).toHaveLength(1);
  expect(puts[0].lang).toBe("en");
  expect(puts[0].slug).toBe("cancion-de-otono");
  expect(puts[0].body.message).toBe("cms: create posts/en/cancion-de-otono.md");
  const markdown = Buffer.from(String(puts[0].body.content), "base64").toString(
    "utf8",
  );
  expect(markdown).toContain('title: "Canción de otoño"');
  expect(markdown).toContain('lang: "en"');
  expect(markdown).toContain("draft: true");
  expect(markdown).toContain("Cuerpo de prueba.");
});

test("Admin prefills a translation from the query", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.github.token", "write-token");
    localStorage.setItem("grimorio.github.user", "tester");
    localStorage.setItem("grimorio.github.writeVerified", "1");
  });

  const contents = `/repos/${OWNER}/${REPO}/contents/src/content/posts`;
  const source = [
    "---",
    'title: "Welcome"',
    'description: "English description"',
    "date: 2026-01-02",
    "lang: en",
    "category: notes",
    'tags: ["Astro"]',
    "featured: true",
    "draft: false",
    "---",
    "",
    "English body.",
    "",
  ].join("\n");

  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (url.pathname === `/repos/${OWNER}/${REPO}`) {
      return route.fulfill(jsonResponse({ permissions: { push: true } }));
    }
    if (url.pathname === "/user") {
      return route.fulfill(jsonResponse({ login: "tester" }));
    }
    if (
      url.pathname === `${contents}/en` ||
      url.pathname === `${contents}/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === `${contents}/en/welcome.md`) {
      return route.fulfill(
        jsonResponse({
          type: "file",
          name: "welcome.md",
          path: "src/content/posts/en/welcome.md",
          sha: "source-sha",
          content: Buffer.from(source, "utf8").toString("base64"),
          encoding: "base64",
        }),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });

  await page.goto("/admin/?new=1&lang=es&fromLang=en&fromSlug=welcome");

  await expect(
    page.getByRole("heading", { name: "New post", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Language")).toHaveValue("es");
  await expect(page.getByLabel("Slug")).toHaveValue("welcome");
  await expect(page.getByLabel("Title")).toHaveValue("Welcome");
  await expect(page.getByLabel("Description")).toHaveValue(
    "English description",
  );
  await expect(page.getByLabel("Tags")).toHaveValue("Astro");
  await expect(page.getByLabel("Featured")).toBeChecked();
  await expect(page.getByLabel("Draft (hidden from the site)")).toBeChecked();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue(
    /English body\./,
  );
});

test("404 hides the missing-post shortcut without a token", async ({
  page,
}) => {
  const html = await missingTranslation404(page);
  await page.route("**/es/posts/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: html }),
  );

  await page.goto("/es/posts/only-in-english/");
  await expect(page.locator("#missing-post-link")).toBeHidden();
});

test("404 offers the missing translation when a token is stored", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.github.token", "write-token");
  });

  const html = await missingTranslation404(page);
  await page.route("**/es/posts/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: html }),
  );

  await page.goto("/es/posts/only-in-english/");
  const link = page.locator("#missing-post-link");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute(
    "href",
    "/admin/?new=1&lang=es&fromLang=en&fromSlug=only-in-english",
  );
  await expect(link).toContainText("Crearlo en este idioma");
});

async function missingTranslation404(page: Page): Promise<string> {
  const response = await page.request.get("/es/404.html");
  const html = await response.text();
  const patched = html.replace(
    /<script[^>]*id="missing-post-index"[^>]*>[\s\S]*?<\/script>/,
    '<script type="application/json" id="missing-post-index">{"en":["only-in-english"],"es":[]}</script>',
  );
  expect(patched).toContain("only-in-english");
  return patched;
}
