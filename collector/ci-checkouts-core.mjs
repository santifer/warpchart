// CI CHECKOUTS, the pure half of collector/ci-checkouts.mjs: how much of a
// repo's daily CLONE count (Traffic Vault) is its own GitHub Actions.
//
// Every actions/checkout is a clone in GitHub's traffic. What we COUNT, per
// UTC day, is the repo's checkout jobs: the day's workflow runs that actually
// ran jobs, each times its workflow's checkout jobs per run THAT DAY, read
// from one real run of the workflow that day. Per day, not per month: Tests
// went from 1 to 3 to 5 checkout jobs between late July and mid August, and
// Label PRs gained a checkout on 13 Sep (the review measured ~7,000 August
// checkouts lost to a monthly sample).
//
// What we do NOT count: how many clones one checkout job registers (it inits
// and fetches; each git request counts). It is not a constant: fitted on 141
// days of career-ops (Jun-Oct 2026, per-day ratios, ghosts out) the slope per
// month runs 1.6-4.7, one factor per workflow did no better (17-37% error out
// of sample), and warpchart's own CI reads ~4.5. So the split is a BAND whose
// edges are NOT fitted:
//   CI at least   = checkouts x 1   a checkout job is at least one clone
//                                   (the premise of the whole count)
//   CI or not     = checkouts x 1..5
//   not our CI    = the rest, at least clones - checkouts x 5, the ceiling
//                   sitting above every monthly slope seen
// A floor read off the data would be wrong: the lowest day (2.54 clones per
// checkout) bounds the factor from ABOVE, and two months fit under 2.
// "Not our CI" is not "people": installs (npx init clones the repo),
// contributors and their agents, and the odd few actors cloning in a loop
// (13 Oct 2026: 24,447 clones from 2,032 unique cloners). Only the TOTAL clone
// series is split: unique cloners dedupe by IP and runners share IP pools.
export const CI_CLONES_PER_CHECKOUT = { low: 1, high: 5 };

// conclusions whose run executed jobs; cancelled counts in full (an upper
// bound: a cancelled run may have stopped before its later jobs)
const RAN = new Set(["success", "failure", "cancelled", "timed_out", "neutral"]);

// A GHOST: a fork PR's run that waited for approval and was closed days later
// as failure/cancelled with no job ever run. First attempt, and touched more
// than 24 h after it "started" (a run that ran jobs ends within hours; a
// re-run would be attempt 2). 29 of 33 failures on 20 Sep 2026 were ghosts:
// counted, they invented 17% of that day's checkouts, and only on days
// counted late (a live count at +2 h sees them still waiting).
export function isGhost(run) {
  if (!["failure", "cancelled"].includes(run?.conclusion) || (run.run_attempt ?? 1) !== 1) return false;
  const lagH = (Date.parse(run.updated_at) - Date.parse(run.run_started_at ?? run.created_at)) / 3600e3;
  return lagH > 24;
}

export const ranJobs = (run) => RAN.has(run?.conclusion) && !isGhost(run);

// a job that ran and has a checkout step ("Run actions/checkout@v4",
// "Checkout", "Check out repo")
export const hasCheckout = (job) =>
  job?.conclusion !== "skipped" && (job?.steps ?? []).some((s) => /check ?out/i.test(s?.name ?? ""));

// runs (one UTC day, the API's workflow_runs objects) -> per workflow:
// { name, n: runs that ran jobs, ids: the ids of its successes in time order
// (a failed run may have stopped early), or of any run when none succeeded }
export function tallyRuns(runs) {
  const by = new Map();
  const sorted = [...(runs ?? [])].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  for (const r of sorted) {
    if (!ranJobs(r)) continue;
    let e = by.get(r.workflow_id);
    if (!e) by.set(r.workflow_id, (e = { name: r.name, n: 0, ok: [], any: [] }));
    e.n++;
    (r.conclusion === "success" ? e.ok : e.any).push(r.id);
  }
  for (const e of by.values()) {
    e.ids = e.ok.length ? e.ok : e.any;
    delete e.ok;
    delete e.any;
  }
  return by;
}

// The workflow's checkout jobs per run that day. Its first and last run are
// read; if they agree, that is the day's figure. If not, the workflow changed
// that day (Tests on 4 Aug 2026: 4 checkout jobs until 06:41, 5 from 10:18),
// so three more runs spread over the day are read and the five averaged.
// readJobs(id) -> checkout jobs of that run.
export async function dayRatio(ids, readJobs) {
  if (!ids?.length) return null;
  const first = await readJobs(ids[0]);
  const last = ids.length > 1 ? await readJobs(ids[ids.length - 1]) : first;
  if (first === last) return first;
  // up to 5 runs: read them all; more: three distinct ones spread between
  const mid = ids.length <= 5 ? ids.slice(1, -1) : [...new Set([1, 2, 3].map((k) => ids[Math.floor((k * (ids.length - 1)) / 4)]))];
  const all = [first, last];
  for (const id of mid) all.push(await readJobs(id));
  return Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 100) / 100;
}

// One day, end to end: list its runs, read each workflow's ratio, sum.
// null when a ratio is unknown. listDay(day) -> runs, readJobs(id) -> n.
export async function countDay(day, { listDay, readJobs }) {
  const tally = tallyRuns(await listDay(day));
  const ratio = {};
  for (const [id, e] of tally) ratio[id] = await dayRatio(e.ids, readJobs);
  return checkoutsOfDay(tally, (id) => ratio[id]);
}

// checkout jobs of the day. ratioOf(workflowId) = mean checkout jobs per run,
// or undefined when unknown. A day with any workflow of unknown ratio is NOT
// countable (null): a missing ratio read as 0 would hand its clones to users.
// ratioOf(workflowId) = checkout jobs per run that day. wf keeps, per
// workflow, its runs and that ratio, so the day can be re-read later.
export function checkoutsOfDay(tally, ratioOf) {
  let runs = 0;
  let checkouts = 0;
  const wf = {};
  for (const [id, e] of tally) {
    const r = ratioOf(id);
    if (r == null || !Number.isFinite(r)) return null;
    runs += e.n;
    checkouts += e.n * r;
    wf[id] = { name: e.name, n: e.n, r };
  }
  return { runs, checkouts: Math.round(checkouts), wf };
}

// final days still to count, yesterday first (the live edge), then the oldest
export function dayOrder(final, counted) {
  const todo = final.filter((d) => !counted?.[d]);
  return todo.length ? [todo[todo.length - 1], ...todo.slice(0, -1)] : [];
}

// a UTC day is final once it is over plus a grace (runs are created when
// their trigger fires, so a day's list stops growing when the day ends)
export const dayIsFinal = (day, now = Date.now(), graceH = 2) =>
  Date.parse(`${day}T00:00:00Z`) + 864e5 + graceH * 3600e3 <= now;

// the TOTAL clones of a day as the band above: { ciMin, unsure, notCiMin },
// which add up to the day's clones. null when either side is unmeasured: the
// chart then draws the plain clone line for that day.
export function ciSplit(clones, checkouts, range = CI_CLONES_PER_CHECKOUT) {
  if (!Number.isFinite(clones) || !Number.isFinite(checkouts)) return null;
  const lo = Math.min(clones, Math.round(checkouts * range.low));
  const hi = Math.min(clones, Math.round(checkouts * range.high));
  return { ciMin: lo, unsure: hi - lo, notCiMin: clones - hi };
}

// next record from prev + newly counted days. Days already counted are final
// and are never rewritten.
export function mergeRecord(prev, { repo, at, days }) {
  const next = { v: 2, repo, range: CI_CLONES_PER_CHECKOUT, updatedAt: at, days: { ...(prev?.days ?? {}) } };
  for (const [d, e] of Object.entries(days ?? {})) if (!next.days[d]) next.days[d] = e;
  return next;
}

// a reason string when next would lose a day prev had, else null
export function losesHistory(prev, next) {
  const lost = Object.keys(prev?.days ?? {}).filter((d) => !next?.days?.[d]);
  return lost.length ? `would drop ${lost.length} counted day(s): ${lost.slice(0, 3).join(", ")}` : null;
}
