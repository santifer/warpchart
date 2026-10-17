import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BUCKETS, WEEK_MIN, buckets, buildersSvg, fill, gridFor, isPerson, selectBuilders, weekCount, LOCALES } from "./builders-core.mjs";

const MESSAGES = JSON.parse(readFileSync(new URL("./builders-messages.json", import.meta.url), "utf8"));
const NOW = "2026-10-17T17:00:00Z";

// Shapes from the career-ops census on 2026-10-17 (`gh` map, public logins).
const gh = {
  "claude": { first: "2026-04-04T17:51:27Z", co: true },          // AI pairing co-author: the census keeps it
  "cursoragent": { first: "2026-05-22T16:49:42Z", co: true },
  "codex": { first: "2026-08-27T16:33:34Z", co: true },
  "careerops-ledger": { first: "2026-07-10T10:00:00Z", co: false }, // manifesto service account
  "dependabot[bot]": { first: "2026-04-13T06:37:35Z", co: false },
  "santifer": { first: "2026-04-04T18:00:00Z", co: false },
  "vliggio": { first: "2026-08-04T07:09:31Z", co: false },
  "readyagentsdev": { first: "2026-10-02T15:54:08Z", co: true },   // a person whose login says "agent"
  "dakshx07": { first: "2026-10-16T15:49:23Z", co: false },
};

describe("selectBuilders: people only, in order of arrival", () => {
  it("drops AI pairing tools, bots and the ledger (they rode in on 17-oct's first render)", () => {
    const logins = selectBuilders(gh).map((p) => p.login);
    expect(logins).toEqual(["santifer", "vliggio", "readyagentsdev", "dakshx07"]);
    for (const l of ["claude", "cursoragent", "codex", "careerops-ledger", "dependabot[bot]"]) expect(isPerson(l)).toBe(false);
  });
  it("keeps real people whose login merely CONTAINS an AI name (a regex dropped them on 17-oct's review)", () => {
    for (const l of ["jules-verne", "Claude42", "claude-dupont", "cursor-x", "codex-team", "renovatecasa", "readyagentsdev"]) expect(isPerson(l), l).toBe(true);
    for (const l of ["codecov", "Copilot", "google-labs-jules", "renovate[bot]"]) expect(isPerson(l), l).toBe(false);
  });
  it("honours the opt-out list, case-insensitively", () => {
    expect(selectBuilders(gh, { optout: ["VLIGGIO"] }).map((p) => p.login)).not.toContain("vliggio");
  });
});

describe("gridFor: a wide banner that is never full", () => {
  it.each([[667], [669], [670], [1000], [3]])("n=%i leaves at least one free cell", (n) => {
    const g = gridFor(n);
    expect(g.cols * g.rows).toBeGreaterThan(n);
  });
  it("picks the tightest fit: 667 people -> 67x10, 3 free cells", () => {
    expect(gridFor(667)).toMatchObject({ cols: 67, rows: 10, empty: 3 });
  });
});

describe("buildersSvg", () => {
  const people = selectBuilders(gh);
  const svg = buildersSvg(people, { now: NOW, msg: MESSAGES.en, lang: "en" });

  it("starts on the FULL wall: every tile keyframe opens at opacity 1 (what reduced motion and a frozen frame show)", () => {
    const tiles = [...svg.matchAll(/@keyframes k\d+\{0%\{opacity:1\}/g)];
    expect(tiles.length).toBe(new Set(buckets(people, NOW)).size);
  });

  it("never interpolates: every loop animation is step-end (linear made this week's faces show half-faded mid-build)", () => {
    expect(svg).not.toMatch(/ linear infinite/);
    expect(svg).toMatch(/step-end infinite/);
  });

  it("the last bucket lands before the 76% hold (it used to share the 76% keyframe and blend)", () => {
    const last = buckets(people, NOW).at(-1);
    expect(last).toBe(BUCKETS - 1);
    const m = svg.match(new RegExp(`@keyframes k${last}\\{0%\\{opacity:1\\}14%\\{opacity:0\\}([\\d.]+)%`));
    expect(Number(m[1])).toBeLessThan(76);
  });

  it("prints 'N joined this week' only from WEEK_MIN up; below, the latest arrival (never '0 joined')", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ login: `p${i}`, first: `2026-10-1${i + 1}T10:00:00Z` }));
    expect(buildersSvg(many, { now: NOW, msg: MESSAGES.en, lang: "en" })).toContain("6 joined this week");
    expect(weekCount(people, NOW)).toBeLessThan(WEEK_MIN); // 1 (dakshx07)
    expect(svg).not.toMatch(/joined this week/);
    expect(svg).toContain("latest arrival yesterday");
    const quiet = buildersSvg(people, { now: "2027-03-01T00:00:00Z", msg: MESSAGES.en, lang: "en" });
    expect(quiet).not.toMatch(/0 joined/);
    expect(quiet).toMatch(/latest arrival 135 days ago/);
  });

  it("escapes logins and copy (a login is user input)", () => {
    const s = buildersSvg([{ login: "a<b", first: "2026-04-04T00:00:00Z" }], { now: NOW, msg: MESSAGES.en, lang: "en" });
    expect(s).toContain("@a&lt;b");
  });

  it("refuses incomplete copy instead of shipping an empty caption", () => {
    expect(() => buildersSvg(people, { now: NOW, msg: { title: "x" }, lang: "en" })).toThrow(/incomplete/);
  });

  it("mirrors Arabic by moving x only: in RTL 'start' is the right edge (an 'end' at W-8 drew off-canvas)", () => {
    const s = buildersSvg(people, { now: NOW, msg: MESSAGES.en, lang: "ar" });
    const W = Number(s.match(/width="(\d+)"/)[1]);
    const title = s.match(/<text x="(\d+)" y="\d+" font-size="14" font-weight="700" text-anchor="(\w+)"[^>]*direction="rtl"/);
    expect([Number(title[1]), title[2]]).toEqual([W - 8, "start"]);
    expect(s).toMatch(/class="cap" x="8" y="\d+" font-size="13" text-anchor="end"[^>]*direction="rtl"/);
  });
});

describe("messages", () => {
  it("every language present is a README language and has all four fields", () => {
    for (const [lang, m] of Object.entries(MESSAGES)) {
      if (lang.startsWith("_")) continue;
      expect(LOCALES).toHaveProperty(lang);
      for (const k of ["title", "caption", "building", "alt"]) expect(m[k], `${lang}.${k}`).toBeTruthy();
      // only known placeholders: a typo would print "{wek}" on 19 READMEs
      for (const v of Object.values(m)) expect(fill(v, { since: "", week: "", n: "", month: "", ago: "" })).not.toMatch(/\{\w+\}/);
    }
  });
});
