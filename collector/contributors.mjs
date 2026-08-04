// Contributor census for the unlocked repos (the owned ones + paying tenants):
// WHO has ever landed a commit on the default branch, and WHEN each person's
// first one landed. From those two facts every curve the panel wants is
// derivable forever: cumulative contributors over time, new per month, active
// per month, bus factor.
//
// WHY COMMITS AND NOT ANY OF GITHUB'S CONTRIBUTOR SURFACES. Measured on
// 2026-08-04 against career-ops (244 by the API's own count):
//   /contributors           -> exact count, but NO dates: cannot draw evolution
//   /stats/contributors     -> weekly series, but capped at 100 of the 244
//   /graphs/contributors-data (web) -> capped at 100, ignores ?from=&to=
//   commit history          -> 1,103 commits, 12 calls, complete AND dated
// For a repo we control, the commit log is the only source that is both. The
// technique's ceiling is tens of thousands of commits (a kernel-sized tenant
// would need GH Archive instead); every currently unlocked repo fits with room.
//
// WHY THIS ALSO OWNS THE COHORTS. vitals.mjs derived new-vs-returning cohorts
// from its merged-PR sweep, whose `want = 1000` cap covered the entire history
// only while the repo stayed under 1000 merged PRs. career-ops crossed 837 on
// 2026-08-04 at ~3.2 merges/day: around late September the window would have
// silently stopped covering April, and April's people would have started
// reading as "new" on their next PR - the numbers changing while the project
// did not. A count-defined window is a time bomb; a census has no window.
//
// PRIVACY, BY CONSTRUCTION. Commits expose author emails; this store never
// keeps one. A linked account is stored as its public login; an unlinked email
// becomes a salted hash - enough to count the person once, useless to identify
// them. The store feeds a public panel, so it must contain nothing the panel
// could leak.
//
// Usage: BLOB_READ_WRITE_TOKEN=... GH_TOKEN=... node collector/contributors.mjs
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { put, get } from "@vercel/blob";
import { DATA_DIR, ghFetch, readConfig, sleep } from "./lib.mjs";

const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
if (!blobToken) {
  console.log("[contributors] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

const config = readConfig();
const OWNED = ((config.owned_by ?? [config.repo.split("/")[0]]) || []).map((o) => o.toLowerCase());

const storeKey = (repo) => `contributors/${repo.toLowerCase().replace("/", "--")}.json`;

// Same bot rules as vitals.mjs, so the two surfaces never disagree about who
// counts as a person. careerops-ledger is the manifesto's service account: it
// commits under a human-shaped login (59 commits by 2026-08-04) and sat inside
// the census's "next 4" bus-factor band until someone recognised it.
const BOTS = new Set([
  "github-actions", "renovate", "dependabot", "renovate-bot", "codecov",
  "careerops-ledger",
]);
const isBotLogin = (l) => !l || BOTS.has(l.toLowerCase()) || l.toLowerCase().endsWith("[bot]");

// AI pairing tools credited in Co-authored-by trailers. They are excluded from
// the people count (an agent is not a contributor) but COUNTED, because "how
// much of this repo is built in agentic pairing" is itself a signal.
const AI_CO = /copilot|claude|devin|openhands|cursor|\bbot\b|\[bot\]/i;

// Backfill ceiling: 400 pages = 40,000 commits. A repo past it does not get a
// census AT ALL rather than a silently truncated one - a partial history would
// draw a confidently wrong curve, which is the exact bug class (a sample
// published as a total) this collector exists to end.
const MAX_PAGES = 400;

async function readBlob(key) {
  try {
    const res = await get(key, { access: "private", token: blobToken, useCache: false });
    if (res?.statusCode === 200 && res.stream) return JSON.parse(await new Response(res.stream).text());
  } catch {
    /* missing or transient */
  }
  return null;
}
async function writeBlob(key, obj) {
  await put(key, JSON.stringify(obj), {
    access: "private",
    token: blobToken,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

// Identity: public login when the commit is linked to an account; otherwise a
// salted hash of the email. The salt is a constant, not a secret - its job is
// to keep the store from being a dictionary of md5-style email lookups, not to
// be cryptography.
const anonId = (email) =>
  "anon:" + createHash("sha256").update("warpchart-contrib-v1|" + (email ?? "?")).digest("hex").slice(0, 12);

function identityOf(c) {
  const login = c.author?.login ?? null;
  if (login) return { id: login, bot: c.author?.type === "Bot" || isBotLogin(login) };
  return { id: anonId(c.commit?.author?.email), bot: false };
}

// One page of the default branch's commit list. `since` filters by committer
// date and is inclusive, so the boundary commits come back on every
// incremental run - the cursor carries their SHAs to drop them.
async function fetchCommits(repo, { since = null, page = 1 } = {}) {
  const q = new URLSearchParams({ per_page: "100", page: String(page) });
  if (since) q.set("since", since);
  return ghFetch(`/repos/${repo}/commits?${q}`);
}

// Fold a batch of commits into the people map. Returns how many were new
// (not deduped) so the caller can log honestly.
function fold(store, commits, seenShas) {
  let folded = 0;
  for (const c of commits) {
    if (!c?.sha || seenShas.has(c.sha)) continue;
    seenShas.add(c.sha);
    const at = c.commit?.author?.date ?? c.commit?.committer?.date ?? null;
    if (!at) continue;
    store.totalCommits++;
    foldTrailers(store, c, at); // trailers count even on bot-authored commits
    const { id, bot } = identityOf(c);
    if (bot) {
      store.botCommits++;
      continue;
    }
    const p = store.people[id] ?? { first: at, last: at, commits: 0, months: [] };
    if (at < p.first) p.first = at;
    if (at > p.last) p.last = at;
    p.commits++;
    // The exact set of months this person committed in. first/last alone
    // cannot say who was active in a MIDDLE month, and "active" feeds
    // "returning" - approximating it would undercount the cohorts' whole
    // point. A few bytes per person buys exactness.
    const m = at.slice(0, 7);
    if (!p.months.includes(m)) p.months.push(m);
    store.people[id] = p;
    folded++;
  }
  return folded;
}

// Co-authored-by trailers on ONE already-deduped commit: the people GitHub's
// own contributors box counts that a plain author census misses (career-ops on
// 2026-08-04: 245 authors but 316 on the repo page - the gap is squash merges,
// applied suggestions and pairing, where someone's work lands inside a commit
// authored by someone else). Kept SEPARATE from authors so the panel can offer
// both readings. AI co-credits are counted, never turned into people. Called
// from fold() past the SHA dedup, so incremental boundary commits can never
// double-count aiCoCredits.
function foldTrailers(store, c, at) {
  for (const m of (c.commit?.message ?? "").matchAll(/co-authored-by:[^<]*<([^>]+)>/gi)) {
    const email = m[1].toLowerCase();
    const nore = email.match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
    let id = null;
    if (nore) {
      if (AI_CO.test(nore[1]) || BOTS.has(nore[1])) { store.aiCoCredits++; continue; }
      id = nore[1];
    } else if (/@anthropic\.com$/.test(email) || AI_CO.test(email)) {
      store.aiCoCredits++;
      continue;
    } else {
      id = anonId(email);
    }
    const p = store.coPeople[id] ?? { first: at };
    if (at < p.first) p.first = at;
    store.coPeople[id] = p;
  }
}

// Derive everything the chart needs from the people map. Recomputed on every
// write: the map is the source of truth, the series is a projection of it.
function derive(store) {
  const people = Object.values(store.people);
  if (!people.length) {
    store.months = [];
    store.busFactor = null;
    return;
  }
  const monthOf = (iso) => iso.slice(0, 7);
  const firsts = new Map(); // month -> new contributors
  const actives = new Map(); // month -> count active that month (exact, from per-person months)
  for (const p of people) {
    firsts.set(monthOf(p.first), (firsts.get(monthOf(p.first)) ?? 0) + 1);
    for (const m of p.months ?? [monthOf(p.first)]) {
      actives.set(m, (actives.get(m) ?? 0) + 1);
    }
  }
  // walk every calendar month from the first to the last, filling gaps, so the
  // cumulative curve has no holes for the chart to trip on
  const all = [...new Set([...firsts.keys(), ...actives.keys()])].sort();
  const months = [];
  let cum = 0;
  let m = all[0];
  const next = (ym) => {
    const [y, mo] = ym.split("-").map(Number);
    return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  };
  while (m <= all[all.length - 1]) {
    const nw = firsts.get(m) ?? 0;
    const act = actives.get(m) ?? 0;
    cum += nw;
    months.push({ month: m, new: nw, active: act, returning: Math.max(0, act - nw), cumulative: cum });
    m = next(m);
  }
  store.months = months;

  const byCommits = people.map((p) => p.commits).sort((a, b) => b - a);
  const total = byCommits.reduce((a, b) => a + b, 0);
  store.busFactor = total
    ? {
        top1Share: Math.round((byCommits[0] / total) * 1000) / 1000,
        top5Share: Math.round((byCommits.slice(0, 5).reduce((a, b) => a + b, 0) / total) * 1000) / 1000,
        humans: people.length,
      }
    : null;

  // Daily cumulative series, the shape the evolution chart consumes: one
  // [YYYY-MM-DD, cumulative] point per day that gained someone. Two series:
  // AUTHORS (the strict census) and CREDITED (authors + co-authors, the same
  // definition GitHub's own contributors box uses). Compact: ~1 point/day.
  const dailyCum = (dates) => {
    const perDay = new Map();
    for (const d of dates) {
      const day = d.slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    let cum = 0;
    return [...perDay.keys()].sort().map((day) => [day, (cum += perDay.get(day))]);
  };
  const authorFirsts = Object.values(store.people).map((p) => p.first);
  const coOnlyFirsts = Object.entries(store.coPeople)
    .filter(([id]) => !store.people[id]) // same login/email-hash = same person
    .map(([, p]) => p.first);
  store.series = {
    authorsDaily: dailyCum(authorFirsts),
    creditedDaily: dailyCum([...authorFirsts, ...coOnlyFirsts]),
    authors: authorFirsts.length,
    credited: authorFirsts.length + coOnlyFirsts.length,
  };
}

async function census(repo) {
  const key = storeKey(repo);
  let store = await readBlob(key);
  const fresh = !store;
  if (fresh) {
    store = { repo, people: {}, coPeople: {}, aiCoCredits: 0, totalCommits: 0, botCommits: 0, cursor: null };
  }
  // stores written before co-author tracking existed
  store.coPeople ??= {};
  store.aiCoCredits ??= 0;

  // Boundary dedup: `since` is inclusive, so the commits AT the cursor
  // timestamp reappear; their SHAs are carried in the cursor to be skipped.
  const seenShas = new Set(store.cursor?.shas ?? []);
  const since = store.cursor?.iso ?? null;

  let pages = 0;
  let folded = 0;
  let newestIso = since;
  let newestShas = new Set(store.cursor?.shas ?? []);
  for (let page = 1; page <= MAX_PAGES; page++) {
    let rows;
    try {
      rows = await fetchCommits(repo, { since, page });
    } catch (err) {
      const msg = String(err?.message ?? err);
      // 409 = empty repository; 404 = renamed/gone. Both mean "no census", not
      // "a failure worth aborting the others for".
      if (/409|404/.test(msg)) {
        console.log(`[contributors] ${repo}: ${/409/.test(msg) ? "empty repo" : "not found"}, skipping`);
        return;
      }
      throw err;
    }
    if (!Array.isArray(rows) || !rows.length) break;
    pages++;
    folded += fold(store, rows, seenShas);
    for (const c of rows) {
      const iso = c.commit?.committer?.date ?? null;
      if (!iso) continue;
      if (newestIso === null || iso > newestIso) {
        newestIso = iso;
        newestShas = new Set([c.sha]);
      } else if (iso === newestIso) {
        newestShas.add(c.sha);
      }
    }
    if (rows.length < 100) break;
    if (page === MAX_PAGES) {
      // Truncated backfill = a wrong curve. Refuse to publish it.
      console.error(
        `[contributors] ${repo}: history exceeds ${MAX_PAGES * 100} commits; ` +
          `refusing to publish a truncated census (this repo needs GH Archive, not the API)`
      );
      return;
    }
    await sleep(120);
  }

  store.cursor = newestIso ? { iso: newestIso, shas: [...newestShas].slice(0, 200) } : store.cursor;
  derive(store);
  store.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await writeBlob(key, store);

  const humans = Object.keys(store.people).length;
  const anon = Object.keys(store.people).filter((k) => k.startsWith("anon:")).length;
  console.log(
    `[contributors] ${repo}: ${humans} authors (${anon} unlinked)` +
      ` · ${store.series?.credited ?? humans} credited incl. co-authors` +
      ` · ${store.aiCoCredits} AI co-credits` +
      ` · ${store.totalCommits} commits (${store.botCommits} bot)` +
      ` · +${folded} new commit(s) this run in ${pages} page(s)` +
      (fresh ? " · FULL BACKFILL" : "") +
      (store.busFactor ? ` · top5 ${(store.busFactor.top5Share * 100).toFixed(0)}%` : "")
  );
}

async function main() {
  // Same unlocked set as vitals.mjs phase B: the house repo, every route repo
  // owned by us, and the paying tenants.
  const unlocked = new Set([config.repo.toLowerCase()]);
  try {
    const route = JSON.parse(readFileSync(join(DATA_DIR, "route.json"), "utf8"));
    for (const p of route?.repos ?? []) {
      if (p?.r && OWNED.includes(p.r.split("/")[0].toLowerCase())) unlocked.add(p.r.toLowerCase());
    }
  } catch {
    /* no route yet: the house repo alone */
  }
  const tenantsPath = join(DATA_DIR, "tenants.json");
  if (existsSync(tenantsPath)) {
    try {
      const t = JSON.parse(readFileSync(tenantsPath, "utf8"));
      for (const x of Array.isArray(t) ? t : []) unlocked.add((x.repo || x).toLowerCase());
    } catch {
      /* unreadable tenants: skip them, never abort the owned repos */
    }
  }

  for (const repo of unlocked) {
    try {
      await census(repo);
    } catch (err) {
      console.error(`[contributors] ${repo} failed (non-fatal): ${err?.message ?? err}`);
    }
  }
}

main().catch((err) => {
  // A missed census run costs nothing: git history does not expire, the next
  // run picks up exactly where the cursor left off.
  console.error(`[contributors] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
