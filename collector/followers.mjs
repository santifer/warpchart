// Daily (well, every-run) snapshot of the OWNER's GitHub follower count and
// worldwide standing, into the private Blob. PRIVATE BY CONSTRUCTION: this
// writes to the `private/` prefix, which is deliberately outside the two
// prefixes anything else touches.
//
//   scripts/sync-{to,from}-blob.mjs  list only `data/`  -> never lands in the
//                                    built app's filesystem
//   src/lib/codex.ts                 lists only `codex/`
//   every other reader               asks for ONE known key by name
//
// So there is no route, no sync and no enumeration that can surface this. To
// expose it later you would have to write a reader on purpose, which is the
// point: Santiago asked for the number, not for a public follower chart.
//
// WHY THIS EXISTS: follower history cannot be backfilled. GitHub publishes a
// single point-in-time integer and no series, so every day this does not run is
// a day that can never be recovered. Between 2026-07-30 and 2026-08-02 the
// question "am I growing today?" had to be answered from six hand-taken
// measurements at irregular intervals, and the honest answer was that a 1-day
// window could not be told apart from noise in an average derived from 8- and
// 15-day gaps. That is the gap this closes.
//
// Records EVERY run (~every 2h) rather than once a day on purpose: the question
// that actually gets asked is "is something happening right now", and a daily
// point cannot answer it. Older points compact to one per day (see COMPACT).
//
// Usage: BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/followers.mjs
//        FOLLOWERS_LOCATION=spain  (optional: also record the rank within one
//                                   GitHub `location:` filter)
import { put, get } from "@vercel/blob";
import { ghFetch, readConfig, sleep } from "./lib.mjs";

const KEY = "private/followers.json";
const COMPACT_AFTER_DAYS = 90; // full resolution inside this window, daily before it
const DAY = 864e5;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[followers] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

async function readJson(key) {
  try {
    const res = await get(key, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text());
    }
  } catch {
    /* first run, or transient */
  }
  return null;
}

// How many USERS have strictly more followers than `n`. Rank = that + 1.
// `type:user` matters: without it the count includes organisations, which
// inflated the worldwide rank by 520 places when this was first measured by
// hand (2,426 with orgs vs 1,906 people).
async function rankAbove(n, extra = "") {
  const q = `followers:>${n}+type:user${extra ? "+" + extra : ""}`;
  const r = await ghFetch(`/search/users?q=${q}&per_page=1`);
  const total = r?.total_count;
  return Number.isFinite(total) ? total + 1 : null;
}

// The hand-taken series that predates this collector, kept because it cannot be
// re-measured and it is the only evidence of the pre-August pace. Marked
// src:"manual" so it is never mistaken for a collector reading. Seeded once,
// on the first run only, when the store is empty.
const SEED = [
  { t: "2026-07-15T12:00:00Z", f: 2893, r: 1970, src: "manual" },
  { t: "2026-07-16T14:30:00Z", f: 2917, r: 1955, src: "manual" },
  { t: "2026-07-20T12:00:00Z", f: 2927, r: 1951, src: "manual" },
  { t: "2026-07-22T15:20:00Z", f: 2939, r: 1943, src: "manual" },
  { t: "2026-07-30T07:46:00Z", f: 2990, r: 1906, src: "manual" },
  { t: "2026-07-30T18:00:00Z", f: 2988, r: null, src: "manual" },
  { t: "2026-07-31T13:34:00Z", f: 2989, r: 1907, src: "manual" },
  { t: "2026-08-02T08:18:00Z", f: 2992, r: 1906, src: "manual" },
];

// Keep every point inside the recent window; beyond it keep only the LAST
// reading of each UTC day. ~12 points/day would be ~4.4k points a year
// otherwise; this holds the file to a few hundred KB indefinitely.
function compact(points, nowMs) {
  const cutoff = nowMs - COMPACT_AFTER_DAYS * DAY;
  const recent = [];
  const olderByDay = new Map();
  for (const p of points) {
    const ms = Date.parse(p.t);
    if (!Number.isFinite(ms)) continue;
    if (ms >= cutoff) recent.push(p);
    else olderByDay.set(p.t.slice(0, 10), p); // later point wins the day
  }
  return [...olderByDay.values(), ...recent].sort((a, b) => (a.t < b.t ? -1 : 1));
}

async function main() {
  const cfg = readConfig();
  const user = (cfg.owned_by?.[0] ?? cfg.repo.split("/")[0]).trim();
  const location = (process.env.FOLLOWERS_LOCATION ?? "").trim();

  const me = await ghFetch(`/users/${user}`);
  const followers = me?.followers;
  if (!Number.isFinite(followers)) {
    console.log(`[followers] ${user}: no follower count in the response, skipping`);
    return;
  }

  // A failed rank lookup records null, never 0 and never the previous value:
  // an absence published with the confidence of a measurement is the exact bug
  // class that produced every bad number this project has shipped.
  let rank = null;
  let locRank = null;
  try {
    rank = await rankAbove(followers);
    if (location) {
      await sleep(2100); // search API: 30 req/min
      locRank = await rankAbove(followers, `location:${location}`);
    }
  } catch (err) {
    console.log(`[followers] rank lookup failed (recording null): ${err.message}`);
  }

  const store = (await readJson(KEY)) ?? { user, points: [] };
  const seeded = store.points.length === 0 && user === "santifer";
  if (seeded) store.points = [...SEED];

  const now = new Date();
  const point = {
    t: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    f: followers,
    g: Number.isFinite(me?.following) ? me.following : null,
    r: rank,
    ...(location ? { lr: locRank, loc: location } : {}),
  };

  // Same-run reruns (a manual dispatch minutes after the cron) would otherwise
  // stack near-identical points; replace anything from the same minute.
  const minute = point.t.slice(0, 16);
  store.points = store.points.filter((p) => p.t.slice(0, 16) !== minute);
  store.points.push(point);
  store.points = compact(store.points, now.getTime());
  store.user = user;
  store.updated_at = point.t;

  await put(KEY, JSON.stringify(store), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });

  // A rate needs two points and a span; with one point it is unknown, not zero.
  const pts = store.points;
  let rate = "n/a";
  if (pts.length >= 2) {
    const first = pts.find((p) => Date.parse(p.t) >= now.getTime() - 7 * DAY) ?? pts[0];
    const days = (now.getTime() - Date.parse(first.t)) / DAY;
    if (days >= 1) rate = `${((followers - first.f) / days).toFixed(1)}/d over ${days.toFixed(1)}d`;
  }
  console.log(
    `[followers] ${user}: ${followers} followers` +
      ` · world #${rank ?? "n/a"}` +
      (location ? ` · ${location} #${locRank ?? "n/a"}` : "") +
      ` · ${rate} · ${pts.length} points${seeded ? " (seeded manual history)" : ""}`
  );
}

main().catch((err) => {
  // Never break the collect run over a private side-metric.
  console.error(`[followers] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
