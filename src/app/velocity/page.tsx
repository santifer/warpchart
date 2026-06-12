// Velocity rankings: the fastest movers of the GitHub top 1000, three
// lenses (absolute, relative-to-size, active overtakes). Built entirely
// from the daily registry diff and the collision scan: zero API cost,
// statically rendered, refreshed with each daily registry.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import VelocityBoard, { type LaneRepo, type HuntRow } from "@/components/VelocityBoard";
import { loadRoute, loadCollisions, loadMeta } from "@/lib/history";
import { fmtCompact, fmtEtaDays } from "@/lib/format";

// 15 min: the data file is daily, but ETAs age in render time, so rebuilds
// must outpace the shortest hunts (zero API cost, this page only reads fs)
export const revalidate = 900;

export const metadata: Metadata = {
  title: "Velocity rankings · fastest growing repos of the GitHub top 1000 · Warpchart",
  description:
    "Daily velocity rankings for the GitHub top 1000: fastest movers in stars/day, fastest risers relative to their size, and active overtakes with live ETAs.",
  openGraph: { images: ["/api/og"] },
};

export default function VelocityPage() {
  const route = loadRoute();
  const collisions = loadCollisions();
  const meta = loadMeta();

  const ranked = (route?.repos ?? []).map((p, i) => ({ ...p, rank: i + 1 }));
  const withV = ranked.filter((p) => p.v != null && p.v > 0);

  // the scan runs once per daily route refresh, but this page rebuilds
  // hourly: age every ETA by the time elapsed since the scan and drop
  // hunts whose deadline already passed (otherwise a 4-hour overtake
  // would still read "next" twenty hours after it happened)
  const scannedMs = collisions?.generated_at ? new Date(collisions.generated_at).getTime() : 0;
  const elapsedDays = scannedMs ? (Date.now() - scannedMs) / 864e5 : 0;
  const live = (collisions?.collisions ?? [])
    .map((c) => ({ ...c, leftDays: c.etaDays - elapsedDays }))
    .filter((c) => c.leftDays > 0);

  // an active hunt per hunter, for the row context line
  const huntByHunter = new Map<string, { victim: string; eta: string }>();
  for (const c of live) {
    if (!huntByHunter.has(c.hunter.r) && c.leftDays <= 7) {
      huntByHunter.set(c.hunter.r, { victim: c.victim.r, eta: fmtEtaDays(c.leftDays) });
    }
  }

  const toLane = (p: (typeof withV)[number]): LaneRepo => ({
    r: p.r,
    s: p.s,
    rank: p.rank,
    v: p.v!,
    l: p.l ?? null,
    relPct: (p.v! / p.s) * 100,
    hunt: huntByHunter.get(p.r) ?? null,
  });

  const absolute = [...withV].sort((a, b) => b.v! - a.v!).slice(0, 25).map(toLane);
  const relative = [...withV]
    .filter((p) => p.v! >= 25) // relative noise floor
    .sort((a, b) => b.v! / b.s - a.v! / a.s)
    .slice(0, 25)
    .map(toLane);
  const vs = withV.map((p) => p.v!).sort((a, b) => a - b);
  const medianV = vs.length ? vs[Math.floor(vs.length / 2)] : 1;

  const hunts: HuntRow[] = live
    .filter((c) => c.leftDays <= 7)
    .sort((a, b) => a.leftDays - b.leftDays)
    .slice(0, 25)
    .map((c) => ({
      hunter: c.hunter.r,
      victim: c.victim.r,
      hunterV: c.hunter.v,
      victimRank: c.victim.rank,
      gap: c.gap,
      eta: fmtEtaDays(c.leftDays),
      etaDays: c.leftDays,
      angles: c.angles,
    }));

  const entrants = (collisions?.entrants ?? []).slice(0, 8);
  const day = (route?.generated_at ?? "").slice(0, 10);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="raceway" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={meta?.repo ?? null} />
      </header>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          VELOCITY RANKINGS
        </h1>
        <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
          The fastest movers of the GitHub top 1000, measured daily from the worldwide registry.
          Tail length is speed; hue is the doppler tilt against the median pace of the whole fleet.
        </p>
        <p className="numeral text-micro tracking-[0.15em] text-faint">
          registry of {day} · velocities from the daily diff · overtake etas from the collision scan
        </p>
      </section>

      <section className="rise" style={{ animationDelay: "120ms" }}>
        <VelocityBoard absolute={absolute} relative={relative} hunts={hunts} medianV={medianV} />
      </section>

      {entrants.length ? (
        <section className="rise flex flex-col gap-2" style={{ animationDelay: "180ms" }}>
          <h2 className="font-display text-title tracking-[0.14em] text-ink">
            NEW IN THE TOP 1000 TODAY
          </h2>
          <div className="flex flex-wrap gap-2">
            {entrants.map((e) => (
              <Link
                key={e.r}
                prefetch={false}
                href={`/r/${e.r}`}
                className="hud numeral px-3 py-2 text-label text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                {e.r} · {fmtCompact(e.s)} ★ · #{e.rank}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link prefetch={false} href="/" className="numeral text-micro text-faint hover:text-dim">
          scan any repo →
        </Link>
      </footer>
    </main>
  );
}
