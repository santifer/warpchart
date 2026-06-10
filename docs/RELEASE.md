# Release checklist (flip to public)

Run when the owner decides to publish. Nothing here is automatic.

## Pre-flip audit

- [ ] `git grep -nE "(gho_|ghp_|github_pat_|sk-)"` returns nothing.
- [ ] README copy review: no confidential topics, no em dashes, the example
      tenant is presented neutrally (it is a demo, not the product's story).
- [ ] `npm run build` and `npx tsc --noEmit` pass.
- [ ] Optional but recommended: replace the `GITHUB_TOKEN` env var in Vercel
      with a fine-grained PAT (read-only, public repositories), then redeploy.

## Flip

```bash
gh repo edit santifer/warpchart --visibility public --accept-visibility-change-consequences
gh repo edit santifer/warpchart --template
gh repo edit santifer/warpchart \
  --description "Growth telemetry for any GitHub repository. Live star chart, worldwide rank, velocity, sound." \
  --homepage "https://mission-control.career-ops.org"
gh repo edit santifer/warpchart --add-topic github-stars --add-topic dashboard \
  --add-topic telemetry --add-topic nextjs --add-topic analytics --add-topic star-history
```

- [ ] Upload `assets/social-preview.png` as the repo social preview
      (Settings > General > Social preview; no API for this).
- [ ] Open the issues drafted in `docs/good-first-issues.md` with labels
      `good first issue` + area.
- [ ] Verify the badge renders inside a README on github.com (camo proxy).

## After

- [ ] Decide separately (brand-ops) whether the example tenant's README adds
      the badge or the embedded chart. That is a brand decision, not a
      release step.
- [ ] Optional: `gh secret set ALERT_WEBHOOK_URL` with a Discord/Slack
      incoming webhook to get gate/overtake alerts from the hourly collector.
- [ ] Optional custom domain on Vercel.

## Domain cutover to warpchart.dev (when the domain is purchased)

1. Cloudflare: add warpchart.dev zone (auto if bought on CF Registrar).
2. Vercel: `npx vercel domains add warpchart.dev` and `npx vercel domains add www.warpchart.dev` on this project; add the CNAME/A records CF-side with proxy OFF (grey cloud) as with the current domain.
3. Set warpchart.dev as the PRIMARY domain in Vercel so mission-control.career-ops.org 308-redirects to it automatically (Vercel redirects all non-primary domains).
4. Swap every `mission-control.career-ops.org` URL in README.md (EN+ES sections) for `warpchart.dev`.
5. Update repo variable: `gh variable set WARM_BASE_URL --body "https://warpchart.dev"`.
6. Ask career-ops-maintainer to keep the README embed URLs as-is (they will redirect) or swap them to warpchart.dev for cleanliness.
7. Verify: old URL 308 -> new, badge/chart/og render via both, GitHub camo re-resolves.
