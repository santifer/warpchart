// CI CHECKOUTS: count, per UTC day, the house repo's own GitHub Actions
// checkout jobs, so the Traffic Vault can show its daily clone count as a CI
// band (TrafficPanel, TOTAL mode). The method and why it is a band, not one
// number, are in collector/ci-checkouts-core.mjs.
//
// Written to the PRIVATE Blob, ci-checkouts/{owner}--{name}.json:
//   { v, repo, range: { low, high }, updatedAt,
//     days: { D: { runs, checkouts, wf: { workflowId: { name, n, r } } } } }
// A day is counted once, when final, and never rewritten. A day costs its
// list pages (~1 per 100 runs) plus one jobs read per workflow that ran (its
// checkout jobs per run THAT day). Each run stops starting days past --budget
// calls (default 150; one day can overshoot it by its own cost) or 150 s
// (the step has 4 min): yesterday first, then the oldest missing days back to
// the vault's first day, so a backfill finishes over a few runs.
//
// VALIDATE BEFORE WRITING: a time slice must list exactly its total_count of
// runs (the API stops at 1,000 per query, so slices are halved, down to a
// minute), a day that errors is skipped and retried next run (the days
// counted before it are still written), a read of the record that fails stops
// the run, and a write that would lose a day is refused.
//
// Usage: BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/ci-checkouts.mjs [--budget N] [--out file] [--seed file]
// --out is a dry run: it reads the Blob but writes only the file. --seed (dry
// runs only) starts from an earlier --out file instead of the Blob record.
import { writeFileSync } from "node:fs";
import { canonicalRepo, ghFetch, readConfig } from "./lib.mjs";
import { blobExists, markComplete, markPartial, writeJson } from "./blob.mjs";
import { countDay, dayIsFinal, dayOrder, hasCheckout, losesHistory, mergeRecord } from "./ci-checkouts-core.mjs";
import { readFileSync } from "node:fs";

const FAMILY = "ci-checkouts";
const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const OUT = arg("--out");
const num = (k, def) => (args.includes(k) ? Number(arg(k)) : def);
const BUDGET = num("--budget", 150);
if (!(BUDGET > 0) || !(num("--seconds", 150) > 0)) {
  console.log("[ci-checkouts] --budget and --seconds must be positive numbers; nothing done");
  process.exit(1);
}
const SEED = arg("--seed");
const TIME_BUDGET_MS = num("--seconds", 150) * 1000;
const started = Date.now();
if (SEED && !OUT) {
  console.log("[ci-checkouts] --seed is for dry runs and needs --out; nothing done");
  process.exit(1);
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
const repo = canonicalRepo(readConfig().repo);
const KEY = `ci-checkouts/${repo.toLowerCase().replace("/", "--")}.json`;
const VAULT = `traffic/${repo.toLowerCase().replace("/", "--")}.json`;

let calls = 0;
// the deadline is checked on EVERY call, not only between days: ghFetch can
// sleep up to 3 x 120 s on a rate limit, longer than the step's 4 minutes,
// and a step killed mid-day writes nothing at all
// ...and it bounds the call itself: a call that starts in time but sleeps on
// a rate limit is cut at the deadline, so the day is skipped and what was
// counted still gets written before the step's 4 minutes run out
const gh = (path) => {
  const left = TIME_BUDGET_MS + 60e3 - (Date.now() - started);
  if (left <= 0) throw new Error("out of time");
  calls++;
  return Promise.race([
    ghFetch(path),
    new Promise((_, reject) => setTimeout(() => reject(new Error("out of time")), left).unref()),
  ]);
};

// 200 -> JSON, a CONFIRMED 404 -> null, anything else THROWS (as trending-marks.mjs)
async function readJson(key) {
  const { get } = await import("@vercel/blob");
  const res = await get(key, { access: "private", token, useCache: false });
  if (!res || res.statusCode === 404) {
    const exists = await blobExists(key);
    if (exists !== false) throw new Error(`${key}: read said missing, head said ${exists === true ? "present" : "unknown"}`);
    return null;
  }
  if (res.statusCode !== 200 || !res.stream) throw new Error(`${key}: HTTP ${res.statusCode}`);
  return JSON.parse(await new Response(res.stream).text());
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const runsPath = (from, to, page) =>
  `/repos/${repo}/actions/runs?created=${iso(from)}..${iso(to)}&per_page=100&page=${page}&exclude_pull_requests=true`;

// every run created in [from, to]; halves the slice while the API would cap
// it at 1,000, and throws if what it listed is not what it said it had
async function listRange(from, to) {
  const first = await gh(runsPath(from, to, 1));
  const total = first.total_count ?? 0;
  if (total >= 1000) {
    if (to - from <= 60e3) throw new Error(`over 1,000 runs in one minute from ${iso(from)}`);
    const mid = from + Math.floor((to - from) / 2);
    return [...(await listRange(from, mid)), ...(await listRange(mid + 1000, to))];
  }
  const runs = [...(first.workflow_runs ?? [])];
  for (let p = 2; runs.length < total; p++) {
    const page = await gh(runsPath(from, to, p));
    if (!page.workflow_runs?.length) break;
    runs.push(...page.workflow_runs);
  }
  if (runs.length !== total) throw new Error(`listed ${runs.length} of ${total} runs from ${iso(from)}`);
  return runs;
}

const listDay = (day) => {
  const t = Date.parse(`${day}T00:00:00Z`);
  return listRange(t, t + 864e5 - 1000);
};

// checkout jobs of one real run (the workflow's ratio that day)
async function checkoutJobs(runId) {
  const j = await gh(`/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`);
  return (j.jobs ?? []).filter(hasCheckout).length;
}

const DAY = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

async function main() {
  if (!token && !OUT) {
    console.log("[ci-checkouts] no BLOB_READ_WRITE_TOKEN, skipping");
    return;
  }
  const prev = SEED ? JSON.parse(readFileSync(SEED, "utf8")) : token ? await readJson(KEY) : null; // throws on a transient error: nothing written
  const vault = token ? await readJson(VAULT).catch(() => null) : null;
  // without the vault the first day is unknown: count the last 14 and never
  // call the record complete on that basis
  const vaultRead = !!vault?.clones;
  const firstDay = Object.keys(vault?.clones ?? {}).sort()[0] ?? isoDay(Date.now() - 14 * DAY);

  // final days not yet counted: yesterday first, then the oldest missing
  const final = [];
  for (let t = Date.parse(`${firstDay}T00:00:00Z`); dayIsFinal(isoDay(t)); t += DAY) final.push(isoDay(t));
  const order = dayOrder(final, prev?.days);

  const days = {};
  const failed = [];
  for (const day of order) {
    if (calls >= BUDGET || Date.now() - started > TIME_BUDGET_MS) break;
    try {
      const c = await countDay(day, { listDay, readJobs: checkoutJobs });
      if (!c) throw new Error("a workflow's ratio is unknown");
      days[day] = c;
      console.log(`[ci-checkouts] ${day}: ${c.runs} runs ran jobs, ${c.checkouts} checkout jobs`);
    } catch (e) {
      // skipped, not fatal: the days already counted still get written, and
      // this one is retried next run
      failed.push(day);
      console.log(`[ci-checkouts] ${day}: not counted (${e?.message ?? e})`);
    }
  }

  const next = mergeRecord(prev, { repo, at: iso(Date.now()), days });
  const lost = losesHistory(prev, next);
  if (lost) {
    if (!OUT) await markPartial(FAMILY, { reason: `refused: ${lost}` });
    console.log(`[ci-checkouts] REFUSED: ${lost}`);
    return;
  }
  const left = final.filter((d) => !next.days[d]).length;
  if (OUT) writeFileSync(OUT, JSON.stringify(next, null, 2));
  else {
    await writeJson(KEY, next);
    if (left || !vaultRead) await markPartial(FAMILY, { reason: `${vaultRead ? "" : "vault unreadable, first day unknown; "}${left} final day(s) still to count${failed.length ? `; failed: ${failed.slice(0, 3).join(", ")}` : ""}` });
    else await markComplete(FAMILY);
  }
  console.log(`[ci-checkouts] ${Object.keys(days).length} day(s) counted this run in ${calls} calls; ${Object.keys(next.days).length} counted, ${left} to go`);
}

// exit when done: a call cut at the deadline may still be sleeping inside ghFetch
main().then(() => process.exit(0), async (e) => {
  // never fails the collect run, but leaves a trace
  console.error(`[ci-checkouts] ${e?.message ?? e}`);
  if (!OUT) await markPartial(FAMILY, { reason: `nothing written: ${e?.message ?? e}` }).catch(() => {});
  process.exit(0);
});
