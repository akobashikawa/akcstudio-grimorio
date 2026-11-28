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

// SPEC 04: the browser asks /api/auth/session/ for a short-lived access
// token; `astro preview` serves no on-demand routes, so every admin test
// stubs this endpoint instead of hitting the Worker.
const SESSION_PAYLOAD = {
  token: "write-token",
  login: "tester",
  expiresAt: Date.now() + 60 * 60 * 1000,
  canWrite: true,
};

const stubSession = (page: Page, payload: unknown, status = 200): void => {
  page.route("**/api/auth/session/", (route) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    }),
  );
};

const stubPostListings = (page: Page): void => {
  page.route("https://api.github.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname ===
        `/repos/${OWNER}/${REPO}/contents/src/content/posts/en` ||
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
};

test("Admin shows the login card when unauthenticated", async ({ page }) => {
  stubSession(page, { error: "unauthenticated" }, 401);
  await page.goto("/admin/");

  await expect(
    page.getByRole("heading", { name: "Edit posts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Connect with GitHub", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();

  const loginLink = page.getByRole("link", {
    name: /Connect with GitHub/,
  });
  await expect(loginLink).toHaveAttribute(
    "href",
    /^\/api\/auth\/login\/\?next=%2Fadmin%2F$/,
  );

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
});

test("Admin is blocked in robots.txt", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(await response.text()).toContain("Disallow: /admin/");
});

test("Admin shows the permission error when the session cannot write", async ({
  page,
}) => {
  stubSession(page, {
    token: "read-token",
    login: "reader",
    expiresAt: Date.now() + 60 * 60 * 1000,
    canWrite: false,
  });
  await page.goto("/admin/");

  await expect(page.getByRole("alert")).toContainText(/write access/i);
  await expect(page.getByText("@reader")).toBeHidden();
});

test("Admin loads the list with a session and purges legacy keys", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.github.token", "legacy-token");
    localStorage.setItem("grimorio.github.writeVerified", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  stubPostListings(page);

  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("grimorio.admin")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("grimorio.github.token")),
  ).toBeNull();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("grimorio.github.writeVerified"),
    ),
  ).toBeNull();
});

test("New post creates one file in the chosen language", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);

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
  await expect(page.locator(".admin-success")).toContainText(
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
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);

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

test("404 hides the missing-post shortcut when not signed in", async ({
  page,
}) => {
  const html = await missingTranslation404(page);
  await page.route("**/es/posts/**", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: html }),
  );

  await page.goto("/es/posts/only-in-english/");
  await expect(page.locator("#missing-post-link")).toBeHidden();
});

test("404 offers the missing translation when signed in", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
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

const WELCOME_PATH = `/repos/${OWNER}/${REPO}/contents/src/content/posts/en/welcome.md`;
const WELCOME_MD = [
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

const fileResponse = (body: string = WELCOME_MD) =>
  jsonResponse({
    type: "file",
    name: "welcome.md",
    path: "src/content/posts/en/welcome.md",
    sha: "file-sha",
    content: Buffer.from(body, "utf8").toString("base64"),
    encoding: "base64",
  });

const welcomeListing = () =>
  jsonResponse([
    {
      type: "file",
      name: "welcome.md",
      path: "src/content/posts/en/welcome.md",
      sha: "listing-sha",
    },
  ]);

/** Stub session + listings so the list shows one post (en/welcome). */
async function openListWithWelcomePost(page: Page, fileBody = WELCOME_MD) {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  const deletes: Record<string, unknown>[] = [];
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      return route.fulfill(fileResponse(fileBody));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "DELETE") {
      deletes.push(
        JSON.parse(request.postData() ?? "{}") as Record<string, unknown>,
      );
      return route.fulfill(jsonResponse({ commit: { sha: "commit-sha" } }));
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();
  return { deletes };
}

test("List deletes a post after confirmation", async ({ page }) => {
  const { deletes } = await openListWithWelcomePost(page);

  await page.getByRole("button", { name: "Delete post en/welcome" }).click();
  await expect(page.getByText("src/content/posts/en/welcome.md")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.locator(".admin-success")).toContainText(
    "Deleted posts/en/welcome.md.",
  );
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(
    page.getByRole("heading", { name: "Posts", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Welcome", { exact: true })).toBeHidden();
  expect(deletes).toHaveLength(1);
  expect(deletes[0].sha).toBe("file-sha");
  expect(deletes[0].message).toBe("cms: delete posts/en/welcome.md");
  expect(deletes[0].branch).toBe("master");
});

test("Cancel keeps the post and sends no request", async ({ page }) => {
  const { deletes } = await openListWithWelcomePost(page);

  await page.getByRole("button", { name: "Delete post en/welcome" }).click();
  await expect(page.getByText("src/content/posts/en/welcome.md")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await expect(
    page.getByRole("button", { name: "Delete post en/welcome" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toBeHidden();
  expect(deletes).toHaveLength(0);
});

test("List treats a missing post as already deleted", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    let fileGets = 0;
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      // First GET loads the list; the sha GET before DELETE finds it gone.
      fileGets += 1;
      return fileGets === 1
        ? route.fulfill(fileResponse())
        : route.fulfill({ status: 404, headers: CORS, body: "{}" });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page.getByRole("button", { name: "Delete post en/welcome" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.getByRole("status")).toContainText(
    "posts/en/welcome.md was already deleted.",
  );
  await expect(page.getByRole("alert")).toBeHidden();
  await expect(page.getByText("Welcome", { exact: true })).toBeHidden();
});

test("Editor preview renders Mermaid diagrams and reports invalid syntax", async ({
  page,
}) => {
  const valid = [
    "",
    "```mermaid",
    "flowchart LR",
    "A[Start] --> B[End]",
    "```",
    "",
  ].join("\n");
  await openListWithWelcomePost(page, WELCOME_MD + valid);
  await page
    .getByRole("button", { name: /Welcome en\/welcome/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Preview" }).click();
  const figure = page.locator(".admin-preview figure.mermaid-diagram");
  await expect(figure).toHaveAttribute("data-mermaid-state", "rendered", {
    timeout: 15_000,
  });
  await expect(figure.locator("svg")).toHaveCount(1);
  await expect(figure.locator(".mermaid-source-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  // Invalid syntax keeps the source and shows a status notice.
  const invalid = '```mermaid\nflowchart LR\nA --> [|"unclosed\n```';
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByLabel("Body", { exact: true }).fill(invalid);
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(figure).toHaveAttribute("data-mermaid-state", "error", {
    timeout: 15_000,
  });
  await expect(figure.locator(".mermaid-error")).toHaveText(
    "This diagram could not be rendered.",
  );
  await expect(figure.locator(".mermaid-error")).toHaveAttribute(
    "role",
    "status",
  );
  await expect(
    page.locator(".admin-preview pre code.language-mermaid"),
  ).toBeVisible();
});

test("Editor deletes the post and returns to the list", async ({ page }) => {
  const { deletes } = await openListWithWelcomePost(page);

  await page
    .getByRole("button", { name: /Welcome en\/welcome/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit post", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Delete post", exact: true }).click();
  await expect(page.getByText("src/content/posts/en/welcome.md")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(page.locator(".admin-success")).toContainText(
    "Deleted posts/en/welcome.md.",
  );
  await expect(
    page.getByRole("heading", { name: "Posts", exact: true }),
  ).toBeVisible();
  expect(deletes).toHaveLength(1);
  expect(deletes[0].sha).toBe("file-sha");
});

test("List sends an expired session to the login card", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      return route.fulfill(fileResponse());
    }
    if (url.pathname === WELCOME_PATH && request.method() === "DELETE") {
      return route.fulfill({ status: 401, headers: CORS, body: "{}" });
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page.getByRole("button", { name: "Delete post en/welcome" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    page.getByRole("heading", { name: "Connect with GitHub", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("grimorio.admin")),
  ).toBeNull();
});

const deployRun = (over: Record<string, unknown> = {}) => ({
  path: ".github/workflows/deploy.yml",
  head_sha: "commit-sha",
  status: "queued",
  conclusion: null,
  html_url:
    "https://github.com/akobashikawa/akcstudio-grimorio/actions/runs/123",
  created_at: "2026-11-27T18:00:00Z",
  run_started_at: "2026-11-27T18:00:10Z",
  updated_at: "2026-11-27T18:00:30Z",
  ...over,
});

const actionsResponse = (runs: Record<string, unknown>[] | null) =>
  jsonResponse({ total_count: runs?.length ?? 0, workflow_runs: runs ?? [] });

test("Deploy indicator follows the workflow after a save", async ({ page }) => {
  // Advance the mocked clock instead of waiting for the real 10 s polling.
  await page.clock.install({ time: new Date("2026-11-27T18:00:00Z") });
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);

  // One state per poll: no run yet, queued, in progress, success.
  const states: (Record<string, unknown> | null)[] = [
    null,
    deployRun(),
    deployRun({ status: "in_progress", run_started_at: null }),
    deployRun({
      status: "completed",
      conclusion: "success",
      updated_at: "2026-11-27T18:02:30Z",
    }),
    deployRun({
      status: "completed",
      conclusion: "success",
      updated_at: "2026-11-27T18:02:30Z",
    }),
    deployRun({
      status: "completed",
      conclusion: "success",
      updated_at: "2026-11-27T18:02:30Z",
    }),
  ];
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      return route.fulfill(fileResponse());
    }
    if (url.pathname === WELCOME_PATH && request.method() === "PUT") {
      return route.fulfill(
        jsonResponse({
          content: { sha: "file-sha-2" },
          commit: { sha: "commit-sha" },
        }),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  // Registered after the api.github.com route: Playwright matches routes in
  // reverse registration order, so this one wins for /actions/runs.
  await page.route("**/actions/runs*", (route) => {
    const state = states.shift() ?? null;
    return route.fulfill(actionsResponse(state ? [state] : null));
  });

  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page
    .getByRole("button", { name: /Welcome en\/welcome/ })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Edit post", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.locator(".admin-deploy")).toContainText("Deploy queued");

  await page.clock.runFor(21_000);
  await expect(page.locator(".admin-deploy")).toContainText(
    /Deploying… \d+:\d\d/,
  );
  await expect(
    page.locator(".admin-deploy").getByRole("link", { name: /View run/ }),
  ).toHaveAttribute(
    "href",
    "https://github.com/akobashikawa/akcstudio-grimorio/actions/runs/123",
  );

  await page.clock.runFor(21_000);
  await expect(page.locator(".admin-deploy")).toContainText(/Live · \d+:\d\d/);
});

test("Deploy indicator reports a missing Actions permission", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-11-27T18:00:00Z") });
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      return route.fulfill(fileResponse());
    }
    if (url.pathname === WELCOME_PATH && request.method() === "PUT") {
      return route.fulfill(
        jsonResponse({
          content: { sha: "file-sha-2" },
          commit: { sha: "commit-sha" },
        }),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  // Registered after the api.github.com route (reverse registration order).
  await page.route("**/actions/runs*", (route) =>
    route.fulfill({ status: 403, headers: CORS, body: "{}" }),
  );

  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page
    .getByRole("button", { name: /Welcome en\/welcome/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.locator(".admin-deploy")).toContainText(
    "Deploy status unavailable",
  );
  // Editing keeps working with the stalled indicator.
  await expect(
    page.getByRole("heading", { name: "Edit post", exact: true }),
  ).toBeVisible();
});

test("Deploy indicator waits for the run to appear", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-27T18:00:00Z") });
  await page.addInitScript(() => {
    localStorage.setItem("grimorio.admin", "1");
  });
  stubSession(page, SESSION_PAYLOAD);
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS });
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/en`
    ) {
      return route.fulfill(welcomeListing());
    }
    if (
      url.pathname === `/repos/${OWNER}/${REPO}/contents/src/content/posts/es`
    ) {
      return route.fulfill(jsonResponse([]));
    }
    if (url.pathname === WELCOME_PATH && request.method() === "GET") {
      return route.fulfill(fileResponse());
    }
    if (url.pathname === WELCOME_PATH && request.method() === "PUT") {
      return route.fulfill(
        jsonResponse({
          content: { sha: "file-sha-2" },
          commit: { sha: "commit-sha" },
        }),
      );
    }
    return route.fulfill({ status: 404, headers: CORS, body: "{}" });
  });
  // Registered after the api.github.com route (reverse registration order).
  await page.route("**/actions/runs*", (route) =>
    route.fulfill(actionsResponse(null)),
  );

  await page.goto("/admin/");
  await expect(page.getByText("@tester")).toBeVisible();

  await page
    .getByRole("button", { name: /Welcome en\/welcome/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.locator(".admin-deploy")).toContainText("Deploy queued");
  await page.clock.runFor(2 * 60_000 + 21_000);

  await expect(page.locator(".admin-deploy")).toContainText(
    "Deploy not started yet",
  );
  await expect(
    page.locator(".admin-deploy").getByRole("link", { name: /View run/ }),
  ).toHaveAttribute(
    "href",
    "https://github.com/akobashikawa/akcstudio-grimorio/actions/workflows/deploy.yml",
  );
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
