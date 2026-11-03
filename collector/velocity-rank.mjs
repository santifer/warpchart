// DAILY VELOCITY RANK: for every recorded day, the new-star gains of the
// worldwide top 1,000, so any repo's page can say where it placed that day
// ("#84 of 1,000 by new stars on 18 Oct"). Built from the rank-history moat
// (route-history hot shards + cold archive) with collector/velocity-rank-core.mjs,
// written to the PRIVATE Blob:
//   velocity-rank/{YYYY-MM}.json  { days: [{ day, to, n, gains, hours }] }
//   velocity-rank/meta.json       { months, days, first, last, lastTo, builtAt }
// One file per month because Next's data cache drops items over 2 MB; a month
// is ~130 KB. The page reads these and the repo's own series
// (src/lib/velocity-rank.ts). Locked: served only by the god-key API.
//
// Recomputed from scratch from the whole moat each time (the history is small
// and a full rebuild heals itself), idempotent on the newest recorded day: it
// runs on every collect but only reads the 64 shards when route-history has
// recorded a day this table does not have yet.
//
// VALIDATE BEFORE WRITING. A shard that fails to read takes ~1/32 of the top
// 1,000 with it while every day still looks complete, so every rank comes out
// a few places too good. Any hot shard unreadable, or fewer days than the
// table already had, writes nothing and leaves a partial marker.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/velocity-rank.mjs [--force] [--out dir]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildDays } from "./velocity-rank-core.mjs";
import { markPartial, markComplete } from "./blob.mjs";

const SHARDS = 32; // MUST match route-history.mjs and src/lib/rank-history.ts
const RH = "route-history";
const PREFIX = "velocity-rank";
const FAMILY = "velocity-rank";
const args = process.argv.slice(2);
const FORCE = args.includes("--force") || process.env.VR_FORCE === "1";
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[velocity-rank] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

// 200 -> parsed JSON, not found -> null, anything else THROWS: a transient
// error must never read as "this shard is empty"
async function readJson(key) {
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", token, useCache: false });
  if (!res || res.statusCode === 404) return null;
  if (res.statusCode !== 200 || !res.stream) throw new Error(`${key}: HTTP ${res.statusCode}`);
  return JSON.parse(await new Response(res.stream).text());
}

async function main() {
  const rhMeta = await readJson(`${RH}/meta.json`);
  const rhLast = [...(rhMeta?.days ?? [])].sort().at(-1) ?? null;
  if (!rhLast) {
    console.log("[velocity-rank] rank-history has no recorded day yet, skipping");
    return;
  }
  const prev = await readJson(`${PREFIX}/meta.json`).catch(() => null);
  if (!FORCE && prev?.lastTo === rhLast) {
    console.log(`[velocity-rank] already built through ${rhLast} (${prev.days} days), skipping`);
    return;
  }

  // every point of every repo: cold archive first, hot window second (the hot
  // copy wins a day both hold, as in rank-history.ts)
  const series = new Map(); // repo -> Map(day -> point)
  const merge = (s) => {
    for (const [repo, pts] of Object.entries(s?.series ?? {})) {
      let m = series.get(repo);
      if (!m) series.set(repo, (m = new Map()));
      for (const p of pts) m.set(p[0], p);
    }
  };
  const unread = [];
  const hot = [];
  let archives = 0;
  for (let i = 0; i < SHARDS; i++) {
    try {
      const a = await readJson(`${RH}/archive/shard-${i}.json`);
      if (a?.series) archives++;
      merge(a);
    } catch (e) {
      unread.push(`archive-${i}: ${e.message}`);
    }
    try {
      const h = await readJson(`${RH}/shard-${i}.json`);
      if (!h?.series) unread.push(`shard-${i}: missing`);
      hot.push(h);
    } catch (e) {
      unread.push(`shard-${i}: ${e.message}`);
    }
  }
  for (const h of hot) merge(h);
  // the archive is all or nothing: every shard has evicted days once the hot
  // window has rolled, so a few missing ones are a bad read, not "no history"
  if (archives > 0 && archives < SHARDS) unread.push(`${SHARDS - archives} archive shard(s) missing`);
  if (unread.length) {
    console.log(`[velocity-rank] REFUSED: ${unread.length} shard(s) unreadable (${unread.slice(0, 4).join("; ")}); the table stays as it was`);
    if (!OUT) await markPartial(FAMILY, { reason: `${unread.length} shards unreadable`, rhLast });
    return;
  }

  const days = buildDays([...series].map(([repo, m]) => [repo, [...m.values()]]));
  if (prev?.days && days.length < prev.days && !FORCE) {
    console.log(`[velocity-rank] REFUSED: ${days.length} days, the table had ${prev.days} (a short read?); re-run with --force if real`);
    if (!OUT) await markPartial(FAMILY, { reason: `${days.length} days < ${prev.days}`, rhLast });
    return;
  }

  // the length of each day's window, where both captures were stamped
  const at = rhMeta.capturedAt ?? {};
  for (const d of days) {
    const a = Date.parse(at[d.day] ?? "");
    const b = Date.parse(at[d.to] ?? "");
    d.hours = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 36e5 * 10) / 10 : null;
  }

  const months = new Map();
  for (const d of days) {
    const m = d.day.slice(0, 7);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(d);
  }
  const meta = {
    top: 1000,
    months: [...months.keys()],
    days: days.length,
    first: days[0]?.day ?? null,
    last: days.at(-1)?.day ?? null,
    lastN: days.at(-1)?.n ?? null, // the watchdog's completeness sensor
    lastTo: rhLast,
    builtAt: new Date().toISOString(),
  };

  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    for (const [m, list] of months) writeFileSync(join(OUT, `${m}.json`), JSON.stringify({ days: list }));
    writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta));
  } else {
    const { put } = await import("@vercel/blob");
    const opts = { access: "private", token, addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" };
    // months first, meta last: the meta is the commit point the page and the watchdog trust
    for (const [m, list] of months) await put(`${PREFIX}/${m}.json`, JSON.stringify({ days: list }), opts);
    await put(`${PREFIX}/meta.json`, JSON.stringify(meta), opts);
    await markComplete(FAMILY, { rhLast });
  }
  const last = days.at(-1);
  console.log(`[velocity-rank] ${days.length} days (${meta.first} .. ${meta.last}) in ${months.size} months · last day ranked ${last?.n ?? 0} repos · built through ${rhLast}`);
}

main().catch(async (e) => {
  // never break the collect run
  console.error(`[velocity-rank] failed (non-fatal): ${e?.message ?? e}`);
  // a local --out run must never open a production marker
  if (!OUT) await markPartial(FAMILY, { reason: String(e?.message ?? e).slice(0, 200) }).catch(() => {});
  process.exit(0);
});
