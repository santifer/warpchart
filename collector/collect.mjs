#!/usr/bin/env node
// Hourly snapshot collector. Incremental and cheap:
//   1. Current stars + worldwide rank (essential: failure -> exit 1, no write)
//   2. Milestone thresholds (best effort)
//   3. Incremental stargazer backwalk since last known timestamp (best effort)
//   4. Neighbors + velocities (best effort)
//   5. Append one JSONL line to data/history.jsonl, refresh data/meta.json
//
// Usage: GH_TOKEN=... node collector/collect.mjs [--dry-run]

import { readFileSync, writeFileSync, appendFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_DIR, readConfig, repoMeta, backwalk, countAbove,
  nextMilestones, thresholdForRank, findNeighbors, reposVelocity, apexRepo, topRepos,
  buildForensics, token,
} from "./lib.mjs";

token(); // fail fast

const dryRun = process.argv.includes("--dry-run");
const config = readConfig();
const [owner, name] = config.repo.split("/");
const now = new Date();
const nowISO = now.toISOString().replace(/\.\d+Z$/, "Z");

const tsPath = join(DATA_DIR, "stargazer_timestamps.txt");
const historyPath = join(DATA_DIR, "history.jsonl");
if (!existsSync(tsPath)) {
  console.error("data/stargazer_timestamps.txt not found. Run collector/bootstrap.mjs first.");
  process.exit(1);
}

let partial = false;

// 1. Essential: stars + rank
const meta = await repoMeta(owner, name);
const stars = meta.stargazerCount;
const rank = (await countAbove(stars)) + 1;
console.log(`[collect] ${meta.nameWithOwner}: ${stars} stars, rank #${rank}`);

// 2. Milestones (best effort)
let milestones = null;
try {
  milestones = {};
  for (const m of nextMilestones(rank, 4)) {
    milestones[m] = await thresholdForRank(m, stars);
  }
} catch (err) {
  console.error(`[collect] milestones failed: ${err.message}`);
  milestones = null;
  partial = true;
}

// 3. Incremental backwalk (best effort)
let newTimestamps = [];
let pages = 0;
let walkComplete = true;
try {
  const lines = readFileSync(tsPath, "utf8").trimEnd().split("\n");
  const lastKnown = lines[lines.length - 1];
  const walk = await backwalk(owner, name, { stopAfter: lastKnown, maxPages: 30 });
  newTimestamps = walk.timestamps;
  pages = walk.pages;
  walkComplete = walk.complete;
  if (!walkComplete) partial = true;
  console.log(`[collect] +${newTimestamps.length} new star timestamps (${pages} pages, complete=${walkComplete})`);
} catch (err) {
  console.error(`[collect] backwalk failed: ${err.message}`);
  partial = true;
}

// 4. Neighbors (best effort)
let neighbors = null;
try {
  const names = await findNeighbors(meta.nameWithOwner, stars);
  neighbors = await reposVelocity(names, now);
  // reposVelocity returns null where GitHub no longer lets us count a foreign
  // repo's recent stars. Fill those from the registry's canonical 7-day rate,
  // which is measured from OUR OWN daily snapshots and needs no permission.
  // Doing it HERE means the snapshot on disk is already right, instead of every
  // reader having to remember to patch it (one that forgot is what put a row of
  // zeroes in front of Santiago on 2026-07-28).
  let filled = 0;
  try {
    const routeNow = JSON.parse(readFileSync(join(DATA_DIR, "route.json"), "utf8"));
    const canon = new Map((routeNow.repos ?? []).map((p) => [p.r.toLowerCase(), p.v7 ?? p.v ?? null]));
    neighbors = neighbors.map((n) => {
      if (n.v != null) return n;
      const c = canon.get(n.r.toLowerCase());
      if (c == null) return n;
      filled++;
      return { ...n, v: c };
    });
  } catch { /* no registry yet: leave the nulls, they are honest */ }
  const unknown = neighbors.filter((n) => n.v == null).length;
  console.log(
    `[collect] ${neighbors.length} neighbors measured` +
      (filled ? ` · ${filled} from the registry (stargazer listing closed)` : "") +
      (unknown ? ` · ${unknown} still unknown` : ""),
  );
} catch (err) {
  console.error(`[collect] neighbors failed: ${err.message}`);
  neighbors = null;
  partial = true;
  // Carry the last surviving membership forward: the live API refreshes the
  // counts anyway, but a null list freezes the whole local band in the UI.
  try {
    const lines = readFileSync(historyPath, "utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 48; i--) {
      const prev = JSON.parse(lines[i]);
      if (prev.neighbors?.length) {
        neighbors = prev.neighbors;
        console.log(`[collect] neighbors carried forward from ${prev.ts}`);
        break;
      }
    }
  } catch { /* keep null */ }
}

// 5. Galactic core: current worldwide #1 (best effort)
let apex = null;
try {
  apex = await apexRepo();
} catch (err) {
  console.error(`[collect] apex failed: ${err.message}`);
}

// 6. Route landmarks (top 1000): refresh at most once a day (best effort).
const routePath = join(DATA_DIR, "route.json");
let routeRefreshed = false;
try {
  let staleRoute = true;
  if (existsSync(routePath)) {
    const prev = JSON.parse(readFileSync(routePath, "utf8"));
    staleRoute = now - new Date(prev.generated_at) > 20 * 3600 * 1000;
  }
  if (staleRoute) {
    const route = await topRepos();
    // Daily velocity for every routed repo, free: diff against the
    // outgoing registry. It colors the whole galaxy (doppler dots) without
    // a single API call; the local band still measures live.
    let withV = route;
    try {
      if (existsSync(routePath)) {
        const prev = JSON.parse(readFileSync(routePath, "utf8"));
        const prevStars = new Map((prev.repos ?? []).map((p) => [p.r.toLowerCase(), p.s]));
        const days = (now - new Date(prev.generated_at)) / 864e5;
        if (days > 0.25) {
          withV = route.map((p) => {
            const was = prevStars.get(p.r.toLowerCase());
            return was === undefined
              ? p
              : { ...p, v: Math.round(((p.s - was) / days) * 10) / 10 };
          });
          console.log(`[collect] route velocities computed over ${days.toFixed(2)}d`);
        }
      }
    } catch (err) {
      console.error(`[collect] route velocity diff failed: ${err.message}`);
    }
    if (!dryRun) {
      // keep the outgoing registry: today vs yesterday is the collision
      // scanner's zero-cost velocity source for all 1000 repos
      if (existsSync(routePath)) copyFileSync(routePath, join(DATA_DIR, "route-prev.json"));
      writeFileSync(routePath, JSON.stringify({ generated_at: nowISO, repos: withV }) + "\n");
    }
    routeRefreshed = true;
    console.log(`[collect] route landmarks refreshed: ${route.length} repos`);
  }
} catch (err) {
  console.error(`[collect] route refresh failed: ${err.message}`);
}

// 6b. The collision scan USED to run here, and that was a real bug: this point
// is BEFORE velocity7.mjs writes `v7`, so every overtake was scored with the
// noisy ~1-day rate while the rest of the site showed the stable 7-day one.
// The public API contradicted itself as a result (worldmonitor read 1842/d on
// /api/v1/velocity and 640/d on /api/v1/overtakes, 2026-07-27). It now runs as
// its own workflow step after velocity7, so it inherits the canonical rate.

// 7. Spike forensics: refresh at most once a day (best effort).
const forensicsPath = join(DATA_DIR, "forensics.json");
try {
  let staleForensics = true;
  if (existsSync(forensicsPath)) {
    const prev = JSON.parse(readFileSync(forensicsPath, "utf8"));
    staleForensics = now - new Date(prev.generated_at) > 20 * 3600 * 1000;
  }
  if (staleForensics) {
    const allTs = readFileSync(tsPath, "utf8").trimEnd().split("\n");
    const spikes = await buildForensics(meta.nameWithOwner, allTs);
    if (!dryRun) writeFileSync(forensicsPath, JSON.stringify({ generated_at: nowISO, spikes }, null, 1) + "\n");
    console.log(`[collect] forensics refreshed: ${spikes.length} spike days analyzed`);
  }
} catch (err) {
  console.error(`[collect] forensics failed: ${err.message}`);
}

// (alerts run at the end of the script, after the new snapshot is appended)

const snapshot = {
  ts: nowISO,
  stars,
  rank,
  milestones,
  neighbors,
  apex,
  meta: { new_ts: newTimestamps.length, pages, partial },
};

if (dryRun) {
  console.log("[collect] DRY RUN, nothing written. Snapshot:");
  console.log(JSON.stringify(snapshot));
  process.exit(0);
}

if (newTimestamps.length) appendFileSync(tsPath, newTimestamps.join("\n") + "\n");
appendFileSync(historyPath, JSON.stringify(snapshot) + "\n");

// Refresh public-facing metadata (description/homepage may change).
const metaOutPath = join(DATA_DIR, "meta.json");
try {
  const prev = existsSync(metaOutPath) ? JSON.parse(readFileSync(metaOutPath, "utf8")) : {};
  writeFileSync(metaOutPath, JSON.stringify({
    ...prev,
    repo: meta.nameWithOwner,
    owner: meta.owner.login,
    name,
    description: meta.description,
    avatar_url: meta.owner.avatarUrl,
    homepage: meta.homepageUrl,
    language: meta.primaryLanguage?.name ?? null,
    forks: meta.forkCount,
    created_at: meta.createdAt,
  }, null, 2) + "\n");
} catch (err) {
  console.error(`[collect] meta.json refresh failed: ${err.message}`);
}

console.log(`[collect] snapshot appended (partial=${partial}).`);

// HOSTED MISSIONS: every paying repo in data/tenants.json gets the same
// exact treatment as the house repo: incremental timestamp backwalk plus a
// summary line per run. Missing file or empty list = zero cost. A tenant
// failing never poisons the run (their last data simply carries forward).
// First run on a new tenant walks up to 200 pages (~20K stars); deeper
// repos finish across the next runs incrementally.
try {
  const tenantsPath = join(DATA_DIR, "tenants.json");
  const tenants = existsSync(tenantsPath) ? JSON.parse(readFileSync(tenantsPath, "utf8")) : [];
  for (const t of tenants) {
    try {
      const [tOwner, tName] = t.repo.split("/");
      const tDir = join(DATA_DIR, "tenants", `${tOwner}--${tName}`.toLowerCase());
      mkdirSync(tDir, { recursive: true });
      const tMeta = await repoMeta(tOwner, tName);
      const tRank = (await countAbove(tMeta.stargazerCount)) + 1;
      const tTsPath = join(tDir, "stargazer_timestamps.txt");
      let newTs = [];
      if (existsSync(tTsPath)) {
        const lines = readFileSync(tTsPath, "utf8").trimEnd().split("\n");
        const walk = await backwalk(tOwner, tName, { stopAfter: lines[lines.length - 1], maxPages: 30 });
        newTs = walk.timestamps;
      } else {
        const walk = await backwalk(tOwner, tName, { maxPages: 200 });
        newTs = walk.timestamps;
      }
      if (!dryRun) {
        if (newTs.length) appendFileSync(tTsPath, newTs.join("\n") + "\n");
        appendFileSync(
          join(tDir, "history.jsonl"),
          JSON.stringify({ ts: nowISO, stars: tMeta.stargazerCount, rank: tRank }) + "\n"
        );
      }
      console.log(`[collect] tenant ${t.repo}: ${tMeta.stargazerCount} stars #${tRank} (+${newTs.length} ts)`);
    } catch (err) {
      console.error(`[collect] tenant ${t.repo} failed: ${err.message}`);
    }
  }
} catch (err) {
  console.error(`[collect] tenants pass failed: ${err.message}`);
}

// Optional alerts to a Discord/Slack webhook (secret ALERT_WEBHOOK_URL).
// Compares the two most recent snapshots, so it runs AFTER the append.
try {
  if (process.env.ALERT_WEBHOOK_URL) {
    const history = readFileSync(historyPath, "utf8").trimEnd().split("\n");
    if (history.length >= 2) {
      const a = JSON.parse(history[history.length - 2]);
      const b = JSON.parse(history[history.length - 1]);
      const lines = [];
      for (const m of Object.keys(b.milestones ?? {}).map(Number)) {
        if (a.rank > m && b.rank <= m) lines.push(`entered the worldwide top ${m} (rank #${b.rank})`);
      }
      if (a.neighbors?.length && b.neighbors?.length) {
        const prevN = new Map(a.neighbors.map((n) => [n.r, n.s]));
        for (const n of b.neighbors) {
          const pS = prevN.get(n.r);
          if (pS !== undefined && pS > a.stars && n.s <= b.stars) {
            lines.push(`passed ${n.r} (${n.s.toLocaleString("en-US")} stars)`);
          }
        }
      }
      if (lines.length) {
        const url = process.env.ALERT_WEBHOOK_URL;
        const text = lines.map((l) => `▸ ${meta.nameWithOwner}: ${l}`).join("\n");
        const body = url.includes("hooks.slack.com") ? { text } : { content: text };
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        console.log(`[collect] alert sent (${lines.length} events)`);
      }
    }
  }
} catch (err) {
  console.error(`[collect] alert failed: ${err.message}`);
}

// Optional daily cache warm (repo variable WARM_BASE_URL): pre-render the
// high-probability charts and explorer pages so no visitor ever pays the
// cold sampling cost for them. The warm list is small on purpose: the
// landing's featured ranks, our live neighbors and the route landmarks.
// The long tail stays lazy; the power law makes its cache hit rate high.
try {
  const base = (process.env.WARM_BASE_URL ?? "").replace(/\/$/, "");
  if (base && !dryRun) {
    const hour = new Date().getUTCHours();
    if (hour >= 4 && hour < 5) {
      const targets = new Set();
      try {
        const route = JSON.parse(readFileSync(routePath, "utf8")).repos ?? [];
        for (const i of [0, 7, 24, 79, 199, 499]) if (route[i]) targets.add(route[i].r);
      } catch { /* no route yet */ }
      for (const n of neighbors ?? []) targets.add(n.r);
      let warmed = 0;
      for (const r of targets) {
        try {
          const res = await fetch(`${base}/api/chart?repo=${encodeURIComponent(r)}&w=800&h=240`);
          if (res.ok) warmed++;
          await new Promise((ok) => setTimeout(ok, 1500));
        } catch { /* best effort */ }
      }
      console.log(`[collect] cache warmed: ${warmed}/${targets.size} charts`);
    }
  }
} catch (err) {
  console.error(`[collect] warm failed: ${err.message}`);
}

// Daily spotlight warm: the landing's protagonist changes with the route
// registry's date, so right after a route refresh we pre-build its whole
// surface (explorer page, curve, embed, OG card). Sequential with pauses
// and gated on routeRefreshed: it never overlaps the 04 UTC warm above.
try {
  const base = (process.env.WARM_BASE_URL ?? "").replace(/\/$/, "");
  if (base && !dryRun && routeRefreshed) {
    const route = JSON.parse(readFileSync(routePath, "utf8"));
    const day = (route.generated_at ?? "").slice(0, 10) || "fallback";
    // selection must MATCH src/lib/demo.ts (seedFrom + band 80..680)
    const text = "spotlight::" + day;
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    const idx = 80 + ((h >>> 0) % 600);
    const hero = route.repos?.[idx]?.r;
    if (hero) {
      const q = encodeURIComponent(hero);
      for (const path of [`/r/${hero}`, `/api/curve?repo=${q}`, `/api/chart?repo=${q}`, `/api/og?repo=${q}`]) {
        try {
          await fetch(`${base}${path}`);
        } catch { /* best effort */ }
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      console.log(`[collect] spotlight warmed: ${hero} (#${idx + 1})`);
    }
  }
} catch (err) {
  console.error(`[collect] spotlight warm failed: ${err.message}`);
}
