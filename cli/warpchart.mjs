#!/usr/bin/env node
// warpchart — growth telemetry for any GitHub repository, in your terminal.
//   npx warpchart owner/name        a star chart + worldwide rank in the console
//   npx warpchart owner/name --json raw JSON (agent friendly)
//   npx warpchart velocity [N]      the fastest-growing repos right now
//
// Reads the public, cache-only Warpchart API (no auth, no GitHub token). The
// chart is drawn with braille dots, so it stays crisp at any terminal size.
const BASE = process.env.WARPCHART_BASE || "https://warpchart.dev";

// ── colour (off when piped or NO_COLOR) ──
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes("--no-color");
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const accent = (s) => c("38;5;45", s); // cyan
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const warn = (s) => c("38;5;214", s); // amber
const fmt = (n) => Number(n).toLocaleString("en-US");

async function getJSON(path) {
  const res = await fetch(BASE + path, { headers: { Accept: "application/json", "User-Agent": "warpchart-cli" } });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch {}
    const e = new Error(detail || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// ── braille line chart: 2x4 dots per char, connected vertical segments ──
function braille(values, w, h) {
  const cols = w * 2, rows = h * 4;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const sample = [];
  for (let i = 0; i < cols; i++) {
    const p = (i / (cols - 1)) * (values.length - 1);
    const lo = Math.floor(p), hi = Math.ceil(p), f = p - lo;
    sample.push(values[lo] * (1 - f) + values[hi] * f);
  }
  const grid = Array.from({ length: h }, () => new Array(w).fill(0));
  const DOT = [[0x01, 0x02, 0x04, 0x40], [0x08, 0x10, 0x20, 0x80]];
  let prev = null;
  for (let x = 0; x < cols; x++) {
    const row = Math.round((1 - (sample[x] - min) / span) * (rows - 1));
    const a = prev === null ? row : Math.min(prev, row);
    const b = prev === null ? row : Math.max(prev, row);
    for (let r = a; r <= b; r++) grid[r >> 2][x >> 1] |= DOT[x & 1][r & 3];
    prev = row;
  }
  return grid.map((r) => r.map((v) => String.fromCharCode(0x2800 + v)).join("")).join("\n");
}

function chartWidth() {
  return Math.max(24, Math.min((process.stdout.columns || 80) - 6, 72));
}

function trend(v) {
  if (v == null) return "";
  return v > 0 ? `▲ ${v}/day` : `${v}/day`;
}

async function repoView(repo, asJson) {
  const stats = await getJSON(`/api/v1/repo?repo=${encodeURIComponent(repo)}`);
  if (asJson) { process.stdout.write(JSON.stringify(stats, null, 2) + "\n"); return; }

  const canon = stats.repo || repo;
  console.log();
  console.log("  " + accent("◤ WARPCHART") + dim("  ·  ") + bold(canon));
  const v = stats.velocityPerDay;
  const line = `  ${dim("RANK")} ${accent("#" + fmt(stats.rank))}    ${dim("STARS")} ${bold(fmt(stats.stars))}    ${v != null ? accent(trend(v)) : ""}`;
  console.log(line);
  console.log();

  // chart
  try {
    const curve = await getJSON(`/api/curve?repo=${encodeURIComponent(repo)}`);
    const pts = (curve.pts || []).map((p) => p.v);
    if (pts.length > 2) {
      const w = chartWidth();
      const art = braille(pts, w, 7);
      for (const row of art.split("\n")) console.log("  " + accent(row));
      const first = new Date(curve.pts[0].t).getUTCFullYear();
      console.log("  " + dim(`${first}`) + dim(" ".repeat(Math.max(1, w - 12))) + dim("now · " + fmt(curve.total) + "★"));
      console.log();
    }
  } catch { /* chart is best-effort */ }

  if (stats.nextGate) {
    console.log("  " + dim("next gate ") + accent("top " + stats.nextGate.rank) + dim(" · ") + bold(fmt(stats.nextGate.gap)) + dim(" ★ to go"));
  }
  const ahead = (stats.ahead || []).slice(0, 3).map((n) => `${n.repo.split("/")[1]} ${dim("+" + fmt(n.gap))}`);
  if (ahead.length) console.log("  " + dim("ahead ") + ahead.join(dim("  ·  ")));
  console.log("  " + dim("→ ") + accent(stats.url));
  console.log();
}

async function velocityView(limit) {
  const { fastest } = await getJSON(`/api/v1/velocity?limit=${limit || 15}`);
  console.log();
  console.log("  " + accent("◤ WARPCHART") + dim("  ·  fastest systems right now"));
  console.log();
  for (const f of fastest) {
    const rank = dim("#" + String(f.rank).padStart(4));
    const name = bold(f.repo.padEnd(34).slice(0, 34));
    console.log(`  ${rank}  ${name} ${accent("▲ " + f.velocityPerDay + "/day")}`);
  }
  console.log();
}

const HELP = `
  ${accent("◤ WARPCHART")} — growth telemetry for any GitHub repo, in your terminal

  ${bold("usage")}
    warpchart ${accent("<owner/name>")}        rank, velocity and a star chart
    warpchart ${accent("<owner/name>")} --json  raw JSON (agent friendly)
    warpchart ${accent("velocity")} [N]         the fastest-growing repos right now

  ${dim("public, cache-only data · no auth · https://warpchart.dev")}
`;

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--no-color");
  const asJson = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("-"));
  const cmd = positional[0];

  if (!cmd || cmd === "help" || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP + "\n");
    return;
  }
  try {
    if (cmd === "velocity") {
      await velocityView(Number(positional[1]) || 15);
    } else if (/^[\w.-]+\/[\w.-]+$/.test(cmd)) {
      await repoView(cmd, asJson);
    } else {
      console.error(`  ${warn("?")} expected ${accent("owner/name")} or ${accent("velocity")}. Try ${accent("warpchart --help")}.`);
      process.exit(2);
    }
  } catch (err) {
    if (err.status === 404) {
      console.error(`\n  ${warn("◌")} ${bold(cmd)} is not in the worldwide top-1000 registry.`);
      console.error(`  ${dim("use the canonical owner/name (e.g. react/react, not facebook/react).")}\n`);
    } else {
      console.error(`\n  ${warn("✕")} ${err.message}\n`);
    }
    process.exit(1);
  }
}

main();
