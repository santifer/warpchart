// Velocity rankings: the fastest movers of the GitHub top 1000, three
// lenses (absolute, relative-to-size, active overtakes). Built entirely
// from the daily registry diff and the collision scan: zero API cost,
// statically rendered, refreshed with each daily registry.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import VelocityBoard, { type LaneRepo, type HuntRow } from "@/components/VelocityBoard";
import BadgeSigil from "@/components/BadgeSigil";
import { classifiedRegistry } from "@/lib/badges";
import { loadRoute, loadCollisions, loadMeta, loadCatalog } from "@/lib/history";
import { canonicalVelocity, canonicalVel0 } from "@/lib/velocity";
import { fmtCompact, fmtEtaDays, fmt } from "@/lib/format";

// 15 min: the data file is daily, but ETAs age in render time, so rebuilds
// must outpace the shortest hunts (zero API cost, this page only reads fs)
export const revalidate = 900;

export const metadata: Metadata = {
  alternates: { canonical: "/velocity" },
  title: "The Warp Index · fastest-growing GitHub repositories, updated daily · Warpchart",
  description:
    "The Warp Index ranks the fastest-growing repositories on GitHub every day: fastest movers in stars per day, fastest risers relative to their size, and the active overtakes about to happen, with live ETAs. Free, with a machine-readable feed for investors and builders.",
  openGraph: { images: ["/api/og"] },
};

const FEED_URL = "/api/v1/velocity"; // JSON data feed (the VC/builder wedge)

export default function VelocityPage() {
  const route = loadRoute();
  const collisions = loadCollisions();
  const meta = loadMeta();

  // canonical velocity everywhere: the stable 7-day route rate (v7), falling back
  // to v only where v7 is missing — so the board matches /r/, the OG card and the
  // API instead of ranking on the noisy ~1-day rate.
  const ranked = (route?.repos ?? []).map((p, i) => ({ ...p, rank: i + 1, vEff: canonicalVelocity(p) }));
  const withV = ranked.filter((p) => p.vEff != null && p.vEff > 0);

  // the scan runs once per daily route refresh, but this page rebuilds
  // hourly: age every ETA by the time elapsed since the scan and drop
  // hunts whose deadline already passed (otherwise a 4-hour overtake
  // would still read "next" twenty hours after it happened)
  const scannedMs = collisions?.generated_at ? new Date(collisions.generated_at).getTime() : 0;
  // ISR server render (revalidate=900): Date.now() ages the overtake ETAs each
  // regeneration so a 4h hunt stops reading "next" 20h after it happened.
  // eslint-disable-next-line react-hooks/purity
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
    v: p.vEff!,
    l: p.l ?? null,
    relPct: (p.vEff! / p.s) * 100,
    hunt: huntByHunter.get(p.r) ?? null,
  });

  const absolute = [...withV].sort((a, b) => b.vEff! - a.vEff!).slice(0, 25).map(toLane);
  const relative = [...withV]
    .filter((p) => p.vEff! >= 25) // relative noise floor
    .sort((a, b) => b.vEff! / b.s - a.vEff! / a.s)
    .slice(0, 25)
    .map(toLane);
  const vs = withV.map((p) => p.vEff!).sort((a, b) => a - b);
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

  // ☄ COMETS — repos carrying the live-momentum badge (top 2% of recent
  // velocity, size-blind). Each links to its /r/ console: internal links +
  // discovery, and the surging-right-now cut of the whole catalog.
  const catalog = loadCatalog()?.repos ?? [];
  const byRepo = new Map(catalog.map((r) => [r.r.toLowerCase(), r]));
  const comets = classifiedRegistry()
    .filter((c) => c.key === "comet")
    .map((c) => byRepo.get(c.r.toLowerCase()))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => canonicalVel0(b) - canonicalVel0(a))
    .slice(0, 24);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1120px] flex-col gap-8 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="raceway" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={meta?.repo ?? null} />
      </header>

      <section className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          THE WARP INDEX
        </h1>
        <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
          The standings of the open-source race. Every day we chart the fastest-rising repositories
          on GitHub: who is accelerating, who is gaining fastest relative to their size, and who is
          about to overtake whom. Tail length is speed; hue is the doppler tilt against the median
          pace of the whole fleet.
        </p>
        <p className="numeral text-micro tracking-[0.15em] text-faint">
          registry of {day} · velocities are a trailing pace, up to 7 days · overtake etas from the collision scan
        </p>
        {/* a JSON API endpoint, not a page: plain anchor (not next/link). The
            href is a variable so the no-html-link-for-pages heuristic does not
            mistake the data feed for an internal page route. */}
        <a
          href={FEED_URL}
          className="numeral mt-1 inline-flex w-fit items-center gap-2 border border-grid px-3 py-1.5 text-micro tracking-[0.15em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
        >
          ▸ FOR INVESTORS &amp; BUILDERS · GET THIS AS JSON (/api/v1)
        </a>
      </section>

      {comets.length ? (
        <section className="rise flex flex-col gap-3" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center gap-2.5">
            <BadgeSigil badgeKey="comet" size={24} />
            <h2 className="font-display text-title tracking-[0.14em] text-ink">
              COMETS · SURGING RIGHT NOW
            </h2>
          </div>
          <p className="max-w-[720px] text-data font-light leading-relaxed text-dim">
            The top 2% of velocity (trailing pace, up to 7 days) across every tracked repository, regardless
            of size. A repo earns the comet the moment it starts accruing stars faster than almost everything else.
          </p>
          <div className="flex flex-wrap gap-2">
            {comets.map((c) => (
              <Link
                key={c.r}
                prefetch={false}
                href={`/r/${c.r}`}
                className="hud numeral flex items-center gap-2 px-3 py-2 text-label text-dim transition-colors hover:border-accent/40 hover:text-accent"
              >
                <span className="text-ink">{c.r}</span>
                <span className="text-faint">{fmtCompact(c.s)}★</span>
                <span style={{ color: "#5ef2cf" }}>{fmt(Math.round(canonicalVel0(c)))}/d</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

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
