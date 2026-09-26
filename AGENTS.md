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

- `npm test`, `npx eslint .` and `npx tsc --noEmit` pass. CI runs the same, plus the build.
- After the deploy: `npm run verify:deploy -- --url=/the/page --expect="the literal text" --wait=15`. Paste its `VERIFICADO:` line. A green workflow or a finished deploy is not evidence.
- Every production deploy triggers `smoke.yml`: the real pages in WebKit (iPhone, both themes, and desktop), checking broken images, horizontal scroll and AA contrast. Run it locally with `npx playwright test` (`e2e/selftest.spec.ts` proves the sensors still catch a broken page).

## Tests

- One test per incident, built from the **real payload** that caused it (an empty `edges` list, a 200 carrying `errors`, a 403 with quota left…).
- A new regression test must **fail against the code before the fix**. A test that has never been red proves nothing.
- Existing lint violations are frozen in `eslint-suppressions.json`. Fix one, and the file shrinks with `npx eslint . --prune-suppressions`. Never add to it by hand.
