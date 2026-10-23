import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { losesHistory, marksOf, MIN_ROWS, parseTrending, recordSnapshot } from "./trending-marks-core.mjs";

// real github.com/trending rows (21 Oct 2026), see the comment inside
const PAGE = readFileSync(join(import.meta.dirname, "fixtures", "trending-all-2026-10-21.html"), "utf8");
const names = new Map([
  ["santifer/career-ops", "career-ops-hq/career-ops"],
  ["career-ops-hq/career-ops", "career-ops-hq/career-ops"],
]);
const rows = (...r) => [...r, "a/x", "b/y", "c/z"];

describe("parseTrending", () => {
  it("reads the rows of a real page, in order, lowercased", () => {
    expect(parseTrending(PAGE)).toEqual(["cloudflare/security-audit-skill", "vllm-project/vllm", "stablyai/orca"]);
  });

  it("unwraps the signed-out /login?return_to= link", () => {
    const wrapped = PAGE.replace('href="/vllm-project/vllm"', 'href="/login?return_to=%2Fvllm-project%2Fvllm"');
    expect(wrapped).not.toBe(PAGE);
    expect(parseTrending(wrapped)[1]).toBe("vllm-project/vllm");
  });

  it("a malformed return_to escape skips that row, not the page", () => {
    const bad = PAGE.replace('href="/vllm-project/vllm"', 'href="/login?return_to=%E0%A4%A"');
    expect(parseTrending(bad)).toEqual(["cloudflare/security-audit-skill", "stablyai/orca"]);
  });

  it("a page it does not understand gives no rows, which the collector refuses", () => {
    expect(parseTrending("<html><body>Whoa there! You have triggered an abuse detection mechanism.</body></html>")).toEqual([]);
  });
});

describe("recordSnapshot", () => {
  it("marks the tracked repo under its canonical name, best place of the day, and counts the checks", () => {
    let r = recordSnapshot(null, { at: "2026-10-22T03:07:00Z", lists: { all: rows("santifer/career-ops"), javascript: rows() }, names });
    r = recordSnapshot(r, { at: "2026-10-22T09:07:00Z", lists: { all: ["q/q", "w/w", ...rows("career-ops-hq/career-ops")], javascript: rows() }, names });
    expect(r.checks["2026-10-22"]).toEqual({ all: 2, javascript: 2 });
    expect(r.tracked).toEqual(["career-ops-hq/career-ops"]);
    expect(r.marks["career-ops-hq/career-ops"]["2026-10-22"].all).toEqual({
      pos: 1, seen: 2, first: "2026-10-22T03:07:00Z", last: "2026-10-22T09:07:00Z",
    });
    expect(marksOf(r, "career-ops-hq/career-ops")).toEqual([{ day: "2026-10-22", list: "all", pos: 1, seen: 2 }]);
  });

  it("a failed or too-short list is not a check: its absence claims nothing", () => {
    const r = recordSnapshot(null, { at: "2026-10-22T03:07:00Z", lists: { all: null, javascript: ["a/x"].slice(0, MIN_ROWS - 1) }, names });
    expect(r.checks).toEqual({});
    expect(r.lastCheck).toBeNull();
  });

  it("checked without the repo = a checked day with no mark", () => {
    const r = recordSnapshot(null, { at: "2026-10-23T03:07:00Z", lists: { all: rows(), javascript: rows() }, names });
    expect(r.checks["2026-10-23"]).toEqual({ all: 1, javascript: 1 });
    expect(marksOf(r, "career-ops-hq/career-ops")).toEqual([]);
  });

  it("never mutates the previous record", () => {
    const prev = recordSnapshot(null, { at: "2026-10-22T03:07:00Z", lists: { all: rows("santifer/career-ops") }, names });
    const copy = structuredClone(prev);
    recordSnapshot(prev, { at: "2026-10-22T05:07:00Z", lists: { all: rows("santifer/career-ops") }, names });
    expect(prev).toEqual(copy);
  });
});

describe("losesHistory", () => {
  const prev = recordSnapshot(null, { at: "2026-10-22T03:07:00Z", lists: { all: rows("santifer/career-ops") }, names });
  it("a fresh record over an existing one is refused (a read that failed must not wipe the past)", () => {
    const fresh = recordSnapshot(null, { at: "2026-10-23T03:07:00Z", lists: { all: rows() }, names });
    expect(losesHistory(prev, fresh)).toMatch(/2026-10-22/);
  });
  it("a normal fold keeps everything", () => {
    expect(losesHistory(prev, recordSnapshot(prev, { at: "2026-10-23T03:07:00Z", lists: { all: rows() }, names }))).toBeNull();
  });
});
