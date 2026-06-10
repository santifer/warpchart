#!/usr/bin/env node
// One-time onboarding for a tracked repo:
//   1. Repo metadata -> data/meta.json
//   2. FULL stargazer backwalk -> data/stargazer_timestamps.txt
//   3. Worldwide rank + milestone thresholds -> data/milestones.json
//   4. Initial highway snapshot (neighbors + velocities) -> data/history.jsonl
//
// Usage:
//   GH_TOKEN=... node collector/bootstrap.mjs [--repo owner/name] [--dry-run]
// --repo overrides (and persists to) mission.config.json.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, DATA_DIR, readConfig, repoMeta, backwalk, countAbove,
  nextMilestones, thresholdForRank, findNeighbors, reposVelocity, apexRepo, topRepos,
  buildForensics, token,
} from "./lib.mjs";

token(); // fail fast if missing

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const repoFlag = args.indexOf("--repo");
const repoOverride = repoFlag >= 0 ? args[repoFlag + 1] : null;

let config = readConfig();
if (repoOverride) {
  config = { ...config, repo: repoOverride };
  if (!dryRun) {
    writeFileSync(join(ROOT, "mission.config.json"), JSON.stringify(config, null, 2) + "\n");
  }
}
const [owner, name] = config.repo.split("/");
const now = new Date();
const nowISO = now.toISOString().replace(/\.\d+Z$/, "Z");

console.log(`[bootstrap] target: ${config.repo}`);

// 1. Metadata
const meta = await repoMeta(owner, name);
console.log(`[bootstrap] ${meta.nameWithOwner}: ${meta.stargazerCount} stars, created ${meta.createdAt}`);
if (meta.stargazerCount > 300_000) {
  console.log("[bootstrap] WARNING: very large repo, full backwalk will take a while (throttled).");
}

// 2. Full backwalk
console.log("[bootstrap] full stargazer backwalk...");
const expectedPages = Math.ceil(meta.stargazerCount / 100);
const { timestamps, complete, pages } = await backwalk(owner, name, {
  onProgress: (p, oldest) => {
    if (p % 20 === 0) console.log(`[bootstrap]   page ${p}/${expectedPages} (oldest so far: ${oldest})`);
  },
});
console.log(`[bootstrap] backwalk done: ${timestamps.length} timestamps in ${pages} pages (complete=${complete})`);

// 3. Rank + milestones
const rank = (await countAbove(meta.stargazerCount)) + 1;
console.log(`[bootstrap] worldwide rank: #${rank}`);
const milestoneRanks = nextMilestones(rank, 4);
const milestones = {};
for (const m of milestoneRanks) {
  milestones[m] = await thresholdForRank(m, meta.stargazerCount);
  console.log(`[bootstrap]   top ${m} threshold: ${milestones[m]} stars`);
}

// 4. Highway: neighbors + velocities
console.log("[bootstrap] measuring neighbors...");
const neighborNames = await findNeighbors(meta.nameWithOwner, meta.stargazerCount);
const neighbors = await reposVelocity(neighborNames, now);
console.log(`[bootstrap] ${neighbors.length} neighbors measured`);

// 5. Galactic core: current worldwide #1
const apex = await apexRepo();
if (apex) console.log(`[bootstrap] galactic core: ${apex.r} (${apex.s} stars)`);

// 6. Route landmarks: the worldwide top 1000
console.log("[bootstrap] fetching worldwide top 1000 (route landmarks)...");
const route = await topRepos();
console.log(`[bootstrap] route landmarks: ${route.length} repos`);

// 7. Spike forensics: correlate the repo's spikes with HN/Reddit/releases
console.log("[bootstrap] running spike forensics...");
const spikes = await buildForensics(meta.nameWithOwner, timestamps);
console.log(`[bootstrap] forensics: ${spikes.length} spike days analyzed`);

const snapshot = {
  ts: nowISO,
  stars: meta.stargazerCount,
  rank,
  milestones,
  neighbors,
  apex,
  meta: { new_ts: timestamps.length, pages, partial: !complete, bootstrap: true },
};

const metaOut = {
  repo: meta.nameWithOwner,
  owner: meta.owner.login,
  name,
  description: meta.description,
  created_at: meta.createdAt,
  avatar_url: meta.owner.avatarUrl,
  homepage: meta.homepageUrl,
  language: meta.primaryLanguage?.name ?? null,
  forks: meta.forkCount,
  bootstrapped_at: nowISO,
};

if (dryRun) {
  console.log("[bootstrap] DRY RUN, nothing written. Snapshot:");
  console.log(JSON.stringify(snapshot));
  process.exit(0);
}

mkdirSync(DATA_DIR, { recursive: true });
writeFileSync(join(DATA_DIR, "stargazer_timestamps.txt"), timestamps.join("\n") + "\n");
writeFileSync(
  join(DATA_DIR, "route.json"),
  JSON.stringify({ generated_at: nowISO, repos: route }) + "\n"
);
writeFileSync(
  join(DATA_DIR, "forensics.json"),
  JSON.stringify({ generated_at: nowISO, spikes }, null, 1) + "\n"
);
writeFileSync(join(DATA_DIR, "meta.json"), JSON.stringify(metaOut, null, 2) + "\n");
writeFileSync(
  join(DATA_DIR, "milestones.json"),
  JSON.stringify({ measured_at: nowISO, rank, milestones }, null, 2) + "\n"
);
// Bootstrap always starts a fresh history for the configured repo.
writeFileSync(join(DATA_DIR, "history.jsonl"), JSON.stringify(snapshot) + "\n");

console.log(`[bootstrap] OK. data/ seeded for ${meta.nameWithOwner}.`);
console.log(`[bootstrap]   timestamps: ${timestamps.length}`);
console.log(`[bootstrap]   rank: #${rank} | milestones: ${JSON.stringify(milestones)}`);
