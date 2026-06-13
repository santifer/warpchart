#!/usr/bin/env node
// Frequent LIVE snapshot to Vercel Blob — the freshness layer for paid
// tenants (and the house). For each tracked repo, write the current
// stars / rank / velocity / neighbors / milestones to
// live/{owner}--{name}.json in the PUBLIC warpchart-data store. There is NO
// git commit and NO Vercel build here: the app reads this blob (edge-cached
// 60s) as the latest snapshot, so paid consoles paint near-real-time instead
// of the ~2h committed cadence. Cheap: ~6 GitHub calls per repo, no backwalk.
//
// Usage: GH_TOKEN=... BLOB_READ_WRITE_TOKEN=... node collector/live.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { put } from "@vercel/blob";
import {
  DATA_DIR, readConfig, repoMeta, countAbove,
  nextMilestones, thresholdForRank, findNeighbors, reposVelocity, apexRepo, token,
} from "./lib.mjs";

token(); // GitHub token: fail fast
const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.error("Missing BLOB_READ_WRITE_TOKEN");
  process.exit(1);
}

// the house repo plus every paying tenant (best effort: a missing or torn
// tenants.json just means "house only")
const config = readConfig();
const repos = [config.repo];
const tenantsPath = join(DATA_DIR, "tenants.json");
if (existsSync(tenantsPath)) {
  try {
    for (const t of JSON.parse(readFileSync(tenantsPath, "utf8"))) {
      if (t?.repo && !repos.some((r) => r.toLowerCase() === t.repo.toLowerCase())) {
        repos.push(t.repo);
      }
    }
  } catch (err) {
    console.error(`tenants.json read failed: ${err.message}`);
  }
}

const nowISO = new Date().toISOString().replace(/\.\d+Z$/, "Z");
// the worldwide #1 is global truth: fetch once and stamp it on every snapshot
let apex = null;
try {
  apex = await apexRepo();
} catch (err) {
  console.error(`[live] apex: ${err.message}`);
}

let ok = 0;
for (const repo of repos) {
  try {
    const [owner, name] = repo.split("/");
    const meta = await repoMeta(owner, name);
    const stars = meta.stargazerCount;
    const rank = (await countAbove(stars)) + 1;

    // rank-adjacent band with live velocities (best effort: failure keeps the
    // last good neighbors via the app's committed fallback)
    let neighbors = null;
    try {
      const names = await findNeighbors(meta.nameWithOwner, stars);
      neighbors = await reposVelocity(names);
    } catch (err) {
      console.error(`[live] ${repo} neighbors: ${err.message}`);
    }

    // next milestone thresholds (best effort)
    let milestones = null;
    try {
      milestones = {};
      for (const m of nextMilestones(rank, 4)) {
        milestones[m] = await thresholdForRank(m, stars);
      }
    } catch (err) {
      console.error(`[live] ${repo} milestones: ${err.message}`);
      milestones = null;
    }

    const snapshot = { ts: nowISO, stars, rank, milestones, neighbors, apex };
    const key = `live/${repo.toLowerCase().replace("/", "--")}.json`;
    await put(key, JSON.stringify(snapshot), {
      access: "private", // the moat: nothing is publicly fetchable
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
      token: blobToken,
    });
    console.log(`[live] ${repo}: ${stars} #${rank} (${neighbors?.length ?? 0} neighbors) -> ${key}`);
    ok++;
  } catch (err) {
    console.error(`[live] ${repo} failed: ${err.message}`);
  }
}

console.log(`[live] wrote ${ok}/${repos.length} snapshots.`);
if (ok === 0) process.exit(1);
