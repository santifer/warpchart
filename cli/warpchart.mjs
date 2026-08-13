#!/usr/bin/env node
// warpchart — growth telemetry for any GitHub repository, in your terminal.
//   npx warpchart owner/name          star chart + worldwide rank + who's hunting it
//   npx warpchart owner/name --json   raw JSON (agent friendly)
//   npx warpchart dossier owner/name  EVERYTHING: vitals, contributors, usage, traffic
//   npx warpchart contributors o/n    the contributor census and its curve
//   npx warpchart usage owner/name    npm installs + git clones over time
//   npx warpchart hunters owner/name  who's about to pass it (and who it's passing)
//   npx warpchart top [N] --lang Rust the biggest repos (optionally by language)
//   npx warpchart velocity [N] --lang the fastest-growing repos right now
//   npx warpchart compare a/b c/d     side by side
//   npx warpchart embed owner/name    a README embed snippet
//
// Reads the public, cache-only Warpchart API (no auth, no GitHub token).
const BASE = process.env.WARPCHART_BASE || "https://warpchart.dev";

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes("--no-color");
const c = (code, s) => (COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const accent = (s) => c("38;5;45", s);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const warn = (s) => c("38;5;214", s);
const fmt = (n) => Number(n).toLocaleString("en-US");
const short = (r) => r.split("/")[1] || r;

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

const chartWidth = () => Math.max(24, Math.min((process.stdout.columns || 80) - 6, 72));
const banner = (sub) => console.log("\n  " + accent("◤ WARPCHART") + (sub ? dim("  ·  ") + sub : ""));
const fmtEta = (d) => (d == null ? "" : d < 1 ? `${Math.round(d * 24)}h` : d < 60 ? `${Math.round(d)}d` : `${Math.round(d / 30)}mo`);

// ---- shared formatting for the full-record views ---------------------------
const pct = (n) => (n == null ? dim("n/a") : `${n}%`);
const day = (s) => (s ? String(s).slice(0, 10) : "—");
const kv = (label, value, note) =>
  console.log(`  ${dim(label.padEnd(22))} ${value}${note ? dim("  " + note) : ""}`);
const rule = (title) => console.log("\n  " + dim("─── ") + accent(title) + dim(" " + "─".repeat(Math.max(0, 46 - title.length))));

// A window flag set the caller can pass through to the API unchanged, so the
// server does the trimming and the terminal never downloads a year to print a
// week. Returns "" when the caller asked for everything.
function windowQS(args) {
  const parts = [];
  for (const [flag, key] of [["--since", "since"], ["--until", "until"], ["--range", "range"], ["--last", "range"]]) {
    const v = flagVal(args, [flag]);
    if (v) parts.push(`${key}=${encodeURIComponent(v)}`);
  }
  return parts.length ? "&" + parts.join("&") : "";
}

// sparkline for a day series, sized to the terminal
function sparkSeries(points, pick) {
  const vals = points.map(pick);
  if (vals.length < 3) return null;
  return braille(vals, Math.max(20, Math.min((process.stdout.columns || 80) - 8, 60)), 4);
}

function windowLine(w) {
  if (!w) return dim("no data");
  return dim(`${day(w.from)} → ${day(w.to)} · ${w.days} day${w.days === 1 ? "" : "s"}`);
}

async function dossierView(repo, args, asJson) {
  const d = await getJSON(`/api/v1/dossier?repo=${encodeURIComponent(repo)}${windowQS(args)}`);
  if (asJson) { process.stdout.write(JSON.stringify(d, null, 2) + "\n"); return; }
  const r = d.registry;
  banner(bold(d.repo) + dim(" · the whole record"));
  if (d.window?.kind !== "full") {
    console.log("  " + dim("window ") + accent(d.window.since ? `since ${d.window.since}` : "") + (d.window.until ? dim(" until " + d.window.until) : ""));
  }

  rule("REGISTRY");
  kv("worldwide rank", accent("#" + fmt(r.rank)));
  kv("stars", bold(fmt(r.stars)) + (r.velocityPerDay != null ? accent("  ▲ " + r.velocityPerDay + "/day") : ""));
  kv("forks", fmt(r.forks ?? 0), r.stars ? `${((r.forks / r.stars) * 100).toFixed(1)}% of stars` : "");
  if (r.nextGate) kv("next gate", accent("top " + r.nextGate.rank), fmt(r.nextGate.gap) + " ★ to go");

  const v = d.vitals;
  rule("ENGINEERING HEALTH");
  if (v?.locked) {
    console.log("  " + dim(v.reason));
  } else if (v) {
    kv("activity rank", accent("#" + fmt(v.activityRank)) + dim(" of " + fmt(v.universe)), "top " + Math.max(1, Math.ceil((v.activityRank / v.universe) * 100)) + "%");
    kv("verdict", v.verdict === "ALIVE" ? accent("● ALIVE") : warn("○ MONUMENT"));
    if (v.leadTime) kv("lead time", bold(v.leadTime.medianH + "h"), `DORA ${v.leadTime.tier} · ${v.leadTime.pctUnder24h}% under a day · ${v.leadTime.windowDays}d window`);
    if (v.deploy) kv("deploy freq", bold(v.deploy.perWeek + "/wk"), v.deploy.tier);
    if (v.responsiveness) kv("1st response", bold(v.responsiveness.medianH + "h"), `n=${v.responsiveness.sample ?? "?"}`);
    if (v.quality) kv("revert rate", bold(v.quality.revertPct + "%"), `${v.quality.reverts} of ${fmt(v.quality.mergedPRs)} merged`);
    if (v.automation) kv("checks / PR", bold(String(v.automation.statusChecksPerPR ?? "—")), (v.automation.bots ?? []).length + " bots");
    if (v.docs) kv("docs health", pct(v.docs.healthPct), (v.docs.chips ?? []).join(" · "));
    if (v.agentReadiness?.agentNative) kv("agent-native", accent("◇ yes"), (v.agentReadiness.chips ?? []).join(" · "));
    const f = v.fingerprint || {};
    const top = (p) => (p == null ? dim("—") : accent("top " + Math.max(1, Math.round(100 - p)) + "%"));
    console.log("  " + dim("percentile".padEnd(22)) + ["commits " + top(f.commits), "PRs " + top(f.mergedPRs), "issues " + top(f.issues), "releases " + top(f.releases)].join(dim(" · ")));
  }

  const c = d.contributors;
  if (c) {
    rule("WHO BUILDS IT");
    kv("contributors", bold(fmt(c.total)), c.credited ? `${c.authors} authors · ${c.credited} credited incl. co-authors` : "");
    if (c.aiCoCredits) kv("AI co-credits", fmt(c.aiCoCredits), "counted, never people");
    kv("merged PRs", fmt(c.mergedTotal ?? 0), c.mergedByDistinct === 1 ? "a single maintainer gate" : c.mergedByDistinct + " maintainers");
    if (c.busFactor) kv("bus factor", `${Math.round(c.busFactor.top1Share * 100)}% / ${Math.round(c.busFactor.top5Share * 100)}%`, "top 1 / top 5 of all commits");
    const s = c.series?.authors;
    if (s?.points?.length > 2) {
      const spark = sparkSeries(s.points, (p) => p.cumulative);
      if (spark) for (const row of spark.split("\n")) console.log("  " + accent(row));
      console.log("  " + windowLine(s) + dim("  ·  ") + bold(fmt(s.points.at(-1).cumulative)) + dim(" cumulative"));
    }
    if (c.cohorts?.length) {
      const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const last = c.cohorts.slice(-4).map((x) => `${MON[Number(x.month.slice(5))] || x.month} ${accent("+" + x.new)}${x.returning ? dim("/" + x.returning + " back") : ""}`);
      console.log("  " + dim("new/returning".padEnd(22)) + last.join(dim(" · ")) + dim("   (" + c.cohortsSource + ")"));
    }
  }

  const u = d.usage;
  rule("REAL USAGE");
  if (u.npm) {
    kv("npm package", bold(u.npm.package));
    kv("downloads · 30d", bold(fmt(u.npm.last30 ?? 0)));
    if (u.npm.windowTotal != null && u.npm.series) kv("downloads · window", bold(fmt(u.npm.windowTotal)), windowLine(u.npm.series));
    if (u.npm.series?.points?.length > 2) {
      const spark = sparkSeries(u.npm.series.points, (p) => p.d);
      if (spark) for (const row of spark.split("\n")) console.log("  " + accent(row));
    }
  } else {
    kv("npm package", dim("none resolved"));
  }
  if (u.clones?.series) {
    // clone EVENTS accumulate; people do not. The old lines printed a sum of
    // per-day uniques as "unique cloners" and divided by it for a "per cloner"
    // ratio, which counted one person once per day they showed up.
    kv("clones", bold(fmt(u.clones.windowClones)), windowLine(u.clones.series));
    if (u.clones.uniqueCloners14d != null) {
      kv("unique cloners", bold(fmt(u.clones.uniqueCloners14d)),
         `deduplicated by GitHub, 14d${u.clones.uniqueCloners14dAt ? ` · as of ${u.clones.uniqueCloners14dAt}` : ""}`);
    }
    console.log("  " + dim(u.clones.note));
    const spark = sparkSeries(u.clones.series.points, (p) => p.u);
    if (spark) for (const row of spark.split("\n")) console.log("  " + accent(row));
  } else if (u.clones) {
    kv("clone traffic", dim(u.clones.reason));
  }
  if (u.adoption?.cloneConvPct != null) kv("view → clone", bold(u.adoption.cloneConvPct + "%"), "last 7 days");

  const a = d.activity30d;
  if (a) {
    rule("LAST 30 DAYS");
    kv("commits", fmt(a.commits ?? 0));
    kv("PRs merged", fmt(a.prsMerged ?? 0));
    kv("issues", `${fmt(a.issuesClosed ?? 0)} closed`, `${fmt(a.issuesOpened ?? 0)} opened · ${fmt(a.openIssues ?? 0)} open`);
    if (a.releases?.length) kv("latest release", bold(a.releases[0].tag), day(a.releases[0].at));
  }

  console.log("\n  " + dim("→ ") + accent(d.url) + dim("   measured ") + dim(day(d.generatedAt)) + "\n");
}

async function contributorsView(repo, args, asJson) {
  const d = await getJSON(`/api/v1/dossier?repo=${encodeURIComponent(repo)}${windowQS(args)}`);
  const c = d.contributors;
  if (asJson) { process.stdout.write(JSON.stringify(c ?? { locked: true }, null, 2) + "\n"); return; }
  banner(bold(d.repo) + dim(" · who builds it"));
  if (!c) { console.log("\n  " + dim("the contributor census is computed for owned and paid repos") + "\n"); return; }
  console.log();
  kv("authors", bold(fmt(c.authors ?? c.total)), "landed a commit");
  if (c.credited != null) kv("credited", bold(fmt(c.credited)), "incl. co-authors (GitHub's own definition)");
  if (c.aiCoCredits) kv("AI co-credits", fmt(c.aiCoCredits), "counted, never people");
  if (c.busFactor) kv("bus factor", `${Math.round(c.busFactor.top1Share * 100)}% / ${Math.round(c.busFactor.top5Share * 100)}%`, "top 1 / top 5 of all commits");
  const s = c.series?.authors;
  if (s?.points?.length > 2) {
    console.log();
    const spark = sparkSeries(s.points, (p) => p.cumulative);
    if (spark) for (const row of spark.split("\n")) console.log("  " + accent(row));
    console.log("  " + windowLine(s) + dim("  ·  ") + bold(fmt(s.points.at(-1).cumulative)) + dim(" cumulative"));
  }
  if (c.cohorts?.length) {
    console.log("\n  " + dim("month      new   returning"));
    for (const x of c.cohorts.slice(-8)) {
      console.log(`  ${x.month}   ${accent(String(x.new).padStart(4))}   ${dim(String(x.returning).padStart(6))}`);
    }
    console.log("  " + dim("source: " + c.cohortsSource));
  }
  if (c.top?.length) console.log("\n  " + dim("most PRs  ") + c.top.slice(0, 6).map((t) => bold(t.login)).join(dim(" · ")));
  console.log("\n  " + dim("→ ") + accent(d.url) + "\n");
}

async function usageView(repo, args, asJson) {
  const d = await getJSON(`/api/v1/dossier?repo=${encodeURIComponent(repo)}${windowQS(args)}`);
  const u = d.usage;
  if (asJson) { process.stdout.write(JSON.stringify(u, null, 2) + "\n"); return; }
  banner(bold(d.repo) + dim(" · real usage"));
  console.log();
  if (u.npm) {
    kv("npm package", bold(u.npm.package));
    kv("downloads · 30d", bold(fmt(u.npm.last30 ?? 0)));
    if (u.npm.series) {
      kv("downloads · window", bold(fmt(u.npm.windowTotal ?? 0)), windowLine(u.npm.series));
      const spark = sparkSeries(u.npm.series.points, (p) => p.d);
      if (spark) { console.log(); for (const row of spark.split("\n")) console.log("  " + accent(row)); }
    }
  } else {
    console.log("  " + dim("no npm package resolved for this repo"));
  }
  console.log();
  if (u.clones?.series) {
    // clone EVENTS accumulate; people do not. The old lines printed a sum of
    // per-day uniques as "unique cloners" and divided by it for a "per cloner"
    // ratio, which counted one person once per day they showed up.
    kv("clones", bold(fmt(u.clones.windowClones)), windowLine(u.clones.series));
    if (u.clones.uniqueCloners14d != null) {
      kv("unique cloners", bold(fmt(u.clones.uniqueCloners14d)),
         `deduplicated by GitHub, 14d${u.clones.uniqueCloners14dAt ? ` · as of ${u.clones.uniqueCloners14dAt}` : ""}`);
    }
    console.log("  " + dim(u.clones.note));
    const spark = sparkSeries(u.clones.series.points, (p) => p.u);
    if (spark) { console.log(); for (const row of spark.split("\n")) console.log("  " + accent(row)); }
  } else if (u.clones) {
    console.log("  " + dim("clone traffic: " + u.clones.reason));
  }
  console.log("\n  " + dim("→ ") + accent(d.url) + "\n");
}

async function repoView(repo, asJson) {
  const stats = await getJSON(`/api/v1/repo?repo=${encodeURIComponent(repo)}`);
  if (asJson) { process.stdout.write(JSON.stringify(stats, null, 2) + "\n"); return; }
  banner(bold(stats.repo || repo));
  const v = stats.velocityPerDay;
  console.log(`  ${dim("RANK")} ${accent("#" + fmt(stats.rank))}    ${dim("STARS")} ${bold(fmt(stats.stars))}    ${v != null ? accent("▲ " + v + "/day") : ""}`);
  console.log();
  try {
    const curve = await getJSON(`/api/curve?repo=${encodeURIComponent(repo)}`);
    const pts = (curve.pts || []).map((p) => p.v);
    if (pts.length > 2) {
      const w = chartWidth();
      for (const row of braille(pts, w, 7).split("\n")) console.log("  " + accent(row));
      const first = new Date(curve.pts[0].t).getUTCFullYear();
      console.log("  " + dim(`${first}`) + dim(" ".repeat(Math.max(1, w - 12))) + dim("now · " + fmt(curve.total) + "★"));
      console.log();
    }
  } catch { /* chart best-effort */ }
  if (stats.nextGate) console.log("  " + dim("next gate ") + accent("top " + stats.nextGate.rank) + dim(" · ") + bold(fmt(stats.nextGate.gap)) + dim(" ★ to go"));
  // who's hunting you (best-effort)
  try {
    const ov = await getJSON(`/api/v1/overtakes?repo=${encodeURIComponent(repo)}`);
    const h = (ov.hunters || [])[0];
    if (h) console.log("  " + warn("◌ hunted by ") + bold(short(h.hunter.repo)) + dim(` · passes you in ${fmtEta(h.etaDays)}`));
  } catch {}
  const ahead = (stats.ahead || []).slice(0, 3).map((n) => `${short(n.repo)} ${dim("+" + fmt(n.gap))}`);
  if (ahead.length) console.log("  " + dim("ahead ") + ahead.join(dim("  ·  ")));
  console.log("  " + dim("→ ") + accent(stats.url) + "\n");
}

function rankedList(items, valueOf) {
  for (const f of items) {
    console.log(`  ${dim("#" + String(f.rank).padStart(4))}  ${bold(f.repo.padEnd(34).slice(0, 34))} ${valueOf(f)}`);
  }
}

async function velocityView(limit, lang) {
  const { fastest } = await getJSON(`/api/v1/velocity?limit=${limit}${lang ? "&language=" + encodeURIComponent(lang) : ""}`);
  banner("fastest systems right now" + (lang ? dim(" · " + lang) : ""));
  console.log();
  if (!fastest.length) console.log("  " + dim("no movers for that filter"));
  rankedList(fastest, (f) => accent("▲ " + f.velocityPerDay + "/day"));
  console.log();
}

async function leaderboardView(limit, lang) {
  const { leaderboard } = await getJSON(`/api/v1/leaderboard?limit=${limit}${lang ? "&language=" + encodeURIComponent(lang) : ""}`);
  banner("worldwide leaderboard" + (lang ? dim(" · " + lang) : ""));
  console.log();
  if (!leaderboard.length) console.log("  " + dim("no repos for that filter"));
  rankedList(leaderboard, (f) => bold(fmt(f.stars) + "★") + (f.velocityPerDay ? dim("  ▲" + f.velocityPerDay + "/d") : ""));
  console.log();
}

async function huntersView(repo) {
  const ov = await getJSON(`/api/v1/overtakes?repo=${encodeURIComponent(repo)}`);
  banner(bold(repo) + dim(" · the chase"));
  console.log();
  const H = ov.hunters || [], T = ov.targets || [];
  if (H.length) {
    console.log("  " + warn("◌ hunting you") + dim(" (about to pass)"));
    for (const o of H) console.log(`    ${bold(short(o.hunter.repo))} ${dim("+" + o.hunter.velocityPerDay + "/d · gap " + fmt(o.gap) + " · in " + fmtEta(o.etaDays))}`);
    console.log();
  }
  if (T.length) {
    console.log("  " + accent("▲ in your sights") + dim(" (you're about to pass)"));
    for (const o of T) console.log(`    ${bold(short(o.victim.repo))} ${dim("gap " + fmt(o.gap) + " · in " + fmtEta(o.etaDays))}`);
    console.log();
  }
  if (!H.length && !T.length) console.log("  " + dim("no imminent overtakes around " + repo) + "\n");
}

async function findView(query, asJson) {
  const data = await getJSON(`/api/v1/find?q=${encodeURIComponent(query)}`);
  if (asJson) { process.stdout.write(JSON.stringify(data, null, 2) + "\n"); return; }
  banner("best match for " + bold('"' + query + '"'));
  console.log();
  const results = data.results || [];
  if (!results.length) { console.log("  " + dim("nothing in the catalog matches that yet") + "\n"); return; }
  results.slice(0, 12).forEach((r, i) => {
    const v = r.velocityPerDay > 0 ? accent("▲" + r.velocityPerDay + "/d") : dim("·");
    console.log(`  ${dim(String(i + 1).padStart(2))}  ${bold(short(r.repo).padEnd(24).slice(0, 24))} ${(fmt(r.stars) + "★").padEnd(10)} ${v}`);
    if (r.description) console.log(`      ${dim(r.description.slice(0, 64))}`);
  });
  console.log("\n  " + dim("→ ") + accent(results[0].url) + "\n");
}

async function risingView(category, lang) {
  if (!category && !lang) {
    const { categories } = await getJSON(`/api/v1/rising`);
    banner("where software is moving" + dim(" · rising by category"));
    console.log();
    if (!categories?.length) { console.log("  " + dim("catalog still warming up") + "\n"); return; }
    for (const c of categories.slice(0, 24)) {
      const name = (c.label || c.id).padEnd(20).slice(0, 20);
      console.log(`  ${bold(name)} ${accent((c.heat + " ★/day").padStart(12))}  ${dim(c.count + " systems")}`);
    }
    console.log("\n  " + dim("try ") + accent("warpchart rising <category>") + dim(" (e.g. ai-llm, cli, databases)") + "\n");
    return;
  }
  const qs = category ? `topic=${encodeURIComponent(category)}` : `language=${encodeURIComponent(lang)}`;
  const data = await getJSON(`/api/v1/rising?${qs}`);
  const label = data.category?.label || lang || category;
  banner("rising · " + bold(label));
  console.log();
  const rising = data.rising || [];
  if (!rising.length) { console.log("  " + dim("nothing rising there yet") + "\n"); return; }
  for (const f of rising) {
    const v = f.velocityPerDay > 0 ? accent("▲ " + f.velocityPerDay + "/day") : dim("#" + f.rank);
    console.log(`  ${bold(short(f.repo).padEnd(26).slice(0, 26))} ${(fmt(f.stars) + "★").padEnd(10)} ${v}`);
  }
  console.log("\n  " + dim("→ ") + accent(`${BASE}/c/${data.category?.id || ""}`) + "\n");
}

async function compareView(repos) {
  const { results } = await getJSON(`/api/v1/compare?repos=${encodeURIComponent(repos.join(","))}`);
  banner("compare");
  console.log();
  for (const r of results) {
    const name = (r.stats?.repo || r.repo).padEnd(26).slice(0, 26);
    if (!r.stats) { console.log(`  ${bold(name)}  ${dim("not in top-1000")}`); continue; }
    const s = r.stats;
    console.log(`  ${bold(name)}  ${accent(("#" + fmt(s.rank)).padEnd(8))}${(fmt(s.stars) + "★").padEnd(12)}${accent("▲" + (s.velocityPerDay ?? 0) + "/d")}`);
  }
  console.log();
}

async function embedView(repo) {
  const e = await getJSON(`/api/v1/embed?repo=${encodeURIComponent(repo)}`);
  banner(bold(repo) + dim(" · README embed"));
  console.log("\n  " + dim("markdown"));
  console.log("  " + e.markdown);
  console.log("\n  " + dim("html"));
  console.log("  " + e.html + "\n");
}

const HELP = `
  ${accent("◤ WARPCHART")} — growth telemetry for any GitHub repo, in your terminal

  ${bold("usage")}
    warpchart ${accent("<owner/name>")}         rank, velocity, star chart, who's hunting it
    warpchart ${accent("hunters")} <owner/name>  who's about to pass it (and who it passes)
    warpchart ${accent("top")} [N] ${dim("--lang Rust")}    biggest repos, optionally by language
    warpchart ${accent("velocity")} [N] ${dim("--lang Go")} fastest-growing repos right now
    warpchart ${accent("rising")} ${dim("[category]")}       what is climbing fastest, by domain
    warpchart ${accent("find")} ${dim("<question>")}        best repo for a need (e.g. agentic memory system)
    warpchart ${accent("compare")} a/b c/d       side by side
    warpchart ${accent("dossier")} <owner/name>  ${bold("the whole record")} — health, people, usage, traffic
    warpchart ${accent("contributors")} <o/n>     the contributor census and its curve
    warpchart ${accent("usage")} <owner/name>     npm installs and git clones over time
    warpchart ${accent("embed")} <owner/name>    a README embed snippet
    ${dim("flags: --json (agent output) · --lang <language>")}
    ${dim("time:  --range 30d|12w|6m · --since YYYY-MM-DD · --until YYYY-MM-DD")}

  ${dim("public, cache-only data · no auth · https://warpchart.dev")}
`;

function flagVal(args, names) {
  for (let i = 0; i < args.length; i++) {
    for (const n of names) {
      if (args[i] === n) return args[i + 1];
      if (args[i].startsWith(n + "=")) return args[i].slice(n.length + 1);
    }
  }
  return undefined;
}

async function main() {
  const raw = process.argv.slice(2);
  const asJson = raw.includes("--json");
  const lang = flagVal(raw, ["--lang", "--language"]);
  const consumed = new Set();
  const VALUE_FLAGS = ["--lang", "--language", "--since", "--until", "--range", "--last"];
  raw.forEach((a, i) => { if (VALUE_FLAGS.includes(a)) consumed.add(i + 1); });
  const positional = raw.filter((a, i) => !a.startsWith("-") && !consumed.has(i));
  const cmd = positional[0];

  if (raw.includes("-h") || raw.includes("--help") || cmd === "help") { process.stdout.write(HELP + "\n"); return; }

  try {
    if (!cmd) {
      await leaderboardView(15, lang);
      console.log("  " + dim("try ") + accent("warpchart <owner/name>") + dim(" or ") + accent("warpchart --help") + "\n");
    } else if (cmd === "velocity") {
      await velocityView(Number(positional[1]) || 15, lang);
    } else if (cmd === "rising") {
      await risingView(positional[1], lang);
    } else if (cmd === "find" || cmd === "best" || cmd === "search") {
      const q = positional.slice(1).join(" ").trim();
      if (!q) throw Object.assign(new Error('usage: warpchart find "agentic memory system"'), { soft: true });
      await findView(q, asJson);
    } else if (cmd === "top" || cmd === "leaderboard") {
      await leaderboardView(Number(positional[1]) || 15, lang);
    } else if (cmd === "hunters") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(positional[1] || "")) throw Object.assign(new Error("usage: warpchart hunters owner/name"), { soft: true });
      await huntersView(positional[1]);
    } else if (cmd === "dossier" || cmd === "all" || cmd === "full") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(positional[1] || "")) throw Object.assign(new Error("usage: warpchart dossier owner/name [--range 30d]"), { soft: true });
      await dossierView(positional[1], raw, asJson);
    } else if (cmd === "contributors" || cmd === "people") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(positional[1] || "")) throw Object.assign(new Error("usage: warpchart contributors owner/name [--range 6m]"), { soft: true });
      await contributorsView(positional[1], raw, asJson);
    } else if (cmd === "usage" || cmd === "installs" || cmd === "clones") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(positional[1] || "")) throw Object.assign(new Error("usage: warpchart usage owner/name [--range 30d]"), { soft: true });
      await usageView(positional[1], raw, asJson);
    } else if (cmd === "embed") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(positional[1] || "")) throw Object.assign(new Error("usage: warpchart embed owner/name"), { soft: true });
      await embedView(positional[1]);
    } else if (cmd === "compare") {
      const repos = positional.slice(1).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r));
      if (repos.length < 2) throw Object.assign(new Error("usage: warpchart compare owner/a owner/b"), { soft: true });
      await compareView(repos);
    } else if (/^[\w.-]+\/[\w.-]+$/.test(cmd)) {
      await repoView(cmd, asJson);
    } else {
      console.error(`  ${warn("?")} unknown command. Try ${accent("warpchart --help")}.`);
      process.exit(2);
    }
  } catch (err) {
    if (err.soft) console.error(`\n  ${warn("?")} ${err.message}\n`);
    else if (err.status === 404) console.error(`\n  ${warn("◌")} ${bold(cmd)} is not in the worldwide top-1000 registry.\n  ${dim("use the canonical owner/name (e.g. react/react, not facebook/react).")}\n`);
    else console.error(`\n  ${warn("✕")} ${err.message}\n`);
    process.exit(1);
  }
}

main();
