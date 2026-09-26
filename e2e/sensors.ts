import type { Page } from "@playwright/test";

// What a visitor would call "broken", measured in the page itself. Each sensor
// returns the offending items (empty = healthy) so a failure names its cause.

// An <img> the browser finished and could not decode (a failed redirect, a
// 404, an invalid source). Lazy images not yet requested are not "complete".
export function brokenImages(page: Page) {
  return page.evaluate(() =>
    [...document.images]
      .filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src"))
      .map((i) => i.currentSrc || i.getAttribute("src") || ""),
  );
}

// Horizontal scroll on the page itself (the phone swipe that shows a strip of
// nothing). A 1 px tolerance absorbs sub-pixel rounding.
export function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const over = document.documentElement.scrollWidth - window.innerWidth;
    return over > 1 ? [`page is ${over}px wider than the viewport`] : [];
  });
}

// WCAG contrast of text drawn with our muted/accent tokens against the
// background actually painted behind it: the first opaque background COLOR up
// the tree. Gradients (our panels and backdrops) fall through to that color,
// which is how the eye reads them; only a real image (url()) makes a sample
// unmeasurable. Returns the offenders plus how many samples it could measure,
// so the smoke can refuse to pass while blind (the first version measured 0 of
// 80 on the repo page and still reported "healthy").
export function lowContrast(page: Page, selector = ".text-faint, .text-dim, .text-accent", limit = 80) {
  return page.evaluate(
    ({ selector, limit }) => {
      const parse = (c: string) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = "1"] = m[1].split(/[,\s/]+/).filter(Boolean);
        return { r: +r, g: +g, b: +b, a: +a };
      };
      const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
        const f = (v: number) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el: Element | null): { r: number; g: number; b: number } | "complex" | null => {
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (/url\(/.test(cs.backgroundImage)) return "complex";
          const c = parse(cs.backgroundColor);
          if (c && c.a >= 0.95) return c;
        }
        return parse(getComputedStyle(document.documentElement).backgroundColor);
      };
      const issues: string[] = [];
      let measured = 0;
      const els = [...document.querySelectorAll(selector)].filter((e) => {
        const r = e.getBoundingClientRect();
        const t = (e.textContent ?? "").trim();
        return r.width > 0 && r.height > 0 && t.length > 0 && getComputedStyle(e).visibility !== "hidden";
      });
      for (const el of els.slice(0, limit)) {
        const cs = getComputedStyle(el);
        if (+cs.opacity < 0.95) continue; // decorative, deliberately faded
        const fg = parse(cs.color);
        const bg = bgOf(el);
        if (!fg || !bg || bg === "complex" || fg.a < 0.95) continue;
        measured++;
        const [L1, L2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
        const ratio = (L1 + 0.05) / (L2 + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
        const need = large ? 3 : 4.5;
        if (ratio < need) issues.push(`${ratio.toFixed(2)} < ${need}: "${(el.textContent ?? "").trim().slice(0, 40)}" (${el.className.toString().slice(0, 60)})`);
      }
      return { issues, measured, candidates: Math.min(els.length, limit) };
    },
    { selector, limit },
  );
}
