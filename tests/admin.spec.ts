import { expect, test } from "@playwright/test";

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
