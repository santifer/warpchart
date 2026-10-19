// The read-modify-write writers, run end to end against a stub Blob store.
// The incident: a Blob read that fails (a 503, not a 404) was flattened to
// "empty", the merge started from nothing, and the write replaced the stored
// history with one run's worth. Each case below stubs that 503 and asserts the
// script issues no put to the key it could not read.
import { describe, it, expect } from "vitest";
import { runCollector } from "./test-support/blob-harness.mjs";

const script = (name) => new URL(`./${name}`, import.meta.url);
const putsTo = (r, key) => r.puts.filter((p) => p.key === key);
const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

describe("traffic vault", () => {
  const KEY = "traffic/career-ops-hq--career-ops.json";
  const OLD_KEY = "traffic/santifer--career-ops.json";
  const github = {
    "traffic/views": { count: 5, uniques: 3, views: [{ timestamp: `${day(-1)}T00:00:00Z`, count: 5, uniques: 3 }] },
    "traffic/clones": { count: 4, uniques: 2, clones: [{ timestamp: `${day(-1)}T00:00:00Z`, count: 4, uniques: 2 }] },
    "traffic/popular/referrers": [{ referrer: "github.com", count: 9, uniques: 4 }],
  };
  const stored = {
    repo: "career-ops-hq/career-ops",
    views: { "2026-01-01": { c: 100, u: 50 }, "2026-01-02": { c: 90, u: 40 } },
    clones: { "2026-01-01": { c: 10, u: 5 } },
    referrers: [],
  };

  it("a 503 on the vault writes nothing, and leaves a partial marker", () => {
    const r = runCollector(script("traffic.mjs"), { blobs: { [KEY]: stored }, fail: { [KEY]: 503 }, fetch: github }, { TRAFFIC_TOKEN: "stub" });
    expect(putsTo(r, KEY)).toEqual([]);
    expect(putsTo(r, "health/partial/traffic.json")).toHaveLength(1);
  });

  it("a 503 on the canonical key does not fall back to the pre-rename vault", () => {
    const r = runCollector(
      script("traffic.mjs"),
      { blobs: { [OLD_KEY]: stored }, fail: { [KEY]: 503 }, fetch: github },
      { TRAFFIC_TOKEN: "stub" },
    );
    expect(putsTo(r, KEY)).toEqual([]);
  });

  it("merges into the stored vault, fresh read, conditional write", () => {
    const r = runCollector(script("traffic.mjs"), { blobs: { [KEY]: stored }, fetch: github }, { TRAFFIC_TOKEN: "stub" });
    const [w] = putsTo(r, KEY);
    expect(w.ifMatch).toBe(`"etag-${KEY}"`);
    expect(Object.keys(w.body.views).sort()).toEqual(["2026-01-01", "2026-01-02", day(-1)]);
    expect(r.ops.filter((o) => o.op === "get" && o.key === KEY).every((o) => o.useCache === false)).toBe(true);
  });

  it("absent under every name is a new vault", () => {
    const r = runCollector(script("traffic.mjs"), { blobs: {}, fetch: github }, { TRAFFIC_TOKEN: "stub" });
    const [w] = putsTo(r, KEY);
    expect(w.ifMatch).toBeNull();
    expect(Object.keys(w.body.views)).toEqual([day(-1)]);
  });
});

describe("followers", () => {
  const KEY = "private/followers.json";
  const github = { "/users/santifer": { followers: 3100, following: 7 }, "/search/users": { total_count: 1800 } };

  it("a 503 on the store writes nothing (it used to re-seed over the history)", () => {
    const stored = { user: "santifer", points: [{ t: "2026-09-01T00:00:00Z", f: 3000, r: 1900 }] };
    const r = runCollector(script("followers.mjs"), { blobs: { [KEY]: stored }, fail: { [KEY]: 503 }, fetch: github });
    expect(putsTo(r, KEY)).toEqual([]);
  });

  it("appends a point to the stored series", () => {
    const stored = { user: "santifer", points: [{ t: "2026-09-01T00:00:00Z", f: 3000, r: 1900 }] };
    const r = runCollector(script("followers.mjs"), { blobs: { [KEY]: stored }, fetch: github });
    const [w] = putsTo(r, KEY);
    expect(w.ifMatch).toBe(`"etag-${KEY}"`);
    expect(w.body.points.map((p) => p.f)).toEqual([3000, 3100]);
  });
});

describe("installs", () => {
  const KEY = "private/installs.json";
  // 20 quiet days, one install wave (5x the cloners, ~1 clone each), then today
  const vault = { repo: "o/r", clones: {}, views: {} };
  for (let i = 22; i >= 1; i--) {
    vault.clones[day(-i)] = { c: 10, u: 10 };
    vault.views[day(-i)] = { c: 20, u: 20 };
  }
  vault.clones[day(-2)] = { c: 60, u: 50 };
  const prior = { events: [{ repo: "o/r", day: "2026-01-05", kind: "install-wave" }] };

  it("a 503 on the event store writes nothing (it used to drop every past event)", () => {
    const r = runCollector(script("installs.mjs"), { blobs: { "traffic/o--r.json": vault, [KEY]: prior }, fail: { [KEY]: 503 } });
    expect(putsTo(r, KEY)).toEqual([]);
  });

  it("appends the new wave to the stored events", () => {
    const r = runCollector(script("installs.mjs"), { blobs: { "traffic/o--r.json": vault, [KEY]: prior } });
    const [w] = putsTo(r, KEY);
    expect(w.ifMatch).toBe(`"etag-${KEY}"`);
    expect(w.body.events.map((e) => e.day)).toEqual(["2026-01-05", day(-2)]);
  });
});

describe("route-history", () => {
  const META = "route-history/meta.json";
  const meta = { days: [day(-2), day(-1)], counts: { [day(-1)]: 10000 }, shards: 32 };
  const shard = { dates: [day(-2), day(-1)], series: { "owner0/repo-0": [[day(-2), 1, 100000], [day(-1), 1, 100000]] } };
  const shards = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [`route-history/shard-${i}.json`, shard]));

  it("a 503 on a shard writes no shard and does not mark the day done", () => {
    const r = runCollector(
      script("route-history.mjs"),
      { blobs: { [META]: meta, ...shards }, fail: { "route-history/shard-0.json": 503 } },
      { STUB_DEEP: "10000" },
    );
    expect(r.puts.filter((p) => p.key.startsWith("route-history/"))).toEqual([]);
    expect(putsTo(r, "health/partial/route-history.json")).toHaveLength(1);
  });

  it("a 503 on meta writes nothing (it used to restart the series from day one)", () => {
    const r = runCollector(
      script("route-history.mjs"),
      { blobs: { [META]: meta, ...shards }, fail: { [META]: 503 } },
      { STUB_DEEP: "10000" },
    );
    expect(r.puts.filter((p) => p.key.startsWith("route-history/"))).toEqual([]);
  });

  it("an empty shard while meta records days is refused, not overwritten with today", () => {
    const r = runCollector(
      script("route-history.mjs"),
      { blobs: { [META]: meta, ...shards, "route-history/shard-0.json": { dates: [], series: {} } } },
      { STUB_DEEP: "10000" },
    );
    expect(putsTo(r, "route-history/shard-0.json")).toEqual([]);
    expect(putsTo(r, META)).toEqual([]);
    expect(putsTo(r, "health/partial/route-history.json")).toHaveLength(1);
  });

  it("records today into every shard, then meta", () => {
    const r = runCollector(script("route-history.mjs"), { blobs: { [META]: meta, ...shards } }, { STUB_DEEP: "10000" });
    const today = day(0);
    const [s0] = putsTo(r, "route-history/shard-0.json");
    expect(s0.ifMatch).toBe('"etag-route-history/shard-0.json"');
    expect(s0.body.dates).toEqual([day(-2), day(-1), today]);
    expect(putsTo(r, META)[0].body.days).toEqual([day(-2), day(-1), today]);
  });
});
