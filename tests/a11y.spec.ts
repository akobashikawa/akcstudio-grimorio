import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const pages = [
  "/",
  "/posts/",
  "/posts/welcome/",
  "/about/",
  "/projects/",
  "/es/",
  "/es/posts/",
  "/es/posts/welcome/",
  "/a-page-that-does-not-exist/",
  "/es/a-page-that-no-existe/",
];

for (const path of pages) {
  test(`Accessibility: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    const summary = results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(" ")).slice(0, 3),
    }));
    expect(summary).toEqual([]);
  });
}
