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
gh repo edit santifer/mission-control --visibility public --accept-visibility-change-consequences
gh repo edit santifer/mission-control --template
gh repo edit santifer/mission-control \
  --description "Growth telemetry for any GitHub repository. Live star chart, worldwide rank, velocity, sound." \
  --homepage "https://mission-control-lovat-delta.vercel.app"
gh repo edit santifer/mission-control --add-topic github-stars --add-topic dashboard \
  --add-topic telemetry --add-topic nextjs --add-topic analytics --add-topic star-history
```

- [ ] Upload `assets/social-preview.png` as the repo social preview
      (Settings > General > Social preview; no API for this).
- [ ] Open the issues drafted in `docs/good-first-issues.md` with labels
      `good first issue` + area.
- [ ] Verify the badge renders inside a README on github.com (camo proxy).

## After

- [ ] Decide separately (brand-ops) whether the example tenant's README adds
      the badge. That is a brand decision, not a release step.
- [ ] Optional custom domain on Vercel.
