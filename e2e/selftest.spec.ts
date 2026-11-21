import { expect, test } from "@playwright/test";
import { repoGraph, siteGraph } from "../src/components/JsonLd";
import { PAGES } from "./pages";
import { brokenImages, horizontalOverflow, lowContrast, visibleText } from "./sensors";

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

// The layout and the masthead with no page under them: the site's real JSON-LD
// (the layout injects it into every <body>), a repo page's own JSON-LD (emitted
// before anything else renders) and the nav every page draws. While the render
// check read textContent, "/" and "/velocity" passed on exactly this.
const SHELL = `<!doctype html><html><body>
  <script type="application/ld+json">${JSON.stringify(siteGraph)}</script>
  <script type="application/ld+json">${JSON.stringify(repoGraph("chalk/ansi-styles", { stars: 465, rank: 132736 }))}</script>
  <nav>WARPCHART COMPARE RISING WARP INDEX DOCS PRICING · SOUND OFF · THEME AUTO</nav>
  <div>LIVE DEMO MISSION: career-ops-hq/career-ops →</div>
</body></html>`;

test("the render check refuses a page that is only layout and masthead", async ({ page }) => {
  await page.setContent(SHELL);
  // the trap: textContent finds the site's name inside the JSON-LD
  expect(await page.locator("body").textContent()).toMatch(/warpchart/i);
  const text = await visibleText(page);
  for (const p of PAGES) expect(text, `${p.path} passed on the shell alone`).not.toMatch(p.expect);
});
