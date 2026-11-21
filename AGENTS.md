<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Working on warpchart

warpchart publishes numbers about other people's projects. A wrong number that
looks right is the worst bug it can ship, and it never throws. Read
[`docs/INVARIANTS.md`](docs/INVARIANTS.md) before touching anything that
produces or displays a number.

## Before you change a number: the contract

Answer these six in the PR (or the commit message) before writing code:

1. **What decision does the reader make with it?** ("Where do I start?" is answered by free issues, never by labeled ones.)
2. **What does it count, exactly?** A sample or the total? Labeled or available?
3. **What event dates it?** The data, or the attempt to fetch it?
4. **How does it fail?** `null` / "unmeasured", never `0` and never the total.
5. **Where does the user see it?** Which surface, which cache layer, which key to bump.
6. **How will you verify it in a way you cannot fool yourself?**

## Done means verified on what production serves

- `npm test`, `npx eslint .` and `npx tsc --noEmit` pass. CI runs the same, plus `node --check` on every collector and script file, and the build.
- After the deploy: `npm run verify:deploy -- --url=/the/page --expect="the literal text" --wait=15`. Paste its `VERIFICADO:` line. A failure prints `NO VERIFICADO:` and exits 1, so check the start of the line, not whether it contains `VERIFICADO:`. A green workflow or a finished deploy is not evidence.
  - `--expect=` and `--absent=` can repeat. `--wait=N` retries every 60 s for up to N minutes.
  - It also requires `/api/health` to answer `ok`. When the collector is behind for an unrelated reason, `--no-health` checks only the page, and the line says `/api/health: skipped`.
  - `--base=https://…` points it at another deployment (a preview). The default is `https://warpchart.dev`.
- A successful production deploy triggers `smoke.yml`: the real pages in WebKit (iPhone, both themes, and desktop), checking broken images, horizontal scroll and AA contrast. A newer deploy cancels a smoke run still in progress. `e2e/selftest.spec.ts` proves the sensors still catch a broken page.

## Running it locally

- **Node 22.12 or newer.** vitest 5 needs it. On Node 20, `npm test` dies with a `rolldown-binding.wasi.cjs` error: switch Node, do not reinstall dependencies or skip the tests.
- **Data without production:** `node scripts/sync-from-blob.mjs` with no `BLOB_READ_WRITE_TOKEN` copies the synthetic `data-sample/` into `data/`, and the app runs on it (`npm run dev`). `npm run build` does the same in its prebuild. It overwrites same-named files in `data/`, including data you seeded yourself with `collector/bootstrap.mjs` (CONTRIBUTING).
- **What reaches production:**
  - Reads only: `npm run verify:deploy` (warpchart.dev unless `--base`), and `npx playwright test`, whose `baseURL` is `SMOKE_BASE`, defaulting to `https://warpchart.dev`. `SMOKE_BASE=http://localhost:3000 npx playwright test` runs it against a local server. On the sample data, `/r/career-ops-hq/career-ops` and `/velocity` fail, because their expected text comes from production data; the other pages pass. `npx playwright test e2e/selftest.spec.ts` needs no server at all. A first run needs `npx playwright install webkit`.
  - Writes: with `BLOB_READ_WRITE_TOKEN` set, `scripts/sync-to-blob.mjs` and most `collector/*.mjs` scripts write the private Blob store that production reads. `collect.mjs` and `installs.mjs` also post to the alert webhooks, and `indexnow.mjs` pings IndexNow. `npm run dev` with production env vars writes too (`codex/*` on a repo's first visit). Do not run these with production credentials outside the workflows.

## Tests

- One test per incident, built from the **real payload** that caused it (an empty `edges` list, a 200 carrying `errors`, a 403 with quota left…).
- A new regression test must **fail against the code before the fix**. A test that has never been red proves nothing.
- Existing lint violations are frozen in `eslint-suppressions.json`. Fix one, and the file shrinks with `npx eslint . --prune-suppressions`. Never add to it by hand.
