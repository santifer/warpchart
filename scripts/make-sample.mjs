#!/usr/bin/env node
// Generate data-sample/ — a small, fully synthetic demo dataset so a FORK with
// no BLOB_READ_WRITE_TOKEN still builds and renders a believable console. The
// accumulated real history is the moat and never ships in git; this is a
// stand-in. Deterministic (fixed END date + seeded RNG) so re-runs produce the
// same bytes and git diffs stay clean. The public top-1000 route.json is copied
// verbatim (it is public GitHub star data, not the moat) so the "route to the
// core" band looks rich; only the house repo's per-event timeline is faked.
//
// Usage: node scripts/make-sample.mjs
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "data-sample");
mkdirSync(OUT, { recursive: true });

// fixed clock — deterministic sample
const END = Date.parse("2026-06-13T00:00:00Z");
const DAY = 86400e3;
const SPAN_DAYS = 160;
const START = END - SPAN_DAYS * DAY;

// seeded RNG (mulberry32) so the sample is reproducible
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(424242);

// ── per-day star counts: gentle baseline + a Show HN spike around day 112 ──
const timestamps = [];
for (let day = 0; day < SPAN_DAYS; day++) {
  let count = Math.max(0, Math.round(4 + 3 * Math.sin(day / 26) + (rnd() - 0.5) * 3));
  const spikeDist = Math.abs(day - 112);
  if (spikeDist < 7) count += Math.round(70 * Math.exp(-(spikeDist * spikeDist) / 6));
  for (let i = 0; i < count; i++) {
    const t = START + day * DAY + Math.floor(rnd() * DAY);
    timestamps.push(t);
  }
}
timestamps.sort((a, b) => a - b);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const STARS = timestamps.length; // net == cumulative for a clean demo
const RANK = 13800;

writeFileSync(join(OUT, "stargazer_timestamps.txt"), timestamps.map(iso).join("\n") + "\n");

// ── synthetic local neighbours (the band around the demo ship) ──
const neighbors = [
  { r: "astralforge/warpkit", s: STARS + 96, v: 5.1, d: "Composable starmap primitives for the web.", l: "TypeScript" },
  { r: "nebula-systems/flux-core", s: STARS + 54, v: 3.4, d: "Reactive dataflow engine with zero deps.", l: "Rust" },
  { r: "orbital-labs/driftwood", s: STARS + 21, v: 2.0, d: "Tiny composable state machines.", l: "Go" },
  { r: "lumen/atlas", s: STARS + 8, v: 1.6, d: "Geospatial tiles, batteries included.", l: "TypeScript" },
  { r: "pulsar/relay", s: STARS - 12, v: 2.7, d: "At-least-once event relay.", l: "Go" },
  { r: "cartograph/inkwell", s: STARS - 40, v: 1.1, d: "Markdown to print-quality PDF.", l: "Python" },
  { r: "meridian/sextant", s: STARS - 77, v: 0.9, d: "CLI charts for time series.", l: "Rust" },
  { r: "halcyon/driftnet", s: STARS - 130, v: 0.6, d: "Mesh discovery for local-first apps.", l: "C" },
];

// next milestone gates (rank -> star threshold) the demo is climbing toward
const milestonesMap = { "10000": STARS + 540, "5000": STARS + 2180, "2500": STARS + 5400, "1000": STARS + 12600 };

// ── route.json: copy the public top-1000 verbatim (not the moat) ──
let apex = { r: "codecrafters-io/build-your-own-x", s: 514823 };
for (const f of ["route.json", "route-prev.json"]) {
  const src = join(DATA, f);
  if (existsSync(src)) {
    copyFileSync(src, join(OUT, f));
    if (f === "route.json") {
      try {
        const repos = JSON.parse(readFileSync(src, "utf8")).repos;
        if (repos?.[0]) apex = { r: repos[0].r, s: repos[0].s };
      } catch {}
    }
  }
}

// ── history.jsonl: ~44 snapshots from day 0 to END ──
const SNAPS = 44;
const lines = [];
for (let i = 0; i < SNAPS; i++) {
  const idx = Math.min(timestamps.length - 1, Math.round(((i + 1) / SNAPS) * timestamps.length) - 1);
  const stars = idx + 1;
  const ts = iso(timestamps[idx]);
  // rank eases from ~60k down to RANK as the repo grows
  const frac = stars / STARS;
  const rank = Math.round(60000 - (60000 - RANK) * frac);
  lines.push(
    JSON.stringify({
      ts,
      stars,
      rank,
      milestones: milestonesMap,
      neighbors,
      apex,
      meta: { new_ts: Math.max(0, Math.round((rnd() - 0.2) * 30)), pages: 1, partial: false },
    }),
  );
}
writeFileSync(join(OUT, "history.jsonl"), lines.join("\n") + "\n");

// ── the rest ──
writeFileSync(
  join(OUT, "meta.json"),
  JSON.stringify(
    {
      repo: "warpchart/sample",
      owner: "warpchart",
      name: "sample",
      description: "Synthetic demo telemetry. A fork with no private data store renders this dataset.",
      created_at: iso(START),
      avatar_url: "https://avatars.githubusercontent.com/u/9919?v=4",
      homepage: "https://warpchart.dev",
      language: "TypeScript",
      forks: 87,
      bootstrapped_at: iso(END),
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(OUT, "milestones.json"),
  JSON.stringify({ measured_at: iso(END), rank: RANK, milestones: milestonesMap }, null, 2) + "\n",
);

writeFileSync(join(OUT, "tenants.json"), "[]\n");

writeFileSync(
  join(OUT, "collisions.json"),
  JSON.stringify(
    {
      generated_at: iso(END),
      baseline: { from: iso(END - DAY), to: iso(END), days: 1 },
      collisions: [],
      entrants: [],
    },
    null,
    2,
  ) + "\n",
);

const spikeDay = iso(START + 112 * DAY).slice(0, 10);
writeFileSync(
  join(OUT, "forensics.json"),
  JSON.stringify(
    {
      generated_at: iso(END),
      spikes: [
        {
          date: spikeDay,
          stars: 84,
          causes: [{ type: "hn", title: "Show HN: warpchart/sample", url: "https://news.ycombinator.com/", points: 312 }],
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

console.log(`[make-sample] wrote data-sample/: ${STARS} stars, rank ${RANK}, ${SNAPS} snapshots, ${timestamps.length} timestamps`);
