// HEALTH: the watchdog that catches what nobody is looking at.
//
// Two production failures on 2026-07-27 shared one root cause, and it was not
// the bugs themselves: NOTHING NOTICED. A star purge made a rival read -2903
// stars/day for days (so the site promised an overtake "in 2 hours"), and
// GitHub silently closed third-party stargazer listing weeks earlier, which
// left /compare unable to add any repo. Both were found by a human looking at
// the screen. For a product that sells itself as the source of truth on other
// people's growth, that is the real defect.
//
// So this file asserts, every run, the things a person would otherwise have to
// remember to check:
//   FRESH     is the data actually recent, or is the site quietly frozen?
//   DATA      are the numbers possible? (a repo cannot shed 4% of its stars a
//             day as "growth" - that was the purge)
//   CONTRACT  do our upstreams still behave as they did last run? Reported as
//             TRANSITIONS, not just failures, because the thing that hurt us
//             was a capability disappearing without a single error on our side
//   PUBLIC    do the endpoints a visitor touches actually answer? (this is the
//             check that would have caught /compare the same day)
//   COHERENCE does the same repo show the same velocity everywhere? One number
//             with two values on two pages is a credibility bug, not a rounding
//             detail
//   CURVE     are the charts we serve shaped like real history?
//
// Every finding carries a REMEDY: what to do, and where. A watchdog that only
// says "something is wrong" just moves the diagnosis work onto the person it
// was supposed to help.
//
// Runs standalone (no build step, no framework): node collector/health.mjs
//   --json     machine-readable findings on stdout
//   --no-fail  always exit 0 (for exploratory local runs)
//   --base=X   probe another origin (a preview deployment, say)
// Exit code 1 when a critical finding is open, so CI turns red by itself.
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const NO_FAIL = args.includes("--no-fail");
const BASE = (args.find((a) => a.startsWith("--base="))?.slice(7) ?? "https://warpchart.dev").replace(/\/$/, "");
const REPORT_PATH = args.find((a) => a.startsWith("--report="))?.slice(9) ?? null;

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const GH_TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The tenant, plus foreign repos spanning the interesting cases: huge, mid,
// tiny, and the one that got purged. Foreign coverage is the point - every
// bug we shipped this month only showed up on repos we do not own.
const TENANT = "santifer/career-ops";
const FOREIGN = ["facebook/react", "vercel/next.js", "mem0ai/mem0", "odysseus-dev/odysseus"];

// ---------------------------------------------------------------- findings --
const findings = [];
const checked = [];

// severity: "critical" (lying or down, fix now) | "warn" (degrading, look
// today) | "info" (a fact worth knowing, e.g. an upstream capability changed)
function fail(id, area, severity, detail, remedy, evidence) {
  findings.push({ id, area, severity, detail, remedy, evidence: evidence ?? null });
}
function pass(id, area, detail) {
  checked.push({ id, area, detail: detail ?? "ok" });
}

// A check that throws is itself a finding: silent watchdogs are worse than no
// watchdog, because they read as "all clear".
async function check(id, area, fn) {
  try {
    await fn();
  } catch (err) {
    fail(id, area, "warn", `the check itself failed: ${err?.message ?? err}`,
      `Fix or delete the ${id} check in collector/health.mjs - a check that cannot run is reporting nothing, not "healthy".`);
  }
}

// ------------------------------------------------------------------- utils --
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000), headers: opts.headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, ok: res.ok, body, text };
}

// The same pool the collector carries, in the same order. CONTRACT must answer
// "can the collector do this?", and the collector fails over between tokens, so
// probing with only the first one would report a FORBIDDEN it recovers from.
const GH_POOL = [GH_TOKEN, process.env.GH_TOKEN_FALLBACKS]
  .filter(Boolean).flatMap((v) => v.split(/[\s,]+/)).filter(Boolean)
  .filter((t, i, a) => a.indexOf(t) === i);

// Best result across the pool: a call the collector can make with SOME token is
// a call the collector can make.
async function gh(path, opts = {}) {
  if (!GH_POOL.length) return { status: 0, ok: false, body: null, text: "no token" };
  let last = { status: 0, ok: false, body: null, text: "no token" };
  for (const tok of GH_POOL) {
    last = await fetchJson(`https://api.github.com${path}`, {
      headers: { Authorization: `Bearer ${tok}`, Accept: opts.accept ?? "application/vnd.github+json", "User-Agent": "warpchart-health" },
      timeoutMs: 15_000,
    });
    if (last.ok) return last;
  }
  return last;
}

async function ghGraphql(query) {
  if (!GH_POOL.length) return { status: 0, ok: false, body: null };
  let last = { status: 0, ok: false, body: null };
  for (const tok of GH_POOL) {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      body: JSON.stringify({ query }),
      headers: { Authorization: `Bearer ${tok}`, "User-Agent": "warpchart-health", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    last = { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
    // GraphQL reports permission failures as 200 + FORBIDDEN, so "ok" is not
    // enough: only a body with no errors means this token could do the job.
    if (last.ok && !last.body?.errors) return last;
  }
  return last;
}

async function blobJson(key) {
  if (!BLOB_TOKEN) return null;
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", token: BLOB_TOKEN }).catch(() => null);
  if (!res?.stream) return null;
  return JSON.parse(await new Response(res.stream).text());
}

async function blobPut(key, value) {
  if (!BLOB_TOKEN) return;
  const { put } = await import("@vercel/blob");
  await put(key, JSON.stringify(value), {
    access: "private", token: BLOB_TOKEN, contentType: "application/json",
    addRandomSuffix: false, allowOverwrite: true,
  });
}

const ageH = (iso) => (Date.now() - Date.parse(iso)) / HOUR;
const pct = (a, b) => (b === 0 ? 0 : Math.abs(a - b) / Math.abs(b));

// =========================================================== FRESH ==========
// The collector hung once and the site froze for days while still looking
// perfectly normal: every number was there, just old. Age is the only thing
// that exposes that failure mode.
async function checkFreshness(route) {
  await check("fresh.snapshot", "FRESH", async () => {
    const { body } = await fetchJson(`${BASE}/api/health`);
    const iso = body?.collector?.lastSnapshot;
    if (!iso) {
      return fail("fresh.snapshot", "FRESH", "critical", "/api/health did not report a last snapshot",
        "Check the collect workflow ran at all: gh run list -R santifer/warpchart -w collect.yml", body);
    }
    const h = ageH(iso);
    if (h > 6) {
      fail("fresh.snapshot", "FRESH", "critical", `last snapshot is ${h.toFixed(1)}h old (cron is every 2h)`,
        "The collector is failing or being cancelled. Check the run log, especially step timeouts: a job-level timeout kills 'Trigger deploy' silently (that is what froze the site on 2026-07-19).", { lastSnapshot: iso });
    } else if (h > 4) {
      fail("fresh.snapshot", "FRESH", "warn", `last snapshot is ${h.toFixed(1)}h old`,
        "One missed cron is tolerable; two in a row is not. Watch the next run.", { lastSnapshot: iso });
    } else pass("fresh.snapshot", "FRESH", `${h.toFixed(1)}h old`);
  });

  await check("fresh.route", "FRESH", async () => {
    if (!route?.generated_at) {
      return fail("fresh.route", "FRESH", "critical", "route.json has no generated_at",
        "The registry is the backbone of rank and velocity. Inspect collector/collect.mjs output.");
    }
    const h = ageH(route.generated_at);
    if (h > 48) {
      fail("fresh.route", "FRESH", "critical", `the top-1000 registry is ${(h / 24).toFixed(1)} days old`,
        "Rank and velocity are stale sitewide. The registry refreshes ~daily inside collect.mjs; check whether the search step is erroring.", { generated_at: route.generated_at });
    } else if (h > 30) {
      fail("fresh.route", "FRESH", "warn", `the registry is ${h.toFixed(0)}h old (refreshes ~daily)`,
        "If it crosses 48h, rank and velocity are formally stale.", { generated_at: route.generated_at });
    } else pass("fresh.route", "FRESH", `${h.toFixed(1)}h old`);
  });

  // THE CHECK THIS FILE SHOULD HAVE HAD ON DAY ONE. The tenant's per-star
  // series is the home page: the daily ladder, the night floor, the hourly
  // panels. It froze on 2026-07-22 (the collector's backwalk started getting
  // FORBIDDEN) and the site kept drawing a chart with the last five days simply
  // MISSING - no error anywhere, every other number still moving, so nothing
  // looked wrong. Santiago spotted the empty bars. Age of the last recorded
  // star is the one assertion that catches this regardless of the cause.
  await check("fresh.tenant-series", "FRESH", async () => {
    const { body } = await fetchJson(`${BASE}/api/curve?repo=${encodeURIComponent(TENANT)}`, { timeoutMs: 30_000 });
    const pts = body?.pts ?? [];
    if (!pts.length) {
      return fail("fresh.tenant-series", "FRESH", "critical", "the tenant curve has no points at all",
        "The home page charts are empty. Check data/stargazer_timestamps.txt exists in the Blob and that the build hydrated it.");
    }
    const last = pts[pts.length - 1];
    const h = (Date.now() - last.t) / HOUR;
    // The exact tail should reach today; a day of lag is collection cadence,
    // more than that means the per-star feed stopped.
    if (h > 36) {
      fail("fresh.tenant-series", "FRESH", "critical",
        `the tenant's star history stops ${(h / 24).toFixed(1)} days ago (last point ${new Date(last.t).toISOString().slice(0, 10)}, ${last.v} stars vs ${body.total} live)`,
        "The daily ladder is drawing missing days as empty bars. Read the collector log for the backwalk line: `gh run list -R santifer/warpchart -w collect.yml` then `gh run view <id> --log | grep backwalk`. A FORBIDDEN there means the token cannot read stargazers any more - the Actions installation token lost that power in 2026, so the job needs a user-scoped secret (STARGAZER_TOKEN). The gap self-heals on the first successful run, because backwalk resumes from the last known timestamp.",
        { lastPoint: new Date(last.t).toISOString(), lastValue: last.v, liveTotal: body.total, missing: (body.total ?? 0) - last.v });
    } else if (h > 26) {
      fail("fresh.tenant-series", "FRESH", "warn", `the tenant's star history is ${h.toFixed(0)}h behind`,
        "One missed backwalk. If it grows past 36h the per-star feed has stopped, not slowed.", { lastPoint: new Date(last.t).toISOString() });
    } else pass("fresh.tenant-series", "FRESH", `last star ${h.toFixed(1)}h ago`);
  });

  // A snapshot marked partial means some step gave up. One is noise; a run of
  // them is a subsystem that has quietly stopped working.
  await check("fresh.partial-snapshots", "FRESH", async () => {
    const hist = await blobJson("data/history.jsonl").catch(() => null);
    // history.jsonl is line-delimited, so blobJson cannot parse it; read raw.
    if (hist === null && BLOB_TOKEN) {
      const { get } = await import("@vercel/blob");
      const res = await get("data/history.jsonl", { access: "private", token: BLOB_TOKEN }).catch(() => null);
      if (!res?.stream) return pass("fresh.partial-snapshots", "FRESH", "history unavailable");
      const lines = (await new Response(res.stream).text()).trimEnd().split("\n").filter(Boolean);
      const recent = lines.slice(-12).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const partial = recent.filter((s) => s.partial).length;
      if (recent.length && partial / recent.length >= 0.5) {
        fail("fresh.partial-snapshots", "FRESH", "critical",
          `${partial} of the last ${recent.length} snapshots are marked partial`,
          "`partial` means a collector step failed and the run carried old values forward instead. Sustained partials are a subsystem that stopped working while the site kept looking normal. Find the failing step: gh run view <id> --log | grep -E 'failed|FORBIDDEN'",
          { partial, of: recent.length });
      } else pass("fresh.partial-snapshots", "FRESH", `${partial}/${recent.length} recent snapshots partial`);
    }
  });

  // Vital Signs is a whole panel computed by its own collector step, and it sat
  // frozen for 8 days (2026-07-19 to 2026-07-27) showing a rank as if it were
  // current: the sweep it depends on could never finish inside a CI job, died
  // before writing, and took the panel refresh down with it - while the
  // workflow reported success every two hours. Any artifact with its own
  // compute step needs its own freshness assertion; success of the run that
  // produces it proves nothing.
  await check("fresh.vitals", "FRESH", async () => {
    const v = await blobJson("vitals/santifer--career-ops.json").catch(() => null);
    if (!v) return pass("fresh.vitals", "FRESH", "no vitals artifact (panel not in use)");
    const h = ageH(v.computedAt);
    if (h > 72) {
      fail("fresh.vitals", "FRESH", "critical",
        `the Vital Signs panel was computed ${(h / 24).toFixed(1)} days ago (universe ${v.universe})`,
        "The panel is publishing a stale rank as if it were live. Read the step: gh run view <collect run id> --log | grep vitals. A 'timed out' there means Phase A (the ~1h reference sweep) is eating the step budget before Phase B refreshes the panel - the sweep is resumable, so check VITALS_DEADLINE_MS leaves room, and that the step timeout is above it.",
        { computedAt: v.computedAt, universe: v.universe });
    } else if (h > 30) {
      fail("fresh.vitals", "FRESH", "warn", `Vital Signs is ${h.toFixed(0)}h old`,
        "It refreshes daily. One miss is fine; a trend means Phase B is not being reached.", { computedAt: v.computedAt });
    } else pass("fresh.vitals", "FRESH", `computed ${h.toFixed(1)}h ago`);
  });

  // The Traffic Vault is the only record of clones and referrers that survives:
  // GitHub deletes them after 14 days, so a stalled feed is not just stale, it
  // is data permanently lost. The "Real usage" panel read 4 days old before
  // anyone noticed, because nothing asserted the vault's newest DAY (its file
  // timestamp kept refreshing on every run regardless).
  await check("fresh.traffic-days", "FRESH", async () => {
    const vault = await blobJson("traffic/santifer--career-ops.json").catch(() => null);
    if (!vault?.clones) return pass("fresh.traffic-days", "FRESH", "no vault (traffic not enabled)");
    const days = Object.keys(vault.clones).sort();
    if (!days.length) {
      return fail("fresh.traffic-days", "FRESH", "critical", "the Traffic Vault has no daily data",
        "collector/traffic.mjs is writing an empty series. Check TRAFFIC_TOKEN: the traffic API needs push access, and a token without it returns 403 while the run still reports success.");
    }
    const newest = days[days.length - 1];
    const ageDays = (Date.now() - Date.parse(`${newest}T00:00:00Z`)) / DAY;
    // GitHub publishes a day's traffic with ~1 day of lag, so 2 is normal and 3+
    // means the feed stopped. Anything older than 14 days is unrecoverable.
    if (ageDays > 3) {
      fail("fresh.traffic-days", "FRESH", ageDays > 6 ? "critical" : "warn",
        `the Traffic Vault's newest day is ${newest} (${ageDays.toFixed(1)} days old)`,
        "Clones and referrers are DELETED by GitHub after 14 days, so days lost here are lost forever. Read the step: gh run view <id> --log | grep traffic. A 403 means the token lost push access to the repo.",
        { newestDay: newest, days: days.length });
    } else pass("fresh.traffic-days", "FRESH", `newest day ${newest} (${ageDays.toFixed(1)}d)`);
  });

  // v7 is computed once per registry refresh. If the stamp lags the registry,
  // every velocity on the site is one generation behind its own star counts.
  await check("fresh.v7", "FRESH", async () => {
    if (!route) return;
    if (!route.v7_at) {
      return fail("fresh.v7", "FRESH", "warn", "route.json carries no v7_at stamp",
        "collector/velocity7.mjs did not run or bailed early. Velocities fall back to the noisy 1-day diff.");
    }
    if (route.v7_at !== route.generated_at) {
      fail("fresh.v7", "FRESH", "warn", `v7 was computed for ${route.v7_at} but the registry is ${route.generated_at}`,
        "Velocities lag their star counts. Re-run collect with force_v7=true: gh workflow run collect.yml -R santifer/warpchart -f force_v7=true", { v7_at: route.v7_at, generated_at: route.generated_at });
    } else pass("fresh.v7", "FRESH", "v7 matches the registry");
  });
}

// =========================================================== DATA ===========
// Invariants over the registry. These are the assertions that would have
// screamed on 2026-07-24, the day a purge turned into "-2903 stars/day".
async function checkData(route) {
  const repos = route?.repos ?? [];
  await check("data.size", "DATA", async () => {
    if (repos.length < 990) {
      fail("data.size", "DATA", "critical", `the registry holds ${repos.length} repos, expected ~1000`,
        "A truncated registry silently distorts every rank. Check the search/pagination step in collector/collect.mjs.");
    } else pass("data.size", "DATA", `${repos.length} repos`);
  });

  await check("data.impossible-velocity", "DATA", async () => {
    // THE 2026-07-24 CHECK. Nothing sheds (or gains) 5% of its stars per day
    // as organic growth; that shape is a correction, not a rate.
    const bad = repos.filter((p) => p.v7 != null && Math.abs(p.v7) > Math.max(300, p.s * 0.05));
    if (bad.length) {
      fail("data.impossible-velocity", "DATA", "critical",
        `${bad.length} repo(s) report an impossible rate: ${bad.slice(0, 5).map((p) => `${p.r} ${p.v7}/d on ${p.s} stars`).join(" · ")}`,
        "A rate that large is a star purge or a corrupted history point, and it poisons every ETA that touches the repo. collector/velocity7.mjs should have caught the step; if it did not, the daily series probably has a gap - widen the purge window or check the rank-history shard for that repo.",
        bad.slice(0, 10).map((p) => ({ repo: p.r, stars: p.s, v7: p.v7 })));
    } else pass("data.impossible-velocity", "DATA", "no impossible rates");
  });

  await check("data.v7-coverage", "DATA", async () => {
    const withV7 = repos.filter((p) => p.v7 != null).length;
    const share = repos.length ? withV7 / repos.length : 0;
    if (share < 0.9) {
      fail("data.v7-coverage", "DATA", "warn", `only ${(share * 100).toFixed(0)}% of repos have a 7-day velocity`,
        "The rest fall back to the noisy 1-day diff, which is what made ETAs contradict each other across pages. Check the rank-history shards are readable from the collector.", { withV7, total: repos.length });
    } else pass("data.v7-coverage", "DATA", `${(share * 100).toFixed(0)}% have v7`);
  });

  await check("data.ordering", "DATA", async () => {
    let broken = 0;
    for (let i = 1; i < repos.length; i++) if (repos[i].s > repos[i - 1].s) broken++;
    if (broken > 0) {
      fail("data.ordering", "DATA", "critical", `${broken} position(s) are out of star order`,
        "Rank IS the position in this array. If it is not sorted by stars descending, every rank on the site is wrong.");
    } else pass("data.ordering", "DATA", "sorted by stars");
  });

  await check("data.duplicates", "DATA", async () => {
    const seen = new Set();
    const dupes = [];
    for (const p of repos) {
      const k = p.r?.toLowerCase();
      if (!k) continue;
      if (seen.has(k)) dupes.push(p.r);
      seen.add(k);
    }
    if (dupes.length) {
      fail("data.duplicates", "DATA", "warn", `duplicated entries: ${dupes.slice(0, 5).join(", ")}`,
        "A repo appearing twice shifts every rank below it by one. Dedupe by lowercased name in collector/collect.mjs.", dupes.slice(0, 10));
    } else pass("data.duplicates", "DATA", "no duplicates");
  });

  await check("data.tenant", "DATA", async () => {
    const t = repos.find((p) => p.r?.toLowerCase() === TENANT);
    if (!t) {
      fail("data.tenant", "DATA", "critical", `${TENANT} is missing from the registry`,
        "The tenant drives the home page and the OG card. If it dropped out of the top-1000 that is news, not a bug - but verify before assuming.");
    } else if (t.v7 != null && t.v7 < 0) {
      fail("data.tenant", "DATA", "warn", `${TENANT} shows a negative velocity (${t.v7}/d)`,
        "Either a real unstar run or a purge in the window. Cross-check against GitHub before publishing anything.", t);
    } else pass("data.tenant", "DATA", `${t.s} stars, v7=${t.v7}/d`);
  });

  // The overtake scan is a separate artifact built from the registry. If it was
  // built from a DIFFERENT velocity than the registry now carries, the public
  // API contradicts itself (the 2026-07-27 worldmonitor case: 1842/d on one
  // endpoint, 640/d on another, because the scan ran before v7 existed).
  await check("data.collisions-source", "DATA", async () => {
    const col = await blobJson("data/collisions.json").catch(() => null);
    if (!col?.collisions?.length) return pass("data.collisions-source", "DATA", "no collisions recorded");
    const canon = new Map(repos.map((p) => [p.r?.toLowerCase(), p.v7 ?? p.v ?? null]));
    const off = [];
    for (const c of col.collisions.slice(0, 40)) {
      for (const side of ["hunter", "victim"]) {
        const want = canon.get(c[side]?.r?.toLowerCase());
        const got = c[side]?.v;
        if (want == null || got == null) continue;
        if (Math.abs(want - got) > Math.max(1, Math.abs(want) * 0.02)) {
          off.push({ repo: c[side].r, inScan: got, inRegistry: want });
        }
      }
    }
    if (off.length) {
      fail("data.collisions-source", "DATA", "critical",
        `the overtake scan used a different velocity than the registry for ${off.length} entr(ies): ` +
        off.slice(0, 3).map((o) => `${o.repo} scan=${o.inScan} registry=${o.inRegistry}`).join(" · "),
        "collector/collisions.mjs must run AFTER collector/velocity7.mjs so it inherits `v7`. Check the step order in .github/workflows/collect.yml - if the scan moved back inside collect.mjs it will silently score every crossing with the noisy 1-day rate again. Re-scan with: gh workflow run collect.yml -R santifer/warpchart -f force_collisions=true",
        off.slice(0, 8));
    } else pass("data.collisions-source", "DATA", "scan matches the registry velocity");
  });

  // Purges are INFO, not failure: they are real events. The point is that a
  // human learns about them the same day, instead of through a wrong ETA.
  await check("data.purges", "DATA", async () => {
    const purged = repos.filter((p) => p.purge);
    if (!purged.length) return pass("data.purges", "DATA", "none in the current window");
    const prev = (await blobJson("health/latest.json").catch(() => null))?.purges ?? [];
    const known = new Set(prev.map((p) => `${p.repo}@${p.day}`));
    const fresh = purged.filter((p) => !known.has(`${p.r}@${p.purge}`));
    if (fresh.length) {
      fail("data.purges", "DATA", "info",
        `star purge detected: ${fresh.map((p) => `${p.r} (${p.purge}, now ${p.v7}/d)`).join(" · ")}`,
        "GitHub removed farmed stars from this repo. The 7-day rate is already measured from after the step, so no action is needed - but if it is a neighbour, its chart will show a long flat stretch where the inflated period used to be. Worth knowing before you tweet a comparison.",
        fresh.map((p) => ({ repo: p.r, day: p.purge, v7: p.v7, stars: p.s })));
    } else pass("data.purges", "DATA", `${purged.length} known, none new`);
  });
}

// =========================================================== CONTRACT =======
// What our upstreams can do TODAY, compared with what they could do last run.
// This is the check that exists because GitHub closed foreign stargazer
// listing weeks before we noticed: nothing errored on our side, a capability
// simply vanished. Transitions are the signal, in both directions.
async function checkContracts() {
  const now = {};
  // WHOSE capability are we measuring? Actions hands the job a restricted
  // installation token that 403s where a user token gets 200 or 404, so a
  // baseline recorded locally and compared in CI invents transitions that never
  // happened (observed on this check's own first CI run). Baselines are keyed by
  // identity, and a 403 is recorded as "cannot measure" rather than as a change:
  // a watchdog that cries wolf gets muted, which is worse than having none.
  const identity = process.env.GITHUB_ACTIONS ? "actions" : "local";
  const unmeasurable = (v) => v === 403 || v === 401 || v === 0;

  await check("contract.probe", "CONTRACT", async () => {
    const repoRest = await gh(`/repos/${TENANT}`);
    now.restRepo = repoRest.status;

    const own = await gh(`/repos/santifer/warpchart/stargazers?per_page=1`, { accept: "application/vnd.github.star+json" });
    now.stargazersOwn = own.status;

    const foreign = await gh(`/repos/facebook/react/stargazers?per_page=1`, { accept: "application/vnd.github.star+json" });
    now.stargazersForeign = foreign.status;

    const g = await ghGraphql(`{repository(owner:"facebook",name:"react"){stargazerCount stargazers(last:3){edges{starredAt}}}}`);
    now.graphqlCount = g.body?.data?.repository?.stargazerCount ? "ok"
      : unmeasurable(g.status) || g.body?.errors ? "unmeasurable" : "missing";
    now.graphqlForeignEdges = now.graphqlCount === "unmeasurable" ? "unmeasurable"
      : (g.body?.data?.repository?.stargazers?.edges ?? []).length;

    const oss = await fetchJson("https://api.ossinsight.io/q/analyze-stars-history?repoId=10270250", { timeoutMs: 20_000 }).catch(() => ({ status: 0 }));
    now.ossInsight = oss.status;

    const rl = await gh("/rate_limit");
    now.rateRemaining = rl.body?.resources?.core?.remaining ?? null;
  });

  const BASELINE_KEY = `health/contracts-${identity}.json`;
  const prevDoc = await blobJson(BASELINE_KEY).catch(() => null);
  const prev = prevDoc?.state ?? null;

  // Absolute expectations: things that must hold regardless of history.
  await check("contract.rest-repo", "CONTRACT", async () => {
    if (now.restRepo !== 200) {
      fail("contract.rest-repo", "CONTRACT", "critical", `GET /repos returned ${now.restRepo}`,
        "This is the one GitHub call every curve depends on. If it is down, /api/curve will 502 for everything. Check token health and GitHub status.", now);
    } else pass("contract.rest-repo", "CONTRACT", "200");
  });

  await check("contract.graphql-count", "CONTRACT", async () => {
    if (now.graphqlCount === "unmeasurable") {
      // Not a failure and not a pass: this runner's token cannot ask the
      // question. Say so plainly instead of guessing in either direction.
      pass("contract.graphql-count", "CONTRACT", `not measurable with the ${identity} token`);
    } else if (now.graphqlCount !== "ok") {
      fail("contract.graphql-count", "CONTRACT", "critical", "GraphQL no longer returns stargazerCount",
        "Live star totals come from here. Without it the site can only show cached counts. Confirm from a second identity before acting: PUBLIC checks measure what the app can actually do, this one measures what this runner's token can do.", now);
    } else pass("contract.graphql-count", "CONTRACT", "stargazerCount alive");
  });

  // The collector runs with this same token cascade, and its incremental
  // backwalk is what keeps the tenant's per-star series alive. If we cannot
  // list our own stargazers, neither can it: that is not a scope curiosity,
  // it is the home page quietly freezing. Dismissing exactly this signal as a
  // token artefact is how the 2026-07-22 freeze survived five days.
  await check("contract.collector-token", "CONTRACT", async () => {
    if (now.stargazersOwn === 200) {
      return pass("contract.collector-token", "CONTRACT", "can read our own stargazers");
    }
    const forbidden = now.stargazersOwn === 403 || now.stargazersOwn === 401;
    fail("contract.collector-token", "CONTRACT", forbidden ? "critical" : "warn",
      `cannot list our own stargazers with the ${identity} token (${now.stargazersOwn})`,
      "The collector uses this same cascade, so its incremental backwalk is failing too and the tenant's daily star series is frozen even though every other number keeps updating. Fix: add a user-scoped STARGAZER_TOKEN secret with public repo read access (gh secret set STARGAZER_TOKEN -R santifer/warpchart). Confirm with: gh run view <collect run id> --log | grep backwalk",
      { probe: now.stargazersOwn, identity });
  });

  await check("contract.fuel", "CONTRACT", async () => {
    if (now.rateRemaining != null && now.rateRemaining < 500) {
      fail("contract.fuel", "CONTRACT", "warn", `GitHub rate limit down to ${now.rateRemaining}`,
        "Curve sampling pauses under low fuel and cold repos start serving stale copies. If this is recurring, the token pool needs another PAT.", now);
    } else pass("contract.fuel", "CONTRACT", `${now.rateRemaining ?? "?"} remaining`);
  });

  // Transitions: the actual point of this area.
  await check("contract.transitions", "CONTRACT", async () => {
    if (!prev) {
      pass("contract.transitions", "CONTRACT", `baseline recorded for the ${identity} identity (first run)`);
    } else {
      const moved = Object.keys(now).filter((k) => {
        if (k === "rateRemaining") return false;
        // A probe this runner cannot make is not a change in the world.
        if (unmeasurable(now[k]) || now[k] === "unmeasurable") return false;
        if (unmeasurable(prev[k]) || prev[k] === "unmeasurable") return false;
        // First successful measurement of a probe is a baseline, not a change.
        // Without this, every new probe (and every probe that was previously
        // unmeasurable) announces itself as an upstream moving under us.
        if (prev[k] === undefined) return false;
        return String(prev[k]) !== String(now[k]);
      });
      for (const k of moved) {
        const from = prev[k], to = now[k];
        // The one transition that is GOOD news, and it deserves a concrete plan.
        if (k === "stargazersForeign" && to === 200) {
          fail("contract.transitions", "CONTRACT", "info",
            `GitHub REOPENED stargazer listing for foreign repos (${from} -> ${to})`,
            "Opportunity, not a bug: per-star history for any repo is available again. The probe in restSample (src/lib/curve.ts) already reactivates sampling automatically, so charts will deepen on the next cache cycle - but consider bumping CURVE_VERSION to purge the shallow curves built while it was closed.", { key: k, from, to });
        } else if (k === "stargazersOwn" && to !== 200) {
          fail("contract.transitions", "CONTRACT", "critical",
            `we lost stargazer listing on our OWN repos (${from} -> ${to})`,
            "The tenant's exact curve depends on this. Check the token first (an expired PAT looks exactly like this), then GitHub's changelog.", { key: k, from, to });
        } else if (k === "stargazersForeign" && to !== 200) {
          fail("contract.transitions", "CONTRACT", "warn",
            `foreign stargazer listing changed (${from} -> ${to})`,
            "Foreign per-star history is unavailable; curves fall back to our own daily snapshots. Expected since jun-2026, but verify src/lib/curve.ts still degrades instead of throwing.", { key: k, from, to });
        } else {
          fail("contract.transitions", "CONTRACT", "warn", `upstream capability changed: ${k} ${from} -> ${to}`,
            "An upstream moved under us. Decide whether any source in src/lib/curve.ts depends on the old behaviour before it shows up as a user-visible break.", { key: k, from, to });
        }
      }
      if (!moved.length) pass("contract.transitions", "CONTRACT", "no change since last run");
    }
    // Merge, do not overwrite: a probe this runner could not make must keep the
    // last value somebody DID measure, or the baseline decays to nothing.
    const merged = { ...(prev ?? {}) };
    for (const [k, v] of Object.entries(now)) {
      if (!unmeasurable(v) && v !== "unmeasurable") merged[k] = v;
    }
    await blobPut(BASELINE_KEY, { at: new Date().toISOString(), identity, state: merged, raw: now });
  });

  return now;
}

// =========================================================== PUBLIC =========
// What a visitor actually touches. /compare stayed broken for weeks because
// nothing ever asked it a question.
async function checkPublic() {
  await check("public.curve", "PUBLIC", async () => {
    const broken = [];
    for (const repo of [...FOREIGN, TENANT]) {
      const { status, body } = await fetchJson(`${BASE}/api/curve?repo=${encodeURIComponent(repo)}`, { timeoutMs: 30_000 });
      if (status !== 200 || !body?.pts?.length) {
        broken.push({ repo, status, error: body?.error ?? null, pts: body?.pts?.length ?? 0 });
      }
    }
    if (broken.length) {
      fail("public.curve", "PUBLIC", "critical",
        `/api/curve fails for ${broken.length}/${FOREIGN.length + 1} repos: ${broken.map((b) => `${b.repo} ${b.status}${b.error ? ` (${b.error})` : ""}`).join(" · ")}`,
        "This is the /compare outage of 2026-07-27 recurring: the page cannot add repos. sampleCurve in src/lib/curve.ts must never throw except on a real 404 - find which cascade stage started throwing. Note foreign repos failing while the tenant works points at a permission change upstream, not at our code.",
        broken);
    } else pass("public.curve", "PUBLIC", `${FOREIGN.length + 1} repos answer`);
  });

  await check("public.chart", "PUBLIC", async () => {
    const broken = [];
    for (const repo of [FOREIGN[0], FOREIGN[3], TENANT]) {
      const res = await fetch(`${BASE}/api/chart?repo=${encodeURIComponent(repo)}`, { signal: AbortSignal.timeout(30_000) });
      const text = await res.text();
      if (!res.ok || !text.startsWith("<svg")) broken.push({ repo, status: res.status, head: text.slice(0, 60) });
    }
    if (broken.length) {
      fail("public.chart", "PUBLIC", "critical", `the SVG embed fails for: ${broken.map((b) => `${b.repo} (${b.status})`).join(" · ")}`,
        "Every README embed is served by this route, so a failure here is visible on other people's repos, not just ours.", broken);
    } else pass("public.chart", "PUBLIC", "svg embeds render");
  });

  // The live layer OVERWRITES the server-rendered numbers as soon as a page
  // flips from SYNCING to LIVE, so it can undo a correct render. It did: the
  // neighbour band went to 0/day the moment the indicator cleared, because this
  // endpoint returned the raw unmeasurable nulls while every other consumer
  // filled them from the registry. A live endpoint that disagrees with the page
  // it patches is worse than one that is down.
  await check("public.live-neighbors", "PUBLIC", async () => {
    const { status, body } = await fetchJson(`${BASE}/api/live/neighbors`, { timeoutMs: 30_000 });
    const ns = body?.neighbors ?? [];
    if (status !== 200 || !ns.length) {
      return fail("public.live-neighbors", "PUBLIC", "warn", `/api/live/neighbors returned ${status} with ${ns.length} neighbours`,
        "The dashboard keeps the server-rendered band when this is empty, so nothing breaks visibly - but the live layer is dead. Check src/app/api/live/neighbors/route.ts and the snapshot's neighbour list.");
    }
    const blank = ns.filter((n) => n.v == null || n.v === 0);
    // Some neighbours genuinely sit at 0 (mature, stalled repos), so only a
    // WHOLESALE blank band is a fault.
    if (blank.length >= Math.max(3, ns.length * 0.8)) {
      fail("public.live-neighbors", "PUBLIC", "critical",
        `${blank.length}/${ns.length} live neighbours have no velocity (${blank.slice(0, 3).map((n) => n.r).join(", ")})`,
        "This response replaces the server-rendered band on LIVE, so the whole local band will read 0/day for visitors. GitHub no longer lets us measure a foreign repo's recent stars, so the nulls are expected: the endpoint must fill them from the registry's canonical velocity (canonicalVelocity over loadRoute), like collect.mjs and explorer.ts do.",
        blank.slice(0, 6).map((n) => ({ repo: n.r, v: n.v })));
    } else pass("public.live-neighbors", "PUBLIC", `${ns.length - blank.length}/${ns.length} live neighbours carry a rate`);
  });

  await check("public.pages", "PUBLIC", async () => {
    const pages = ["/", "/compare", "/velocity", "/explore", "/pricing", `/r/${TENANT}`];
    const broken = [];
    for (const p of pages) {
      const res = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!res || !res.ok) broken.push({ page: p, status: res?.status ?? "network" });
    }
    if (broken.length) {
      fail("public.pages", "PUBLIC", "critical", `pages not serving: ${broken.map((b) => `${b.page} (${b.status})`).join(" · ")}`,
        "Check the latest Vercel deployment for a build or render error: vercel ls --prod", broken);
    } else pass("public.pages", "PUBLIC", `${pages.length} pages serve`);
  });

  await check("public.api", "PUBLIC", async () => {
    const eps = [`/api/v1/repo?repo=${TENANT}`, "/api/v1/velocity?limit=5", "/api/v1/overtakes?limit=5", "/api/v1/leaderboard?limit=5", "/api/og"];
    const broken = [];
    for (const e of eps) {
      const res = await fetch(`${BASE}${e}`, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
      if (!res || !res.ok) broken.push({ endpoint: e, status: res?.status ?? "network" });
    }
    if (broken.length) {
      fail("public.api", "PUBLIC", "critical", `API endpoints failing: ${broken.map((b) => `${b.endpoint} (${b.status})`).join(" · ")}`,
        "The public API is a distribution surface (MCP server and CLI read it). A failure here breaks integrations silently.", broken);
    } else pass("public.api", "PUBLIC", `${eps.length} endpoints answer`);
  });
}

// =========================================================== COHERENCE ======
// One repo, one velocity, everywhere. Two pages disagreeing about the same
// number is the credibility bug: it tells a visitor that neither is measured.
async function checkCoherence(route) {
  await check("coherence.velocity", "COHERENCE", async () => {
    const [vel, lead, over] = await Promise.all([
      fetchJson(`${BASE}/api/v1/velocity?limit=50`),
      fetchJson(`${BASE}/api/v1/leaderboard?limit=100`),
      fetchJson(`${BASE}/api/v1/overtakes?limit=50`),
    ]);
    const seen = new Map(); // repo -> { surface -> v }
    const note = (repo, surface, v) => {
      if (v == null || !repo) return;
      const k = repo.toLowerCase();
      if (!seen.has(k)) seen.set(k, {});
      seen.get(k)[surface] = v;
    };
    for (const r of vel.body?.fastest ?? []) note(r.repo, "velocity", r.velocityPerDay);
    for (const r of lead.body?.leaderboard ?? []) note(r.repo, "leaderboard", r.velocityPerDay);
    for (const o of over.body?.overtakes ?? []) {
      note(o.hunter?.repo, "overtakes", o.hunter?.velocityPerDay);
      note(o.victim?.repo, "overtakes", o.victim?.velocityPerDay);
    }
    const conflicts = [];
    for (const [repo, surfaces] of seen) {
      const vals = Object.entries(surfaces);
      if (vals.length < 2) continue;
      const nums = vals.map(([, v]) => v);
      const min = Math.min(...nums), max = Math.max(...nums);
      // tolerate 1 star/day of rounding, nothing more: these must be the same
      // canonical number, not two estimates that happen to be close
      if (max - min > 1) conflicts.push({ repo, surfaces, spread: max - min });
    }
    if (conflicts.length) {
      conflicts.sort((a, b) => b.spread - a.spread);
      fail("coherence.velocity", "COHERENCE", "critical",
        `${conflicts.length} repo(s) show different velocities on different surfaces: ` +
        conflicts.slice(0, 4).map((c) => `${c.repo} (${Object.entries(c.surfaces).map(([s, v]) => `${s}=${v}`).join(", ")})`).join(" · "),
        "Some surface is not reading canonicalVelocity() from src/lib/velocity.ts - it is using the noisy 1-day `v` instead of the canonical 7-day `v7`, or computing its own. Grep for `.v` reads on route entries outside src/lib/velocity.ts. The methodology page publicly promises one trailing 7-day rate, so this is a broken promise, not a detail.",
        conflicts.slice(0, 10));
    } else pass("coherence.velocity", "COHERENCE", `${seen.size} repos agree across surfaces`);
  });

  // An ETA must follow from the numbers shown next to it. If gap/closing does
  // not reproduce the published eta, the projection is reading other inputs.
  await check("coherence.eta", "COHERENCE", async () => {
    const { body } = await fetchJson(`${BASE}/api/v1/overtakes?limit=20`);
    const bad = [];
    for (const o of body?.overtakes ?? []) {
      const closing = (o.hunter?.velocityPerDay ?? 0) - (o.victim?.velocityPerDay ?? 0);
      if (closing <= 0 || o.etaDays == null) continue;
      const expected = o.gap / closing;
      if (pct(expected, o.etaDays) > 0.15) bad.push({ pair: `${o.hunter.repo} -> ${o.victim.repo}`, gap: o.gap, closing, published: o.etaDays, expected: Math.round(expected * 100) / 100 });
    }
    if (bad.length) {
      fail("coherence.eta", "COHERENCE", "critical",
        `${bad.length} published ETA(s) do not follow from the gap and velocities shown beside them: ` +
        bad.slice(0, 3).map((b) => `${b.pair} says ${b.published}d, the numbers give ${b.expected}d`).join(" · "),
        "projectCrossing in src/lib/compare.ts is the single source for crossings. If the endpoint's own numbers do not reproduce its ETA, it is projecting from a different velocity than the one it displays.", bad.slice(0, 8));
    } else pass("coherence.eta", "COHERENCE", "ETAs follow from their inputs");
  });

  // Our stars vs GitHub's stars right now: the ultimate reality check.
  await check("coherence.reality", "COHERENCE", async () => {
    const { body } = await fetchJson(`${BASE}/api/v1/repo?repo=${TENANT}`);
    const live = await gh(`/repos/${TENANT}`);
    const ours = body?.stars, theirs = live.body?.stargazers_count;
    if (!ours || !theirs) return pass("coherence.reality", "COHERENCE", "skipped (missing token or data)");
    const drift = pct(ours, theirs);
    if (drift > 0.02) {
      fail("coherence.reality", "COHERENCE", "critical", `we show ${ours} stars, GitHub says ${theirs} (${(drift * 100).toFixed(1)}% off)`,
        "Beyond normal collection lag. Either the snapshot is frozen or the tenant archive is not being updated - check the collector before anything else.", { ours, theirs });
    } else if (drift > 0.005) {
      fail("coherence.reality", "COHERENCE", "warn", `star count drifting: ours ${ours}, GitHub ${theirs}`,
        "Usually just collection lag between runs. Escalates if it keeps growing across runs.", { ours, theirs });
    } else pass("coherence.reality", "COHERENCE", `within ${(drift * 100).toFixed(2)}% of GitHub`);
  });

  // Rank is a position in a sorted list; it must match the list we publish.
  await check("coherence.rank", "COHERENCE", async () => {
    const { body } = await fetchJson(`${BASE}/api/v1/repo?repo=${TENANT}`);
    const idx = (route?.repos ?? []).findIndex((p) => p.r?.toLowerCase() === TENANT);
    if (idx < 0 || !body?.rank) return pass("coherence.rank", "COHERENCE", "skipped");
    if (Math.abs(body.rank - (idx + 1)) > 1) {
      fail("coherence.rank", "COHERENCE", "warn", `the API says rank #${body.rank}, the registry position is #${idx + 1}`,
        "The API is serving a different (probably cached) registry than the one in the Blob. Confirm the deploy pulled fresh data: the build's prebuild step downloads data/ from the Blob.", { api: body.rank, registry: idx + 1 });
    } else pass("coherence.rank", "COHERENCE", `#${body.rank} matches the registry`);
  });
}

// =========================================================== CURVE ==========
// Are the charts shaped like real history, or like a placeholder?
async function checkCurves() {
  await check("curve.shape", "CURVE", async () => {
    const problems = [];
    for (const repo of FOREIGN) {
      const { status, body } = await fetchJson(`${BASE}/api/curve?repo=${encodeURIComponent(repo)}`, { timeoutMs: 30_000 });
      if (status !== 200 || !body?.pts?.length) continue; // already reported by public.curve
      const pts = body.pts;
      if (pts.some((p, i) => i > 0 && p.t < pts[i - 1].t)) {
        problems.push({ repo, issue: "points are not in chronological order" });
      }
      const last = pts[pts.length - 1];
      if (body.total && pct(last.v, body.total) > 0.02) {
        problems.push({ repo, issue: `the curve ends at ${last.v} but the total is ${body.total}` });
      }
      if (body.degraded) {
        problems.push({ repo, issue: "served the two-point floor (no per-day source reached)" });
      }
      // a top-1000 repo must be using our own daily record; if it is not, the
      // moat is not reaching the chart and we are back to third-party shape
      if (body.exactFrom == null) {
        problems.push({ repo, issue: "no exact daily window from our own rank-history" });
      }
    }
    if (problems.length) {
      fail("curve.shape", "CURVE", "warn",
        problems.map((p) => `${p.repo}: ${p.issue}`).join(" · "),
        "A top-1000 repo should always reach stage 2 of the cascade (repoRankTrajectory). If it does not, the rank-history shards are unreadable from the render path, or the curve cache predates the fix - bump CURVE_VERSION in src/lib/curve.ts to purge.",
        problems);
    } else pass("curve.shape", "CURVE", `${FOREIGN.length} curves well-formed`);
  });
}

// =========================================================== INVENTORY ======
// Coverage by construction rather than by memory. Every check above exists
// because a specific thing broke; that is a list of past symptoms, not of the
// system. Three separate outages (the tenant series, the collision scan, the
// Vital Signs panel) were each found by a human, and each time the honest
// answer to "what else is stale?" was "I would have to remember to look".
//
// So: enumerate what the system actually STORES, and require every family to be
// declared with the cadence it is supposed to keep. A family nobody declared is
// itself a finding - it means an artifact exists that no one is watching. That
// is the property the curated checks cannot have.
const ARTIFACTS = [
  // periodic: produced on a schedule; silence past maxAgeH means it stopped
  { prefix: "data/route.json", kind: "periodic", maxAgeH: 36, what: "the top-1000 registry" },
  { prefix: "data/history.jsonl", kind: "periodic", maxAgeH: 6, what: "tenant snapshots" },
  { prefix: "data/stargazer_timestamps.txt", kind: "periodic", maxAgeH: 6, what: "the tenant's per-star series" },
  { prefix: "data/meta.json", kind: "periodic", maxAgeH: 6, what: "tenant repo metadata" },
  { prefix: "data/milestones.json", kind: "periodic", maxAgeH: 36, what: "rank milestones" },
  { prefix: "data/collisions.json", kind: "periodic", maxAgeH: 36, what: "the overtake scan" },
  { prefix: "data/catalog.json", kind: "periodic", maxAgeH: 36, what: "the rising catalog" },
  { prefix: "data/route-prev.json", kind: "periodic", maxAgeH: 72, what: "the previous registry (velocity baseline)" },
  { prefix: "data/enrichment.json", kind: "periodic", maxAgeH: 72, what: "repo enrichment" },
  { prefix: "data/forensics.json", kind: "periodic", maxAgeH: 72, what: "spike forensics" },
  { prefix: "data/attribution.json", kind: "periodic", maxAgeH: 72, what: "spike attribution" },
  { prefix: "data/indexnow-stamp.txt", kind: "periodic", maxAgeH: 48, what: "the IndexNow ping stamp" },
  { prefix: "route-history/", kind: "periodic", maxAgeH: 36, what: "the daily rank moat" },
  { prefix: "vitals/", kind: "periodic", maxAgeH: 72, what: "the Vital Signs panel" },
  { prefix: "contributors/", kind: "periodic", maxAgeH: 12, what: "the contributor census (cohorts source)" },
  { prefix: "traffic/", kind: "periodic", maxAgeH: 12, what: "the Traffic Vault" },
  { prefix: "health/", kind: "periodic", maxAgeH: 6, what: "this watchdog's own output" },
  { prefix: "live/", kind: "periodic", maxAgeH: 12, what: "live star polling" },
  { prefix: "badges-earned.json", kind: "periodic", maxAgeH: 36, what: "earned badges" },
  // Declared so they are WATCHED, not so they are shown: nothing reads these
  // keys but the owner. Declaring them also keeps `inventory.undeclared` from
  // naming the `private/` family in the watchdog's PUBLIC issue. If one goes
  // stale the issue names the file and its age, never a number from inside it.
  // Listed individually rather than as a `private/` prefix because they have
  // genuinely different cadences, and one declaration would hide the other:
  // followers writes every run, installs only when an event fires.
  { prefix: "private/followers.json", kind: "periodic", maxAgeH: 12, what: "the owner's private standing series" },
  // event: written only when something happens outside; silence is information,
  // never a failure
  { prefix: "embeds/", kind: "event", what: "first sighting of an embed on GitHub" },
  { prefix: "codex/", kind: "event", what: "LLM dossiers, written on first visit to a repo" },
  { prefix: "alerts/", kind: "event", what: "alert dedup state" },
  // Silence here is the normal state and means "no install wave since the last
  // one": in 63 days of history exactly one day qualified. Never a failure.
  { prefix: "private/installs.json", kind: "event", what: "detected install waves (private)" },
  // config: edited by a human, age means nothing
  { prefix: "data/tenants.json", kind: "config", what: "the paying-tenant list" },
];

async function checkInventory() {
  await check("inventory.coverage", "INVENTORY", async () => {
    if (!BLOB_TOKEN) return pass("inventory.coverage", "INVENTORY", "no Blob token, skipped");
    const { list } = await import("@vercel/blob");
    let cursor, blobs = [];
    do {
      const r = await list({ token: BLOB_TOKEN, cursor, limit: 1000 });
      blobs.push(...r.blobs);
      cursor = r.cursor;
    } while (cursor);

    // newest upload per declared family, so one live file proves the family runs
    const newest = new Map();
    const undeclared = new Map();
    for (const b of blobs) {
      const t = new Date(b.uploadedAt).getTime();
      const decl = ARTIFACTS.find((a) => b.pathname === a.prefix || (a.prefix.endsWith("/") && b.pathname.startsWith(a.prefix)));
      const key = decl ? decl.prefix : (b.pathname.includes("/") ? b.pathname.split("/")[0] + "/" : b.pathname);
      const bag = decl ? newest : undeclared;
      if (!bag.has(key) || bag.get(key) < t) bag.set(key, t);
    }

    const stale = [];
    const missing = [];
    for (const a of ARTIFACTS) {
      if (a.kind !== "periodic") continue;
      const t = newest.get(a.prefix);
      if (t === undefined) { missing.push(a); continue; }
      const h = (Date.now() - t) / HOUR;
      if (h > a.maxAgeH) stale.push({ ...a, ageH: h });
    }

    if (stale.length) {
      stale.sort((x, y) => y.ageH / y.maxAgeH - x.ageH / x.maxAgeH);
      fail("inventory.coverage", "INVENTORY", "critical",
        `${stale.length} artifact family(ies) stopped updating: ` +
        stale.map((s) => `${s.prefix} (${s.what}) ${s.ageH > 48 ? (s.ageH / 24).toFixed(1) + "d" : s.ageH.toFixed(0) + "h"} old, expected <${s.maxAgeH}h`).join(" · "),
        "Find the collector step that writes it and read its log. Remember the step may report success: continue-on-error rewrites a failed step to success, so check the run's ANNOTATIONS, not the step conclusion.",
        stale.map((s) => ({ prefix: s.prefix, ageHours: Math.round(s.ageH), maxAgeH: s.maxAgeH })));
    } else if (missing.length) {
      fail("inventory.coverage", "INVENTORY", "warn",
        `declared but absent: ${missing.map((m) => m.prefix).join(", ")}`,
        "Either the producer never ran, or the artifact was renamed and this declaration is stale. Both are worth a minute.");
    } else {
      pass("inventory.coverage", "INVENTORY", `${ARTIFACTS.filter((a) => a.kind === "periodic").length} periodic families current`);
    }

    // The point of the whole area: something exists that nobody declared.
    if (undeclared.size) {
      const rows = [...undeclared.entries()].map(([k, t]) => ({ family: k, ageHours: Math.round((Date.now() - t) / HOUR) }));
      fail("inventory.undeclared", "INVENTORY", "warn",
        `${undeclared.size} artifact family(ies) nobody is watching: ${rows.map((r) => `${r.family} (newest ${r.ageHours}h old)`).join(" · ")}`,
        "Add each to ARTIFACTS in collector/health.mjs with its expected cadence (periodic/event/config), or delete it if it is an orphan from an older design. An undeclared artifact is one nobody would notice going stale - which is exactly how the Vital Signs panel sat frozen for eight days.",
        rows);
    }
  });
}

// =========================================================== PIPELINE =======
// Reading our own build logs. Almost every collector step is `continue-on-error`
// (correct: one flaky upstream must not cost the whole snapshot), which means a
// step can fail on EVERY run forever and the workflow still shows green. That is
// a blind spot by construction, so somebody has to read the logs. This does.
async function checkPipeline() {
  const repo = process.env.GITHUB_REPOSITORY ?? "santifer/warpchart";
  await check("pipeline.chronic-step", "PIPELINE", async () => {
    const runs = await gh(`/repos/${repo}/actions/workflows/collect.yml/runs?per_page=8&status=completed`);
    const list = runs.body?.workflow_runs ?? [];
    if (!list.length) return pass("pipeline.chronic-step", "PIPELINE", "no runs to inspect");

    const failCount = new Map();
    const cancelled = list.filter((r) => r.conclusion === "cancelled").length;
    let inspected = 0;
    for (const r of list.slice(0, 6)) {
      const jobs = await gh(`/repos/${repo}/actions/runs/${r.id}/jobs`);
      if (!jobs.body?.jobs) continue;
      inspected++;
      for (const j of jobs.body.jobs) {
        // steps[].conclusion is USELESS here: continue-on-error rewrites a
        // failed step to "success" in the API. This check exists precisely to
        // find failures masked by continue-on-error, so reading conclusion made
        // it blind to its own subject - it reported "no chronic failures" while
        // Compute Vital Signs timed out on every single run for eight days.
        // Annotations keep the truth.
        const url = (j.check_run_url ?? "").replace("https://api.github.com", "");
        if (!url) continue;
        const ann = await gh(`${url}/annotations`);
        for (const a of ann.body ?? []) {
          if (a.annotation_level !== "failure") continue;
          // "The action 'X' has timed out..." / "Process completed with exit code N"
          const step = /action '([^']+)'/.exec(a.message ?? "")?.[1] ?? (a.title || "unnamed step");
          failCount.set(step, (failCount.get(step) ?? 0) + 1);
        }
      }
    }
    const chronic = [...failCount.entries()].filter(([, n]) => inspected && n / inspected >= 0.5);

    if (chronic.length) {
      fail("pipeline.chronic-step", "PIPELINE", "warn",
        `step(s) failing on most recent runs while the workflow still reports success: ` +
        chronic.map(([name, n]) => `"${name}" (${n}/${inspected})`).join(" · "),
        "These are masked by continue-on-error, so nobody sees them. Either the step is genuinely broken (fix it) or it is dead weight (delete it) - a step that always fails is telling you its output is not actually being used. Read one run: gh run view <id> --log",
        chronic.map(([name, n]) => ({ step: name, failedRuns: n, inspected })));
    } else pass("pipeline.chronic-step", "PIPELINE", `${inspected} runs inspected, no chronic step failures`);

    if (cancelled >= 2) {
      fail("pipeline.cancelled", "PIPELINE", "critical",
        `${cancelled} of the last ${list.length} collector runs were CANCELLED`,
        "A cancelled run usually means the job hit its timeout, which kills the remaining steps silently - including 'Trigger deploy'. That is exactly how the site froze on 2026-07-19. Find the step that overran and give it its own timeout-minutes rather than raising the job's.",
        { cancelled, of: list.length });
    }
  });
}

// Findings that keep coming back do not need the same remedy repeated every two
// hours: they need a structural fix. Recurrence is what tells them apart.
async function annotateRecurrence(findings) {
  const hist = (await blobJson("health/history.json").catch(() => null))?.runs ?? [];
  if (hist.length < 3) return;
  const recent = hist.slice(-5);
  for (const f of findings) {
    const seen = recent.filter((r) => (r.ids ?? []).includes(f.id)).length;
    if (seen >= 3) {
      f.recurring = seen;
      f.remedy += ` [RECURRING: seen in ${seen} of the last ${recent.length} runs. A finding this persistent is not an incident, it is a design problem - fix the cause or change the check, but do not keep paying attention to it twice an hour.]`;
    }
  }
}

// =========================================================== report =========
function severityRank(s) { return s === "critical" ? 0 : s === "warn" ? 1 : 2; }

function renderMarkdown(summary) {
  const L = [];
  L.push(`# Health report - ${summary.at}`);
  L.push("");
  L.push(`Target: ${BASE} · checks run: ${summary.total} · passed: ${summary.passed}`);
  L.push("");
  if (!summary.findings.length) {
    L.push("All checks pass. Nothing to do.");
    return L.join("\n");
  }
  const icon = { critical: "🔴", warn: "🟡", info: "🔵" };
  for (const f of summary.findings) {
    L.push(`## ${icon[f.severity]} ${f.id} · ${f.area}`);
    L.push("");
    L.push(`**What happened:** ${f.detail}`);
    L.push("");
    L.push(`**What to do:** ${f.remedy}`);
    if (f.evidence) {
      L.push("");
      L.push("<details><summary>Evidence</summary>");
      L.push("");
      L.push("```json");
      L.push(JSON.stringify(f.evidence, null, 2).slice(0, 2500));
      L.push("```");
      L.push("");
      L.push("</details>");
    }
    L.push("");
  }
  return L.join("\n");
}

function renderConsole(summary) {
  const icon = { critical: "🔴", warn: "🟡", info: "🔵" };
  const L = [`\nHEALTH ${BASE} · ${summary.passed}/${summary.total} checks pass\n`];
  for (const f of summary.findings) {
    L.push(`${icon[f.severity]} [${f.area}] ${f.id}`);
    L.push(`   ${f.detail}`);
    L.push(`   -> ${f.remedy}`);
    L.push("");
  }
  if (!summary.findings.length) L.push("everything green\n");
  return L.join("\n");
}

// =========================================================== main ===========
async function main() {
  const route = await blobJson("data/route.json").catch(() => null);
  if (!route) {
    fail("bootstrap.route", "DATA", "warn", "could not read data/route.json from the Blob",
      "DATA and COHERENCE checks that need the registry were skipped. Verify BLOB_READ_WRITE_TOKEN is set for this job.");
  }

  await checkFreshness(route);
  if (route) await checkData(route);
  await checkContracts();
  await checkPublic();
  await checkCoherence(route);
  await checkCurves();
  await checkInventory();
  await checkPipeline();

  await annotateRecurrence(findings).catch(() => {});
  findings.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const counts = {
    critical: findings.filter((f) => f.severity === "critical").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    info: findings.filter((f) => f.severity === "info").length,
  };
  const summary = {
    at: new Date().toISOString(),
    base: BASE,
    total: checked.length + findings.length,
    passed: checked.length,
    counts,
    findings,
    checked,
    purges: (route?.repos ?? []).filter((p) => p.purge).map((p) => ({ repo: p.r, day: p.purge })),
  };

  if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
  else console.log(renderConsole(summary));

  if (REPORT_PATH) writeFileSync(REPORT_PATH, renderMarkdown(summary));

  // Persist for trend analysis and for the next run's purge/contract diffing.
  await blobPut("health/latest.json", summary).catch(() => {});
  try {
    const hist = (await blobJson("health/history.json").catch(() => null)) ?? { runs: [] };
    hist.runs.push({ at: summary.at, counts, ids: findings.map((f) => f.id) });
    hist.runs = hist.runs.slice(-500);
    await blobPut("health/history.json", hist);
  } catch { /* history is a nicety, never a failure */ }

  if (!NO_FAIL && counts.critical > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[health] the watchdog itself crashed: ${err?.stack ?? err}`);
  process.exit(NO_FAIL ? 0 : 1);
});
