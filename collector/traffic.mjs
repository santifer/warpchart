#!/usr/bin/env node
// Traffic Vault: snapshots each tracked repo's GitHub traffic (daily views,
// daily clones, top referrers) into the PRIVATE Blob (traffic/{owner--name}.json)
// and KEEPS it forever. GitHub deletes traffic data after 14 days and only the
// repo owner can read it, so this is an un-replicable, owner-token-gated moat:
// the core of the DevRel tier. Once a repo's history is in the vault it cannot
// be lost; the panel and attribution build on it.
//
// Per repo it needs a token with access to that repo's traffic (push/admin, or
// a fine-grained PAT with Administration: read). Resolution: TRAFFIC_TOKENS
// (JSON map repo->token), else a single TRAFFIC_TOKEN tried for every repo it
// can reach. No token, or a 403, just skips that repo (best-effort, never
// fatal). Idempotent by day; safe to run every collect.
//
// Usage: BLOB_READ_WRITE_TOKEN=... TRAFFIC_TOKEN=... node collector/traffic.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put, get } from "@vercel/blob";
import { DATA_DIR, readConfig } from "./lib.mjs";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log("[traffic] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

function tokenFor(repo) {
  try {
    if (process.env.TRAFFIC_TOKENS) {
      const map = JSON.parse(process.env.TRAFFIC_TOKENS);
      const k = Object.keys(map).find((x) => x.toLowerCase() === repo.toLowerCase());
      if (k && map[k]) return map[k];
    }
  } catch {
    /* malformed map: fall through to single token */
  }
  return process.env.TRAFFIC_TOKEN || null;
}

const blobKey = (repo) => `traffic/${repo.toLowerCase().replace("/", "--")}.json`;

async function readVault(repo) {
  try {
    const res = await get(blobKey(repo), { access: "private", token: blobToken });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text());
    }
  } catch {
    /* first run / transient */
  }
  return { repo, views: {}, clones: {}, referrers: [], referrersAt: null, updatedAt: null };
}

async function ghTraffic(repo, path, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}/traffic/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "warpchart-traffic",
    },
  });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// the repos we collect for: the house repo plus every paying tenant
const repos = new Set();
try {
  const house = readConfig()?.repo;
  if (house) repos.add(house);
} catch {
  /* no config */
}
try {
  const tenantsPath = join(DATA_DIR, "tenants.json");
  if (existsSync(tenantsPath)) {
    for (const t of JSON.parse(readFileSync(tenantsPath, "utf8"))) {
      if (t?.repo) repos.add(t.repo);
    }
  }
} catch {
  /* no tenants */
}

if (!repos.size) {
  console.log("[traffic] no repos to collect, skipping");
  process.exit(0);
}

let ok = 0;
let skipped = 0;
for (const repo of repos) {
  const token = tokenFor(repo);
  if (!token) {
    skipped++;
    continue;
  }
  try {
    const [views, clones, referrers] = await Promise.all([
      ghTraffic(repo, "views?per=day", token),
      ghTraffic(repo, "clones?per=day", token),
      ghTraffic(repo, "popular/referrers", token),
    ]);
    const vault = await readVault(repo);
    vault.views ??= {};
    vault.clones ??= {};
    // merge the 14-day daily series by date; the latest read of a day wins
    // (today's count keeps growing, so the most recent snapshot is authoritative)
    for (const v of views.views ?? []) {
      vault.views[v.timestamp.slice(0, 10)] = { c: v.count, u: v.uniques };
    }
    for (const c of clones.clones ?? []) {
      vault.clones[c.timestamp.slice(0, 10)] = { c: c.count, u: c.uniques };
    }
    // THE ONLY DEDUPLICATED HEADCOUNT GITHUB GIVES. The per-day rows above carry
    // per-DAY uniques: summing them counts one person once per day they showed
    // up, so a 72-day sum ran 3x the real figure (91,685 vs 29,837 on
    // 2026-08-13) and the public panel was labelling it "unique cloners".
    // These two top-level fields are deduplicated across the API's own 14-day
    // window and are the only numbers that may ever carry the word "unique".
    // They cannot be accumulated either: two 14-day windows overlap in people,
    // not just in days, so we keep the LATEST reading and its date, never a sum.
    vault.uniq14 = {
      cloners: clones?.uniques ?? null,
      visitors: views?.uniques ?? null,
      // the window GitHub actually answered for, so a stale vault is visible
      // rather than silently passing for today
      at: new Date().toISOString().slice(0, 10),
    };
    const stamp = new Date().toISOString();
    vault.referrers = (referrers ?? [])
      .slice(0, 10)
      .map((r) => ({ r: r.referrer, c: r.count, u: r.uniques }));
    vault.referrersAt = stamp.slice(0, 10);
    // Keep a PER-RUN history of referrer snapshots (one every ~2h). The 14-day
    // aggregate alone cannot pinpoint which domain drove a specific HOUR's spike;
    // diffing the two snapshots that bracket the spike can ("t.co jumped +1,400
    // the hour 67 stars landed"). collector/attribute.mjs consumes this. ~250
    // entries ≈ 3 weeks at the 2h cadence.
    vault.referrerHistory = vault.referrerHistory ?? [];
    vault.referrerHistory.push({ at: stamp, refs: vault.referrers });
    vault.referrerHistory = vault.referrerHistory.slice(-250);
    vault.updatedAt = stamp;

    await put(blobKey(repo), JSON.stringify(vault), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      token: blobToken,
    });
    ok++;
    console.log(
      `[traffic] ${repo}: ${Object.keys(vault.views).length} view-days, ${Object.keys(vault.clones).length} clone-days, ${vault.referrers.length} referrers (vault kept)`,
    );
  } catch (err) {
    skipped++;
    console.error(`[traffic] ${repo} skipped: ${err.message}`);
  }
}

console.log(`[traffic] done: ${ok} vaulted, ${skipped} skipped (no token or no access)`);
