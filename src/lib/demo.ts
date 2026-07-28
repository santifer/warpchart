// Daily spotlight for the landing: a REAL top-1000 system rendered as a
// live demo of the star chart. The protagonist rotates deterministically
// with the registry's date (the page is static and rebuilds hourly, so the
// rotation materializes at build time with zero client cost). Velocities
// come from one aliased GraphQL call at build; if GitHub hiccups the chart
// degrades to the route-only view instead of failing the build.
import type { ChartInputs, Neighbor } from "@/lib/types";
import { loadRoute, loadMeta, lastSnapshot } from "@/lib/history";
import { neighborsVelocity } from "@/lib/github";
import { buildRouteLayers } from "@/lib/bundle";
import { canonicalVelocity } from "@/lib/velocity";

function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface DemoSpotlight {
  inputs: ChartInputs;
  rank: number;
}

export async function buildDemoSpotlight(): Promise<DemoSpotlight | null> {
  const route = loadRoute();
  if (!route || route.repos.length < 400) return null;

  const day = (route.generated_at ?? "").slice(0, 10) || "fallback";
  // protagonist somewhere in the 80..680 band: dense neighborhoods, real
  // climbers, and a different repo every day
  const idx = 80 + (seedFrom("spotlight::" + day) % 600);
  const hero = route.repos[idx];
  if (!hero) return null;

  // neighborhood: balanced behind/ahead so the protagonist reads roughly
  // centered in the spotlight band, escorts and targets both visible
  const lo = Math.max(0, idx - 8);
  const hi = Math.min(route.repos.length, idx + 11);
  const names = route.repos.slice(lo, hi).map((p) => p.r);

  // Canonical velocity: prefer the stable route v7 (v fallback) over the noisy
  // last-30-stars estimate, so the home spotlight matches /r/, the API and the
  // galaxy instead of pinning the neighborsVelocity ceiling (a burst of 30 stars
  // in under two minutes read as 21,600/day and made every neighbor "catch you
  // in now"). Same fix the explorer already applies to its scan.
  const routeV7 = new Map<string, number | null>(
    route.repos.map((p) => [p.r.toLowerCase(), canonicalVelocity(p)]),
  );
  let neighbors: Neighbor[] = [];
  let heroV = 0;
  try {
    const vel = await neighborsVelocity(names, Date.parse(route.generated_at));
    const byName = new Map(vel.map((v) => [v.r.toLowerCase(), v]));
    const heroLive = byName.get(hero.r.toLowerCase());
    heroV = routeV7.get(hero.r.toLowerCase()) ?? heroLive?.v ?? 0;
    neighbors = vel
      .filter((v) => v.r.toLowerCase() !== hero.r.toLowerCase())
      .map((v) => {
        const rv = routeV7.get(v.r.toLowerCase());
        // v.v is null when GitHub would not let us measure that repo; the
        // registry rate is the answer, and 0 only when we have neither.
        return { r: v.r, s: v.s, v: rv ?? v.v ?? 0, d: v.d, l: v.l };
      });
  } catch {
    /* route-only degradation */
  }

  const apex = { r: route.repos[0].r, s: route.repos[0].s };
  const milestones = [50, 100, 200, 300, 400, 500]
    .filter((rk) => rk < idx + 1 && route.repos.length >= rk)
    .slice(-2)
    .map((rk) => ({ rank: rk, threshold: route.repos[rk - 1].s, drift: null }));

  const layers = buildRouteLayers(hero.s, milestones, apex, hero.r);
  const meta = loadMeta();
  const homeStars = lastSnapshot()?.stars ?? null;

  return {
    rank: idx + 1,
    inputs: {
      repo: hero.r,
      stars: hero.s,
      rank: idx + 1,
      v7d: heroV,
      neighbors,
      milestones,
      apex,
      routeDots: layers.dots,
      routeLandmarks: layers.landmarks,
      routeAll: layers.all,
      nowMs: Date.parse(route.generated_at),
      home: meta && homeStars ? { r: meta.repo, s: homeStars } : null,
    },
  };
}
