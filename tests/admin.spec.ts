import { expect, test } from "@playwright/test";

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
