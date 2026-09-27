import { describe, expect, it } from "vitest";
import { compareVersions, datedWeek, newestVersion, parseVersionDownloads, summarizeVersions } from "@/lib/npm-versions";

describe("npm downloads by version", () => {
  it("reads npm's per-version week, busiest first", () => {
    const list = parseVersionDownloads({
      package: "@santifer/career-ops",
      downloads: { "1.32.0": 13, "1.33.0": 1719, "1.34.0": 454, "1.20.0": 0 },
    });
    expect(list).toEqual([
      { version: "1.33.0", d: 1719 },
      { version: "1.34.0", d: 454 },
      { version: "1.32.0", d: 13 },
    ]);
  });

  // npm answers 200 with downloads:{} for a package that does not exist
  // (checked 27-sep with @career-ops-hq/career-ops): that is no data, not zero.
  it("says null, never zero, when npm returns an empty map", () => {
    expect(parseVersionDownloads({ package: "@career-ops-hq/career-ops", downloads: {} })).toBeNull();
    expect(parseVersionDownloads({ error: "not found" })).toBeNull();
    expect(parseVersionDownloads(null)).toBeNull();
  });

  it("summarizes the top versions and folds the rest into one line", () => {
    const list = [
      { version: "1.33.0", d: 1719 },
      { version: "1.34.0", d: 454 },
      { version: "1.32.0", d: 13 },
      { version: "1.31.0", d: 5 },
      { version: "1.30.0", d: 3 },
      { version: "1.29.0", d: 2 },
    ];
    const s = summarizeVersions(list, 3);
    expect(s.total).toBe(2196);
    expect(s.rows.map((r) => r.version)).toEqual(["1.33.0", "1.34.0", "1.32.0"]);
    expect(s.rest).toEqual({ versions: 3, d: 10 });
  });
});

describe("the week a reading belongs to", () => {
  const versions = [
    { version: "1.33.0", d: 1719 },
    { version: "1.34.0", d: 490 },
  ];
  // Review catch: the versions endpoint does not say its week; stamping it with
  // the fetch day dated the 19-25 Sep week as "27 Sep".
  it("dates a reading with npm's own week when the totals agree", () => {
    expect(datedWeek(versions, { downloads: 2209, start: "2026-09-19", end: "2026-09-25" })).toEqual({
      list: versions,
      start: "2026-09-19",
      end: "2026-09-25",
    });
  });

  it("refuses a reading whose total does not match (it straddled npm's weekly roll)", () => {
    expect(datedWeek(versions, { downloads: 2300, start: "2026-09-20", end: "2026-09-26" })).toBeNull();
  });

  it("refuses when npm could not say which week", () => {
    expect(datedWeek(versions, { error: "not found" } as never)).toBeNull();
    expect(datedWeek(null, { downloads: 0, start: "a", end: "b" })).toBeNull();
  });
});

describe("newest version", () => {
  it("orders like semver, not like text", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.34.0", "1.34.0-beta.1")).toBeGreaterThan(0); // review catch
    expect(compareVersions("1.34.0+build.5", "1.34.0")).toBe(0);
    expect(newestVersion([{ version: "1.34.0-beta.1", d: 5 }, { version: "1.34.0", d: 1 }, { version: "1.9.0", d: 9 }])).toBe("1.34.0");
  });
});
