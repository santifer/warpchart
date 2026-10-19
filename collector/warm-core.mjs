// What to pre-render on production after a collect run. Decided by
// collect.mjs (it knows the neighbors and whether the registry refreshed) and
// fetched by warm.mjs in its own capped step, so a slow production render can
// never hold 'Collect snapshot' past its cap.
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WARM_PLAN = process.env.WARM_PLAN || join(tmpdir(), "warpchart-warm-plan.json");

// The landing's featured ranks.
const FEATURED = [0, 7, 24, 79, 199, 499];

// Pick the spotlight the landing will show for this registry day. MUST match
// src/lib/demo.ts (seedFrom + band 80..680).
export function spotlightIndex(generatedAt) {
  const day = (generatedAt ?? "").slice(0, 10) || "fallback";
  const text = "spotlight::" + day;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return 80 + ((h >>> 0) % 600);
}

// [{ path, pauseMs }] in fetch order. Two independent warms:
//   - once a day (04 UTC run): the featured charts plus our live neighbors.
//     The long tail stays lazy; the power law makes its cache hit rate high.
//   - right after a registry refresh: the new spotlight's whole surface
//     (explorer page, curve, embed, OG card). Gated on the refresh, so it
//     never overlaps the 04 UTC warm.
export function warmPlan({ route, neighbors, now, routeRefreshed }) {
  const repos = route?.repos ?? [];
  const plan = [];
  const hour = now.getUTCHours();
  if (hour >= 4 && hour < 5) {
    const targets = new Set();
    for (const i of FEATURED) if (repos[i]) targets.add(repos[i].r);
    for (const n of neighbors ?? []) targets.add(n.r);
    for (const r of targets) plan.push({ path: `/api/chart?repo=${encodeURIComponent(r)}&w=800&h=240`, pauseMs: 1500 });
  }
  if (routeRefreshed) {
    const hero = repos[spotlightIndex(route?.generated_at)]?.r;
    if (hero) {
      const q = encodeURIComponent(hero);
      for (const path of [`/r/${hero}`, `/api/curve?repo=${q}`, `/api/chart?repo=${q}`, `/api/og?repo=${q}`]) {
        plan.push({ path, pauseMs: 2000 });
      }
    }
  }
  return plan;
}
