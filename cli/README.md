# warpchart

Growth telemetry for any GitHub repository, in your terminal: worldwide rank, star velocity, engineering health, the contributor census, npm installs and clone traffic. Public, cache-only data, no auth, no GitHub token.

```bash
npx warpchart vuejs/core             # rank, velocity and a star chart
npx warpchart dossier vuejs/core     # the whole record, every section
npx warpchart contributors owner/n   # the contributor census and its curve
npx warpchart usage owner/name       # npm installs and git clones over time
npx warpchart velocity 15            # the fastest-growing repos right now
```

```
  ◤ WARPCHART  ·  vuejs/core
  RANK #397    STARS 53,821    ▲ 9.9/day

  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⡤⠤⠖⠒⠒⠉⠉⠉⠉
  ⠀⠀⠀⠀⠀⠀⢀⣀⣠⠤⠤⠖⠒⠋⠉⠉⠁⠈
  ⣀⡤⠴⠒⠋⠉⠁
  2018                                   now · 53,821★

  next gate top 300 · 7,816 ★ to go
  → https://warpchart.dev/r/vuejs/core
```

## Time windows

Every daily series accepts a window, trimmed server-side, and reports the span it actually covers rather than implying it covers everything:

```bash
npx warpchart usage owner/name --range 30d          # 30d · 12w · 6m · 1y
npx warpchart contributors owner/name --since 2026-07-01
npx warpchart dossier owner/name --since 2026-06-01 --until 2026-07-01
```

`--range` anchors on the newest day present in the data, not on today, so a feed that is a few days behind still returns its last window instead of an empty one.

## What is public and what is not

`dossier` returns every section the web console shows, and inherits the same gating:

| section | availability |
|---|---|
| rank, stars, velocity, forks, overtakes | public for any repo in the worldwide top 1000 |
| npm downloads | public (the npm registry is public) |
| engineering health, contributor census | owned and paid repos; locked repos say so |
| clone traffic | the repo owner's own data; public only for this project's own repo |

A locked section returns a reason, never a zero. Absence is reported as absence.

## Agents

`--json` on any command prints the raw payload. The same data is one HTTP call away:

```
https://warpchart.dev/api/v1/dossier?repo=owner/name&range=30d
```

One caveat the payload carries inline, because it is the claim a headline gets wrong most often: GitHub's unique-cloner count is **per day**. Summing days does not give distinct people.

Point the CLI at another deployment with `WARPCHART_BASE`. Per-repository historical telemetry is a hosted product at [warpchart.dev](https://warpchart.dev).

MIT.
