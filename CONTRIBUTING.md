# Contributing

Thanks for wanting to improve Warpchart. The codebase is intentionally small and dependency-light; please keep it that way.

## Ground rules

- **Zero hardcoding of any specific repo.** Everything derives from `mission.config.json` and the generated `data/` directory. If a change references a concrete repository anywhere else, it is a bug.
- **`data/` is owned by the collectors.** Never edit it by hand; never make the app write to it.
- **No new runtime dependencies without a strong reason.** The collector is plain Node with zero deps. Sound is synthesized (no audio assets). Charts use Recharts; custom SVG where Recharts does not fit.
- **Cost discipline.** Anything user-facing that touches the GitHub API must be edge-cached (s-maxage or ISR) so traffic never multiplies API cost.
- **Aesthetic**: serene sci-fi. Thin lines, cyan and amber accents, restraint. No confetti, no gamification noise.

## Dev setup

```bash
npm install
GH_TOKEN=$(gh auth token) node collector/bootstrap.mjs   # seed data/ for your test repo
GITHUB_TOKEN=$(gh auth token) npm run dev
```

`npm run build && npx tsc --noEmit` must pass before a PR.

## Project map

```
collector/        plain-Node data collection (bootstrap + hourly collect)
data/             generated telemetry (timestamps, snapshots, route, meta)
src/lib/          pure series math, projections, events, GitHub client, bundle
src/components/   panels, the star chart, live layer, sound engine
src/app/          dashboard page, /r/ explorer, /api/badge, /api/og, live APIs
```

## Good first issues

See [docs/good-first-issues.md](docs/good-first-issues.md).
