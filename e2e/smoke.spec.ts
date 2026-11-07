import { expect, test } from "@playwright/test";
import { PAGES } from "./pages";
import { brokenImages, horizontalOverflow, lowContrast, visibleText } from "./sensors";

for (const p of PAGES) {
  test(`${p.path} renders whole in the real client`, async ({ page }) => {
    // LiveProvider pages poll forever and never reach network idle
    const res = await page.goto(p.path, { waitUntil: "domcontentloaded" });
    expect(res?.status(), "HTTP status").toBeLessThan(400);
    await expect.poll(() => visibleText(page), { message: "page-specific text", timeout: 30_000 }).toMatch(p.expect);
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
