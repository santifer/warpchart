import { expect, test } from "@playwright/test";
import { brokenImages, horizontalOverflow, lowContrast } from "./sensors";

// A sensor that has never fired proves nothing. This page is broken on
// purpose, in exactly the ways production once was, and every sensor must
// catch it. If this spec ever passes with empty findings, the smoke is blind.
const BROKEN = `<!doctype html><html><body style="margin:0;background:#0b1622">
  <img src="data:image/png;base64,AAAA" alt="avatar that failed to load">
  <div style="width:3000px;height:10px"></div>
  <p class="text-faint" style="color:#1e2a36;font-size:14px">faint text on a near-identical background</p>
  <p class="text-dim" style="color:#d9e8f5;font-size:14px">readable text</p>
</body></html>`;

test("the smoke sensors catch a page broken on purpose", async ({ page }) => {
  await page.setContent(BROKEN);
  await page.waitForTimeout(300);
  expect(await brokenImages(page)).toHaveLength(1);
  expect(await horizontalOverflow(page)).toHaveLength(1);
  const contrast = await lowContrast(page);
  expect(contrast.issues).toHaveLength(1);
  expect(contrast.issues[0]).toContain("faint text");
  expect(contrast.measured).toBe(2);
});
