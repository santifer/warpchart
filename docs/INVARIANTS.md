# Invariants

Rules this codebase learned the hard way. Each one cost at least one wrong number
in production. Where a rule has a sensor (a test, a lint rule or a watchdog
check), it is named: the sensor is the rule, this page is only the why.

## 1. Data honesty: a number must answer the question its label asks

Before publishing any number, answer: **what does it count exactly, and what
event dates it?** The dominant failure here is a well-formed number that answers
a different question. It never throws, never logs, and the panel stays green.

| Rule | Why | Sensor |
|---|---|---|
| An absence is `null`, never `0`. | GitHub returns `edges: []` without an error for data it no longer lists; read as "grew 0" it zeroed every neighbor. | `collector/lib.test.mjs`, `src/lib/github.test.ts` |
| A failure returns `null`, never the total. | A failed "free issues" query that falls back to the labeled count is the same lie. | `collector/vitals-core.test.mjs` (free ≤ labeled) |
| A sample is not a total. | "138 contributors" were the authors inside a 500-PR sample; GitHub said 213. | `collector/vitals-core.test.mjs` |
| Windows are temporal, never by count. | A window of the last N items shrinks by itself when a project speeds up, so the series jumps. | `collector/vitals-core.test.mjs` (90-day lead time, truncated month) |
| Count openings, not signs. | "12 good first issues" when 2 were free: count `no:assignee -linked:pr`. | `collector/vitals-core.test.mjs` |
| A one-off correction is not a rate. | A 21.8k-star purge inside the 7-day window read as −2903★/day, and its restore as +4587★/day. | `collector/velocity7-core.test.mjs` |
| A rate closes on the newest point, dated by its real capture. | v7 closed on the daily registry refresh and dated each day at 12:00Z (captured ~00:25Z): ruflo read 95.5/d while its last week was ~139/d. The window close is published (`v7_to`), and a rate that is a wave starting or ending carries `trend` (ratio >2 or <0.5 AND at least 25/d apart). An eta that the shift can only shorten is shown as a ceiling ("eta ≤5d"); one it can push out, or a window older than 26 h, says "accelerating" / "cooling" / "rate over a day old" instead of a date. **Known gaps:** (a) `trend: null` mixes "steady" with "unknown" (under 7 days of history, or no point ~24 h before the end); proposal: publish `v7_days` or a `trend: "unknown"`. (b) CompareLab, the OG card, `/api/v1/overtakes`, MCP/CLI (`collisions.json`) and CommandDeck's milestone gates still give a firm eta without the rate's quality. | `collector/velocity7-core.test.mjs`, `src/lib/compare.test.ts`, `fresh.v7-window` |
| No point in the future. | Stamping today at 12:00 UTC put the morning point ahead of `now`. | `src/lib/trajectory.test.ts` |
| Check the size of the universe before a percentile. | A truncated day (6,010 of ~10,000 repos) made every rank look better. | `collector/guards.test.mjs`; route-history and the catalog refuse a short sweep and leave a marker (`data.partial-markers`) |
| UI order never comes from a `Set`. | Insertion order made the newest merger "operate" a 70K-star repo. | `collector/vitals-core.test.mjs` |
| A stamp of the ATTEMPT is not freshness of the DATA. | A vault stamped `updatedAt` every run while upstream had stopped publishing. | `fresh.traffic-days` |
| A number printed inside an image ages with the image. | The builders wall (`/api/builders`) prints "N joined this week" in 19 READMEs; a wall that stops refreshing keeps saying it. It shows people (census minus bots and AI pairing tools), never a total (so it cannot contradict GitHub's sidebar count), and says nothing instead of "0 joined". | `collector/builders-core.test.mjs`, `presence.builders-wall` (≤30 h) |

## 2. Caches and deploys

- **`git push` does not deploy the data.** The collector's `.deploy-stamp` commit triggers the Vercel build; a code push builds too, but a data fix without a new run shows nothing.
- **`unstable_cache` (the Data Cache) survives a deploy.** When the SHAPE or the meaning of a cached value changes, bump that type's number in `SHAPE_VERSION` (`src/lib/shape-versions.ts`) in the same commit. Keys are derived with `cacheKey()`, so a key that embeds the type moves too (`explorer-data` carries the Dossier version). Otherwise production serves the old reading for the entry's TTL and the fix "does not work". Sensor: `src/lib/shape-versions.test.ts` (no hand-written versioned key outside it).

  | Type | Key | TTL |
  |---|---|---|
  | Dossier | `dossier-vN` | 15 min |
  | ExplorerData (+ Dossier) | `explorer-data-vN.dossierM` | 15 min |
  | Vitals | `vitals-vN` | 15 min |
  | PrFlow | `prflow-vN` | 15 min |
  | TrafficVault | `traffic-vault-vN` | 5 min |
  | Curve | `embed-chart-curve-vN` | 6 h |
  | OSS Insight monthly archive | `archive-monthly-vN` | 30 days |
  | Builders wall | `builders-wall-vN` | 30 min |
  | Velocity rank: meta, month | `velocity-rank-{meta,month}-vN` | 1 h |
  | Velocity rank: reconstructed days | `velocity-rank-reconstructed-vN` | 1 day |
- **`@vercel/blob` `get()` caches on the CDN by default** (weeks). Any read-modify-write, freshness check or watchdog read uses `useCache: false`.
- A `?query` in a page URL breaks the ISR/edge cache key (each variant renders from scratch). UI state between pages goes in the `#hash`.
- An explicit `cache: "no-store"` in shared fetch code turns an ISR page dynamic.
- Props passed to a client component are serialized into the RSC payload even if nothing renders them. Never pass data a page must not expose.
- **Verify on what is served:** `npm run verify:deploy -- --url=/path --expect="text" --wait=15`. Not the store, not the exit code.

## 3. GitHub API

- **GraphQL partial errors:** aliased batches return `errors` (e.g. NOT_FOUND for one renamed repo) together with valid `data`. Throw only when there is no data at all; otherwise warn and keep the rest. Both clients do this (`collector/lib.test.mjs`, `src/lib/github.test.ts`).
- **GraphQL answers HTTP 200 with a `FORBIDDEN` error object**, not a 403. Token failover for GraphQL lives in `graphql()`, not in the status check.
- **A 403 with `x-ratelimit-remaining > 0` and no `retry-after` is a permission error, not quota.** Fail over to the next token instead of sleeping (`collector/lib.test.mjs`). Each run logs which token of the pool served REST and GraphQL.
- Listing stargazers of repos we do not own is closed by GitHub. The Actions installation token and fine-grained PATs cannot list stargazers at all; only classic PAT/OAuth tokens can.
- Search `is:closed is:unmerged closed:A..B` undercounts (7 vs 31). For closure series use GraphQL with `state` + `closedAt`.
- Days of intermittent 502s are normal. One retry level only (never stack retry ladders), every fetch time-boxed, and live routes fall back to the last snapshot.
- A repo transfer renames the repo, never the npm package (`src/lib/npm-candidates.test.ts`), the domain or anything outside GitHub. `mission.aliases.json` entries are **never deleted** (old keys live forever in the Blob). Anything that builds an external identifier from `owner/name` must try every name from `allNamesOf()`.
- `201` from "assign" does not mean assigned when the user is not eligible: re-read the response.

## 4. Pipeline (`collect.yml`, `health.yml`)

- **A job-level timeout cancels every remaining step, `continue-on-error` included**, and 'Trigger deploy' with them. Every non-critical network step gets its own `timeout-minutes`, and the job cap stays above the sum of the steps' normal durations.
- `continue-on-error` rewrites a failed step as `success` in the API. The truth is in the run's annotations (the watchdog reads those).
- The cron runs every ~6 h in practice (declared every 2 h). Anything the collector writes can be ~8 h behind.
- **route-history runs before velocity7** (and collisions after it): the 7-day window closes on the day route-history just recorded. Recomputes when `route.v7_at` (later of the registry refresh and the newest capture) moves.
- **The UTC day in progress is never published.** A day appears at the first run after 00:00Z, which is also the heaviest run of the day, so what must close the day runs FIRST (PR flow is step 2b). Watched by `fresh.prflow`; the real cron cadence by `pipeline.cron-lag`.
- The watchdog must never hold stronger credentials than what it watches: it uses the same token cascade as the collector.
- **Validate before publishing.** A guard that refuses (`collector/guards.mjs`) keeps the previous artifact, writes nothing that would mark the work done, and leaves `health/partial/{family}.json`. An honest gap beats a truncated artifact.
- A field that was on the house repo's public dossier and disappears is a critical finding (`presence.transitions`), even when nothing threw.
- A watchdog alarm that has to be doubted gets silenced. Baselines are per identity, and 401/403 means "unmeasurable", never "changed".

## 5. UI

- **Velocity has one definition:** `src/lib/velocity.ts` (`v7 ?? v`). The crossing math has one definition in the app: `projectCrossing` in `src/lib/compare.ts`. The one exception is the collector-side overtake scan (`runCollisionScan` in `collector/collisions.mjs`), which feeds `/api/v1/overtakes` with its own rounding (velocities whole, `etaDays` to 0.01); `coherence.eta` checks those ETAs against exactly that rounding (`etaIncoherences` in `collector/health-rules.mjs`).
- **Tailwind drops an unknown utility silently**: `ring-panel` (no such token) fell back to `currentColor`. Lint rule: `better-tailwindcss/no-unknown-classes`. Our own plain-CSS classes are read from `globals.css`.
- Color has two sources that must move together: `src/app/globals.css` (CSS vars) and `src/lib/theme.ts` (chart palettes).
- Avatars go through `src/lib/avatar.ts` (`github.com/{login}.png` is a redirect that fails on iOS). Broken images, horizontal scroll and AA contrast in both themes are checked in WebKit after every production deploy (`smoke.yml`).
- Panel order and grid live only in `src/components/ConsoleLayout.tsx`; the loading skeleton mirrors it by hand.
- No `Date.now()` in SSR initial state (hydration mismatch). Use the bundle's `generatedAt`, then go live after mount.

## 6. One writer per Blob key

| Key / prefix | Writer | Notes |
|---|---|---|
| `data/**` | `scripts/sync-to-blob.mjs` (mirror of the collector's `data/`) | except `data/tenants.json` |
| `data/tenants.json` | `src/lib/tenants-store.ts` (payment webhook) only | excluded from the mirror; reads with `useCache: false`, throws on anything but 404 |
| `route-history/*` | `collector/route-history.mjs` | daily; a partial universe must not mark the day done |
| `data/catalog.json` | `collector/catalog.mjs` (+ re-mirrored by sync) | |
| `prflow/*` | `collector/prflow.mjs` | full recompute each run |
| `vitals/*` | `collector/vitals.mjs` | `_dist` only published when the sweep completed |
| `contributors/*` | `collector/contributors.mjs` | refuses a truncated backfill |
| `builders/*` | `collector/builders.mjs` (workflow `builders.yml`) | SVGs per language first, `.json` meta last (the commit point); refuses when the census shrinks or >5% of avatars fail |
| `traffic/*` | `collector/traffic.mjs` | merges, never drops days |
| `trending/marks.json` | `collector/trending-marks.mjs` | accumulates; a 404 is confirmed with head() before starting fresh, refuses a write that loses a day |
| `health/*` | `collector/health.mjs` | |
| `live/*` | `collector/live.mjs` **and** `src/lib/live-blob.ts` (webhook seed) | two writers: the seed only writes a first point |
| `embeds/seen.json` | `src/app/api/embeds/route.ts` **and** `src/lib/embed-track.ts` | two writers |
| `data/attribution.json` | `collector/attribute.mjs` (+ re-mirrored by sync) | |

Adding a writer to a key that already has one is a design change: say so in the PR.
