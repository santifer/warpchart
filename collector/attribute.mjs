#!/usr/bin/env node
// Spike attribution. Two things GitHub will not give you, joined:
//   1. WHEN a surge happened — to the hour — from the second-precise stargazer
//      timestamps that collect.mjs keeps fresh (GraphQL, no 40k REST cap).
//   2. WHAT drove it — by DIFFING the Traffic Vault's referrer snapshots across
//      the surge window: "t.co jumped +1,400 the hour 67 stars landed" => that
//      surge came from Twitter. GitHub only exposes a blurry 14-day referrer
//      aggregate; sampling every run and diffing reconstructs the per-hour
//      attribution it never stores.
//
// Writes data/attribution.json to the PRIVATE Blob; the bundle merges it into
// the public Mission Log of the HOUSE repo (career-ops). Best-effort, never
// fatal. Runs after traffic.mjs so the freshest referrer snapshot is available.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/attribute.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { get, put } from "@vercel/blob";
import { DATA_DIR, readConfig } from "./lib.mjs";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log("[attribute] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const house = (() => {
  try {
    return readConfig()?.repo ?? null;
  } catch {
    return null;
  }
})();
if (!house) {
  console.log("[attribute] no house repo, skipping");
  process.exit(0);
}

const HOUR = 3600e3;
// search engines + github's own pages are ambient traffic, never a "what drove
// this surge" event; only external referrers can be a cause.
const SEARCH = /^(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex|search\.brave\.com|github\.com)$/i;
const LABELS = {
  "t.co": "Twitter (t.co)",
  "twitter.com": "Twitter",
  "x.com": "Twitter (X)",
  "l.threads.com": "Threads",
  "lnkd.in": "LinkedIn",
  "linkedin.com": "LinkedIn",
  "com.linkedin.android": "LinkedIn (app)",
  "reddit.com": "Reddit",
  "out.reddit.com": "Reddit",
  "news.ycombinator.com": "Hacker News",
  "producthunt.com": "Product Hunt",
};
const labelFor = (d) => LABELS[d.toLowerCase()] || d;

// ---- 1. hourly surges from the timestamps ----
function loadTimestamps() {
  const p = join(DATA_DIR, "stargazer_timestamps.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
}

const now = Date.now();
const floorHour = (ms) => Math.floor(ms / HOUR) * HOUR;
const buckets = new Map(); // hourMs -> star count
for (const line of loadTimestamps()) {
  const t = Date.parse(line);
  if (!t || t < now - 10 * 24 * HOUR) continue;
  const h = floorHour(t);
  buckets.set(h, (buckets.get(h) || 0) + 1);
}
const counts = [...buckets.values()].sort((a, b) => a - b);
const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
const MIN_SURGE = 25; // never call a quiet repo's normal hour a "surge"
const threshold = Math.max(MIN_SURGE, median * 3);
const curHour = floorHour(now);
const surges = [];
for (const [h, c] of buckets) {
  if (h >= curHour) continue; // skip the current, still-filling hour
  if (h < now - 4 * 24 * HOUR) continue; // keep the log fresh: last ~4 days
  if (c >= threshold) surges.push({ hourStart: new Date(h).toISOString(), hMs: h, stars: c, baseline: Math.round(median) });
}
surges.sort((a, b) => b.hMs - a.hMs);
const top = surges.slice(0, 5);

// ---- 2. the Traffic Vault's referrer snapshots ----
const vaultKey = `traffic/${house.toLowerCase().replace("/", "--")}.json`;
let vault = null;
try {
  const res = await get(vaultKey, { access: "private", token: blobToken });
  if (res?.statusCode === 200 && res.stream) vault = JSON.parse(await new Response(res.stream).text());
} catch {
  /* no vault yet */
}
const history = (vault?.referrerHistory ?? []).slice().sort((a, b) => (a.at < b.at ? -1 : 1));
const current = (vault?.referrers ?? []).filter((r) => !SEARCH.test(r.r));

function attribute(hMs) {
  // bracket the surge: the snapshot just before it and the first one after it.
  const before = [...history].reverse().find((s) => Date.parse(s.at) <= hMs);
  const after = history.find((s) => Date.parse(s.at) >= hMs + HOUR);
  if (before && after) {
    const bmap = new Map(before.refs.map((r) => [r.r, r.c]));
    let best = null;
    for (const r of after.refs) {
      if (SEARCH.test(r.r)) continue;
      const delta = r.c - (bmap.get(r.r) ?? 0);
      if (delta > 0 && (!best || delta > best.delta)) best = { domain: r.r, delta };
    }
    if (best && best.delta >= 15) {
      return { type: "referrer", domain: best.domain, label: labelFor(best.domain), delta: best.delta, confidence: "high" };
    }
  }
  // no bracketing snapshots (surge predates vaulting, or referrers too flat) ->
  // name the dominant external source right now, flagged as a guess.
  if (current[0]) {
    return { type: "referrer", domain: current[0].r, label: labelFor(current[0].r), delta: null, confidence: "likely" };
  }
  return null;
}

const out = {
  generated_at: new Date().toISOString(),
  repo: house,
  surges: top.map((s) => ({ hourStart: s.hourStart, stars: s.stars, baseline: s.baseline, cause: attribute(s.hMs) })),
};

writeFileSync(join(DATA_DIR, "attribution.json"), JSON.stringify(out));
await put("data/attribution.json", JSON.stringify(out), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: "application/json",
  token: blobToken,
});
console.log(
  `[attribute] ${out.surges.length} surges (median ${median}/h, threshold ${threshold}/h): ` +
    out.surges.map((s) => `+${s.stars}@${s.hourStart.slice(11, 13)}h->${s.cause?.label ?? "?"}`).join(", "),
);
