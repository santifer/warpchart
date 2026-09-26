import { expect, test } from "@playwright/test";
import { brokenImages, horizontalOverflow, lowContrast } from "./sensors";

// The public surfaces a visitor lands on, each with a literal text that proves
// the real page rendered (not an error shell or an empty skeleton).
const PAGES: { path: string; expect: RegExp }[] = [
  { path: "/", expect: /warpchart/i },
  { path: "/r/career-ops-hq/career-ops", expect: /PR flow/i },
  { path: "/velocity", expect: /velocity|stars\/day/i },
  { path: "/pricing", expect: /pricing|plan/i },
  { path: "/methodology", expect: /methodology/i },
  { path: "/compare", expect: /compare/i },
];

for (const p of PAGES) {
  test(`${p.path} renders whole in the real client`, async ({ page }) => {
    // LiveProvider pages poll forever and never reach network idle
    const res = await page.goto(p.path, { waitUntil: "domcontentloaded" });
    expect(res?.status(), "HTTP status").toBeLessThan(400);
    await expect(page.locator("body")).toContainText(p.expect, { timeout: 30_000 });
    await page.waitForTimeout(3_000); // let above-the-fold images settle
    expect(await brokenImages(page), "broken images").toEqual([]);
    expect(await horizontalOverflow(page), "horizontal overflow").toEqual([]);
    const contrast = await lowContrast(page);
    expect(contrast.issues, "text below WCAG AA contrast").toEqual([]);
    // a sensor that measures nothing is not a green light
    if (contrast.candidates >= 10) {
      expect(contrast.measured, `contrast sensor measured ${contrast.measured}/${contrast.candidates}`).toBeGreaterThanOrEqual(
        Math.ceil(contrast.candidates * 0.5),
      );
    }
  });
}
