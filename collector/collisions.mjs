// Collision scanner: detects imminent overtakes inside the top 1000 by
// diffing two consecutive route registries (today vs the previous refresh),
// which yields a daily velocity for every repo at ZERO API cost. Crossings
// within 7 days get a "tweetability" score built from the narrative levers:
// fame of the victim, hunter momentum, imminence, age contrast and category
// rivalry. Output: data/collisions.json plus a human briefing on stdout.
//
//   node collector/collisions.mjs           # uses data/route-prev.json,
//                                           # falls back to git history
//
// Inside the hourly collector it runs only on the run that refreshes the
// route (once a day), right after the refresh.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DATA_DIR, ROOT, ghFetch, sleep } from "./lib.mjs";

const ROUTE = join(DATA_DIR, "route.json");
const ROUTE_PREV = join(DATA_DIR, "route-prev.json");
const OUT = join(DATA_DIR, "collisions.json");

const MAX_ETA_DAYS = 7;
const MIN_HUNTER_V = 25; // stars/day; below this, crossings are noise
const ENRICH_TOP = 22; // collisions that get created_at + twitter handles

// Household-name owners: a victim from this list is news on its own.
const BRANDS = new Set([
  "google", "facebook", "microsoft", "apple", "vercel", "jetbrains",
  "kubernetes", "torvalds", "rust-lang", "golang", "python", "nodejs",
  "django", "rails", "angular", "vuejs", "sveltejs", "tensorflow",
  "pytorch", "openai", "anthropics", "docker", "git", "mozilla", "redis",
  "elastic", "grafana", "prometheus", "ansible", "hashicorp", "stripe",
  "supabase", "denoland", "oven-sh", "astral-sh", "jquery", "expressjs",
  "swiftlang", "ziglang", "ohmyzsh", "neovim", "helix-editor", "ansible",
]);

function loadPrevRoute(current) {
  if (existsSync(ROUTE_PREV)) {
    const prev = JSON.parse(readFileSync(ROUTE_PREV, "utf8"));
    if (prev.generated_at !== current.generated_at) return prev;
  }
  // local fallback: walk git history for the last DIFFERENT registry
  try {
    const hashes = execSync("git log --format=%H -n 12 -- data/route.json", {
      cwd: ROOT, encoding: "utf8",
    }).trim().split("\n");
    for (const h of hashes) {
      const prev = JSON.parse(execSync(`git show ${h}:data/route.json`, {
        cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      }));
      const dt = (new Date(current.generated_at) - new Date(prev.generated_at)) / 864e5;
      if (dt >= 0.3) return prev;
    }
  } catch { /* no git here (CI shallow checkout) */ }
  return null;
}

function fameOf(rank, owner) {
  let fame = rank <= 25 ? 4 : rank <= 100 ? 3 : rank <= 300 ? 2.2 : rank <= 600 ? 1.5 : 1;
  if (BRANDS.has(owner.toLowerCase())) fame += 0.6;
  return fame;
}

function imminenceOf(etaDays) {
  return etaDays <= 1 ? 3 : etaDays <= 2 ? 2.2 : etaDays <= 3 ? 1.6 : etaDays <= 5 ? 1.2 : 1;
}

function fmtEta(days) {
  return days < 1 ? `${Math.max(1, Math.round(days * 24))}h` : `${days.toFixed(1)}d`;
}

function ageLabel(createdAt) {
  if (!createdAt) return null;
  const days = (Date.now() - new Date(createdAt)) / 864e5;
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 540) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(0)}y`;
}

export async function runCollisionScan({ enrich = true, force = false } = {}) {
  const current = JSON.parse(readFileSync(ROUTE, "utf8"));
  // Idempotent per registry generation. The scan runs as its own step now (it
  // needs velocity7's `v7` to exist first), so the 2-hourly cron would other-
  // wise re-scan and re-enrich the same registry all day for nothing.
  if (!force && existsSync(OUT)) {
    try {
      const done = JSON.parse(readFileSync(OUT, "utf8"));
      if (done?.baseline?.to && done.baseline.to === current.generated_at) {
        console.log(`[collisions] already scanned registry ${current.generated_at}, skipping`);
        return done;
      }
    } catch { /* unreadable output: just rescan */ }
  }
  const prev = loadPrevRoute(current);
  if (!prev) {
    console.log("[collisions] no previous registry yet, baseline pending");
    return null;
  }
  const days = (new Date(current.generated_at) - new Date(prev.generated_at)) / 864e5;
  if (days < 0.25) {
    console.log(`[collisions] baseline too fresh (${(days * 24).toFixed(1)}h), skipping`);
    return null;
  }

  const prevStars = new Map(prev.repos.map((p) => [p.r.toLowerCase(), p.s]));
  // ascending by stars so "victims ahead" are simply the next entries
  const repos = current.repos
    .map((p, i) => {
      const was = prevStars.get(p.r.toLowerCase());
      return {
        r: p.r, s: p.s, l: p.l ?? null, d: p.d ?? null, rank: i + 1,
        // prefer the stable 7-day rate (velocity7.mjs) over the noisy ~1-day
        // delta, so the overtake scan / threat label agree with the charts
        v: p.v7 ?? (was !== undefined ? (p.s - was) / days : null),
        isNew: was === undefined,
      };
    })
    .sort((a, b) => a.s - b.s);

  const entrants = repos.filter((p) => p.isNew).map((p) => ({ r: p.r, s: p.s, rank: p.rank }));

  const collisions = [];
  for (let i = 0; i < repos.length; i++) {
    const hunter = repos[i];
    if (hunter.v === null || hunter.v < MIN_HUNTER_V) continue;
    for (let k = i + 1; k < repos.length; k++) {
      const victim = repos[k];
      const gap = victim.s - hunter.s;
      if (gap > hunter.v * MAX_ETA_DAYS) break; // every later victim is farther
      if (victim.v === null) continue;
      const closing = hunter.v - victim.v;
      // marginal closings flap with daily noise; demand a real speed gap
      if (closing < Math.max(8, hunter.v * 0.15)) continue;
      const etaDays = gap / closing;
      if (etaDays > MAX_ETA_DAYS || gap < 3) continue;
      const sameLang = !!hunter.l && hunter.l === victim.l;
      const owner = victim.r.split("/")[0];
      const score =
        fameOf(victim.rank, owner) *
        imminenceOf(etaDays) *
        (Math.log10(Math.max(hunter.v, 10)) / 1.5) *
        (sameLang ? 1.3 : 1);
      collisions.push({
        hunter: { r: hunter.r, s: hunter.s, v: Math.round(hunter.v), l: hunter.l, rank: hunter.rank },
        victim: { r: victim.r, s: victim.s, v: Math.round(victim.v), l: victim.l, rank: victim.rank },
        gap,
        etaDays: Math.round(etaDays * 100) / 100,
        eta: fmtEta(etaDays),
        sameLang,
        score: Math.round(score * 100) / 100,
        angles: [],
      });
    }
  }
  collisions.sort((a, b) => b.score - a.score);

  // multi-overtake: one hunter crossing 3+ victims inside 3 days is its own
  // story, boost every leg
  const byHunter = new Map();
  for (const c of collisions) {
    if (c.etaDays <= 3) byHunter.set(c.hunter.r, (byHunter.get(c.hunter.r) ?? 0) + 1);
  }
  for (const c of collisions) {
    const kills = byHunter.get(c.hunter.r) ?? 0;
    if (kills >= 3) {
      c.angles.push(`multi-overtake: ${kills} repos in 3 days`);
      c.score = Math.round(c.score * 1.4 * 100) / 100;
    }
    if (c.victim.rank <= 100) c.angles.push("giant down");
    if (c.sameLang) c.angles.push(`category rivalry (${c.victim.l})`);
  }
  collisions.sort((a, b) => b.score - a.score);

  // enrichment: ages + X handles for the top stories only (a few dozen
  // REST calls, far inside the hourly token budget)
  if (enrich) {
    const top = collisions.slice(0, ENRICH_TOP);
    const repoSet = new Set();
    const ownerSet = new Set();
    for (const c of top) {
      repoSet.add(c.hunter.r);
      repoSet.add(c.victim.r);
      ownerSet.add(c.hunter.r.split("/")[0]);
      ownerSet.add(c.victim.r.split("/")[0]);
    }
    const ages = new Map();
    for (const r of repoSet) {
      try {
        const meta = await ghFetch(`/repos/${r}`);
        ages.set(r, meta.created_at);
      } catch { /* best effort */ }
      await sleep(250);
    }
    const handles = new Map();
    for (const o of ownerSet) {
      try {
        const u = await ghFetch(`/users/${o}`);
        if (u.twitter_username) handles.set(o, u.twitter_username);
      } catch { /* best effort */ }
      await sleep(250);
    }
    for (const c of top) {
      c.hunter.created = ages.get(c.hunter.r) ?? null;
      c.victim.created = ages.get(c.victim.r) ?? null;
      c.hunter.age = ageLabel(c.hunter.created);
      c.victim.age = ageLabel(c.victim.created);
      c.hunter.x = handles.get(c.hunter.r.split("/")[0]) ?? null;
      c.victim.x = handles.get(c.victim.r.split("/")[0]) ?? null;
      if (c.hunter.created && c.victim.created) {
        const hDays = (Date.now() - new Date(c.hunter.created)) / 864e5;
        const vDays = (Date.now() - new Date(c.victim.created)) / 864e5;
        if (hDays < 400 && vDays / hDays >= 4) {
          c.angles.push(`young gun: ${c.hunter.age} vs ${c.victim.age}`);
          c.score = Math.round(c.score * 1.25 * 100) / 100;
        }
      }
    }
    collisions.sort((a, b) => b.score - a.score);
  }

  const out = {
    generated_at: new Date().toISOString(),
    baseline: { from: prev.generated_at, to: current.generated_at, days: Math.round(days * 100) / 100 },
    collisions,
    entrants,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

  // human briefing: top stories by score, then EVERYTHING imminent. A
  // same-day crossing between two famous neighbors can carry a mid score
  // (fame x momentum) and still be the best story of the day; the imminent
  // section guarantees it is never silently dropped (lesson: swift vs
  // paperclip, 11 stars apart, invisible in the score top 10).
  const line = (c) => {
    const hx = c.hunter.x ? ` @${c.hunter.x}` : "";
    const vx = c.victim.x ? ` @${c.victim.x}` : "";
    return (
      `  ${c.score.toFixed(1).padStart(5)} · ${c.hunter.r}${hx} (${c.hunter.v}/d${c.hunter.age ? ", " + c.hunter.age : ""})` +
      ` overtakes ${c.victim.r}${vx} (#${c.victim.rank}${c.victim.age ? ", " + c.victim.age : ""}) in ${c.eta}` +
      (c.angles.length ? ` · ${c.angles.join(" · ")}` : "") +
      `\n         watch: warpchart.dev/r/${c.victim.r}`
    );
  };
  console.log(`\n[collisions] ${collisions.length} crossings <= ${MAX_ETA_DAYS}d · baseline ${out.baseline.days}d · ${entrants.length} new top-1000 entrants\n`);
  const top = collisions.slice(0, 10);
  for (const c of top) console.log(line(c));
  const imminent = collisions
    .filter((c) => c.etaDays <= 1 && !top.includes(c))
    .sort((a, b) => a.etaDays - b.etaDays)
    .slice(0, 8);
  if (imminent.length) {
    console.log(`\n  IMMINENT (<24h, beyond the score top 10):`);
    for (const c of imminent) console.log(line(c));
  }

  // Pre-warm the day's top stories: when the overtake tweet goes out, both the
  // victim's page (where the hunter shows orange) and its curve/embed are
  // already hot for the crowd. Lives here, next to the data that decides which
  // stories matter, rather than in the caller.
  const base = (process.env.WARM_BASE_URL ?? "").replace(/\/$/, "");
  if (base && collisions.length) {
    const targets = new Set();
    for (const c of collisions.slice(0, 3)) {
      targets.add(c.victim.r);
      targets.add(c.hunter.r);
    }
    for (const r of targets) {
      const q = encodeURIComponent(r);
      for (const path of [`/r/${r}`, `/api/curve?repo=${q}`, `/api/chart?repo=${q}`]) {
        try {
          await fetch(`${base}${path}`);
        } catch { /* best effort */ }
        await sleep(1500);
      }
    }
    console.log(`[collisions] stories warmed: ${targets.size} repos`);
  }
  return out;
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith("collisions.mjs")) {
  runCollisionScan({
    enrich: !process.argv.includes("--no-enrich"),
    force: process.argv.includes("--force"),
  }).catch((err) => {
    console.error(`[collisions] failed: ${err.message}`);
    process.exit(1);
  });
}
