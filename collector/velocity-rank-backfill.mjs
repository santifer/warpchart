// ONE-OFF: reconstruct the daily velocity rank for the days BEFORE the moat
// existed (route-history starts on 2026-06-13, so the recorded table starts
// on 2026-06-14). Writes velocity-rank/reconstructed.json in the private Blob:
//   { from, to, builtAt, top, universe, source, days: [iso], repos: { name: { end, g: [..] } } }
// read by src/lib/velocity-rank.ts and drawn as RECONSTRUCTED (hollow dots,
// dashed median), never mixed with the recorded record. The rebuild math is
// reconstructDays() in velocity-rank-core.mjs; its limits are written there.
//
// Universe: today's top 2,000 from the newest route-history day. A repo in a
// past day's top 1,000 is in today's top 2,000 unless it lost stars or was
// deleted (the second is a known gap). One call per repo: page 1 of
// /stargazers/history holds the last 30 weeks, which covers the window.
//
// VALIDATE BEFORE WRITING: under 99% of the universe fetched, or the house
// repo missing, writes nothing.
//
// Usage (by hand, once): BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/velocity-rank-backfill.mjs [--out file]
import { writeFileSync } from "node:fs";
import { readConfig } from "./lib.mjs";

const SHARDS = 32;
const FROM = "2026-04-01";
const TO = process.env.VR_TO ?? "2026-06-13"; // the day before the recorded table's first day (VR_TO: validation runs only)
const UNIVERSE = 2000;
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (args.includes("--out") && !OUT) {
  console.log("[vr-backfill] --out needs a file; nothing done");
  process.exit(1);
}
// a validation run reaches into the recorded months: it must never reach the Blob
if (process.env.VR_TO && !OUT) {
  console.log("[vr-backfill] VR_TO is for validation runs and needs --out; nothing done");
  process.exit(1);
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
const gh = process.env.GH_TOKEN;
if (!token || !gh) {
  console.log("[vr-backfill] needs BLOB_READ_WRITE_TOKEN and GH_TOKEN");
  process.exit(1);
}

async function readJson(key) {
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", token, useCache: false });
  if (!res || res.statusCode === 404) return null;
  if (res.statusCode !== 200 || !res.stream) throw new Error(`${key}: HTTP ${res.statusCode}`);
  return JSON.parse(await new Response(res.stream).text());
}

const DAY = 864e5;
const isoDays = (a, b) => {
  const out = [];
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

// { iso: count } for every UTC day of the last 30 weeks; null on failure
async function history(repo) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://api.github.com/repos/${repo}/stargazers/history`, {
        headers: { Authorization: `Bearer ${gh}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) return null;
      if (res.status === 202 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      const weeks = await res.json();
      // page 1 holds the last 30 weeks; once FROM falls out of it, a missing
      // day must not read as 0 (every repo would rank #1 that day)
      const oldest = Math.min(...weeks.map((w) => w.week)) * 1000;
      if (!(oldest <= Date.parse(`${FROM}T00:00:00Z`))) throw new Error(`window starts after ${FROM}`);
      const byDay = {};
      for (const w of weeks) {
        w.days.forEach((n, i) => {
          byDay[new Date((w.week + i * 86400) * 1000).toISOString().slice(0, 10)] = n;
        });
      }
      return byDay;
    } catch {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  const meta = await readJson("route-history/meta.json");
  const last = [...meta.days].sort().at(-1);
  const top = [];
  for (let i = 0; i < SHARDS; i++) {
    const s = await readJson(`route-history/shard-${i}.json`);
    for (const [repo, pts] of Object.entries(s?.series ?? {})) {
      const p = pts.find((x) => x[0] === last);
      if (p && p[1] <= UNIVERSE) top.push({ repo, rank: p[1], stars: p[2] });
    }
  }
  console.log(`[vr-backfill] universe: ${top.length} repos (top ${UNIVERSE} of ${last})`);
  if (top.length < UNIVERSE * 0.99) throw new Error(`universe short: ${top.length}`);

  const days = isoDays(FROM, TO);
  const repos = {};
  const failed = [];
  const queue = [...top];
  let done = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const h = await history(x.repo);
      if (!h) { failed.push(x.repo); continue; }
      // stars after the window = everything recorded after TO; the newest
      // route-history capture (x.stars) minus that = stars at the end of TO.
      // Known skew: the capture is hours older than this run, so `end` comes
      // out low by those hours' stars (only moves who is near #1000)
      const after = Object.entries(h).filter(([d]) => d > TO).reduce((a, [, n]) => a + n, 0);
      const end = x.stars - after;
      repos[x.repo.toLowerCase()] = { end: Math.max(0, end), g: days.map((d) => h[d] ?? 0) };
      if (++done % 250 === 0) console.log(`[vr-backfill] ${done}/${top.length}`);
    }
  }));
  console.log(`[vr-backfill] fetched ${done}, failed ${failed.length}${failed.length ? `: ${failed.slice(0, 8).join(", ")}` : ""}`);
  const house = readConfig().repo.toLowerCase();
  if (done < top.length * 0.99) throw new Error(`only ${done} of ${top.length} fetched; nothing written`);
  if (!repos[house]) throw new Error(`house repo ${house} missing; nothing written`);

  const file = {
    from: FROM, to: TO, top: 1000, universe: UNIVERSE, builtAt: new Date().toISOString(),
    source: `GitHub /stargazers/history (current stargazers only), universe = top ${UNIVERSE} of ${last}`,
    days, repos,
  };
  const body = JSON.stringify(file);
  console.log(`[vr-backfill] ${days.length} days, ${Object.keys(repos).length} repos, ${(body.length / 1024).toFixed(0)} KB`);
  if (body.length > 1.8 * 1024 * 1024) throw new Error("file over 1.8 MB (Next's data cache drops >2 MB); nothing written");
  if (OUT) return writeFileSync(OUT, body);
  const { put } = await import("@vercel/blob");
  await put("velocity-rank/reconstructed.json", body, { access: "private", token, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  console.log("[vr-backfill] written velocity-rank/reconstructed.json");
}

main().catch((e) => {
  console.error(`[vr-backfill] FAILED: ${e?.message ?? e}`);
  process.exit(1);
});
