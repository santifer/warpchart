"use client";

// Stars per day: bars + 7-day moving average, plus the night-floor
// line (avg stars/hour between 00:00 and 04:59 UTC). A floor that keeps rising
// means compounding growth, not a spike decaying. Spike days carry an amber
// forensics marker with the identified cause. The view shows ~1 month at a
// time (~2 on a wide desktop panel); scroll/drag left to walk back through the
// full history. The Y scale re-fits to the visible window.
//
// Behind the bars, the rank ZONES (src/lib/ladder-bands.ts): per month, the
// stars a day needed to rank top 10/50/100/250 by new stars among the 1,000
// most-starred repos, in the daily velocity rank's colours. Because the axis re-fits as you pan,
// the zones grow and shrink with it: a quiet month sits in green and blue, a
// wave climbs into purple. Everyone sees the zones and their names; the
// owner's god mode adds the cut-off figures and each day's zone in the tooltip.
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ComposedChart, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceArea,
} from "recharts";
import { useLive } from "./LiveProvider";
import type { DashboardBundle } from "@/lib/bundle";
import { usePalette, useThemeMode } from "@/lib/usePalette";
import { useChartPan } from "@/lib/useChartPan";
import { BAND_TIERS, bandAreas, bandFor, zoneOf, type LadderBand } from "@/lib/ladder-bands";
import { TIERS } from "@/lib/velocity-rank-view";
import { TIER_COLOR, tierFillOpacity } from "@/lib/tier-colors";
import { fmt } from "@/lib/format";

interface Row {
  d: string;
  label: string;
  stars: number;
  ma7: number | null;
  floor: number | null;
  spike: number | null;
  cause: string | null;
}

// The compact panel shows ~1 month and pans back over the repo's FULL history;
// the full-screen deck (fill) shows ~3 months at once. A `wide` panel spans the
// whole console row on desktop (it used to share it with the heatmap), so it
// shows TWICE the days at the same bar width; below lg it is one column, as
// wide as before, and keeps the month.
const VISIBLE_COMPACT = 31;
const VISIBLE_WIDE = 62;
const VISIBLE_FILL = 93;

const LG = "(min-width: 1024px)";
function subscribeLg(cb: () => void) {
  const mq = window.matchMedia(LG);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
// server snapshot = false: SSR and the first client render agree on a month
const isLg = () => window.matchMedia(LG).matches;
const notLg = () => false;

// god mode = the owner's token in localStorage (set by /unlock). The zone
// figures it reveals are monthly medians already in the page, so this only
// decides how much the panel SAYS, it guards nothing.
function subscribeStorage(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
const hasGod = () => {
  try {
    return !!localStorage.getItem("wc_god");
  } catch {
    return false; // private mode
  }
};
const tierLabel = (key: string) => TIERS.find((t) => t.key === key)?.label ?? key.toUpperCase();
const rankOf = (key: string) => BAND_TIERS.find((t) => t.key === key)?.rank ?? null;
const monthName = (b: LadderBand) =>
  new Date(`${b.month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });

export default function DailyLadder({
  bundle,
  fill,
  wide,
  bands,
}: {
  bundle: DashboardBundle;
  fill?: boolean;
  wide?: boolean;
  // monthly rank zones (velocity-rank.ts ladderBands); null/absent = plain bars
  bands?: LadderBand[] | null;
}) {
  const live = useLive();
  const C = usePalette();
  const { resolved } = useThemeMode();
  const TC = TIER_COLOR[resolved];
  const lg = useSyncExternalStore(subscribeLg, isLg, notLg);
  const god = useSyncExternalStore(subscribeStorage, hasGod, notLg);

  // windowMs keeps the day key on the same clock as live.todayCount: with
  // a pre-midnight bundle and a failing velocity feed, nowMs would label
  // yesterday's frozen count as today.
  const todayKey = new Date(live.windowMs).toISOString().slice(0, 10);

  const all = useMemo<Row[]>(() => {
    const floorByDay = new Map(bundle.floor.map((f) => [f.d, f.perHour]));
    const causeByDay = new Map(
      bundle.spikes.filter((s) => s.causes.length).map((s) => [s.date, s.causes[0].title]),
    );
    return bundle.daily.map((p, i) => {
      const stars = p.d === todayKey ? live.todayCount : p.c;
      const cause = causeByDay.get(p.d) ?? null;
      return {
        d: p.d,
        label: p.d.slice(5).replace("-", "/"),
        stars,
        ma7: bundle.ma7[i],
        floor: floorByDay.get(p.d) ?? null,
        spike: cause ? stars : null,
        cause,
      };
    });
  }, [bundle.daily, bundle.ma7, bundle.floor, bundle.spikes, live.todayCount, todayKey]);

  const span = fill ? VISIBLE_FILL : wide && lg ? VISIBLE_WIDE : VISIBLE_COMPACT;
  const visible = Math.min(span, all.length);
  const latestOff = Math.max(0, all.length - visible);
  const [offset, setOffset] = useState<number | null>(null); // null = latest
  const offRef = useRef<number | null>(null);
  offRef.current = offset;
  const off = offset ?? latestOff;
  const view = all.slice(off, off + visible);

  const ref = useChartPan((frac) => {
    const cur = offRef.current ?? latestOff;
    const next = Math.min(Math.max(Math.round(cur - frac * visible), 0), latestOff);
    if (next === cur) return false;
    setOffset(next);
    return true;
  });

  // Y scales to the VISIBLE window, not the whole life: the full history now
  // includes the launch spike (often ~10x a normal day), so a globally-fixed
  // scale would flatten recent days into invisibility. Per-window scaling keeps
  // every era legible — the axis re-fits as you pan back toward the viral start.
  const dayMax = Math.max(1, ...view.map((r) => Math.max(r.stars, r.ma7 ?? 0)));
  const floorMax = Math.max(1, ...view.map((r) => r.floor ?? 0));
  const canPan = all.length > visible;
  const yTop = Math.ceil(dayMax * 1.05);

  // zones for the visible window, clipped to the re-fitted axis; the legend
  // names only the zones on screen and quotes the newest visible month
  const areas = bands?.length ? bandAreas(view, bands, yTop) : [];
  const shown = BAND_TIERS.filter((t) => areas.some((a) => a.tier === t.key));
  const lastBand = bands?.length && view.length ? bandFor(view[view.length - 1].d, bands) : null;

  return (
    <div
      className={`flex w-full flex-col gap-1.5 ${fill ? "h-full min-h-0" : ""}`}
      // read by the watchdog (presence.ladder-bands): how many monthly zones the
      // server handed over, and the newest one's month
      data-ladder-bands={bands?.length ?? 0}
      data-ladder-bands-last={bands?.length ? bands[bands.length - 1].month : ""}
    >
    <div ref={ref} className={`w-full touch-pan-y ${fill ? "min-h-0 flex-1" : "h-[250px]"}`} style={{ cursor: canPan ? "ew-resize" : undefined }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={view} margin={{ top: 6, right: 4, left: -14, bottom: 0 }}>
          {areas.map((a) => (
            <ReferenceArea
              key={a.key}
              yAxisId="day"
              x1={a.x1}
              x2={a.x2}
              y1={a.y1}
              y2={a.y2}
              fill={TC[a.tier]}
              // the velocity-rank opacity is tuned for thin lines; behind
              // bars the dark theme's green, blue and purple vanished, so they
              // get more. Legendary already carries its own boost: more reads brown
              fillOpacity={tierFillOpacity(a.tier, resolved, resolved === "dark" && a.tier !== "legendary" ? 1.5 : 1)}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            interval={3}
          />
          <YAxis
            yAxisId="day"
            domain={[0, yTop]}
            allowDataOverflow
            tick={{ fill: C.faint, fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <YAxis
            yAxisId="floor"
            orientation="right"
            domain={[0, Math.ceil(floorMax * 1.1)]}
            allowDataOverflow
            tick={{ fill: C.warn, fontSize: 9, opacity: 0.7 }}
            tickLine={false}
            axisLine={false}
            width={34}
          />
          <Tooltip
            cursor={{ fill: C.accentSoft }}
            contentStyle={{
              background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0,
              fontSize: 11, fontFamily: "var(--font-jbmono)",
            }}
            labelStyle={{ color: C.dim }}
            formatter={(value, name, entry) => {
              if (name === "stars") {
                // god mode: the day's zone against its month's cut-offs
                const d = (entry?.payload as Row | undefined)?.d;
                // today is a partial day: against 24 h cut-offs it would read
                // "below the top 250" every morning
                const b = god && d && d !== todayKey && bands?.length ? bandFor(d, bands) : null;
                if (!b) return [`${value}`, "stars/day"];
                const z = zoneOf(Number(value), b);
                const where = z === "common" ? "below the top 250" : `≈ top ${rankOf(z)}`;
                return [`${value} · ${where} ${b.basis === "month" ? "that month" : "on 30-day cut-offs"}`, "stars/day"];
              }
              if (name === "ma7") return [`${value}`, "7d average"];
              if (name === "spike") {
                const cause = (entry?.payload as Row | undefined)?.cause;
                return [cause ?? "spike", "likely cause"];
              }
              if (name === "floor") return [`${value}/h`, "night floor 00-05 UTC"];
              // anything else is the spike Scatter's x entry (the day label):
              // it used to print as "night floor : 10/04/h". null hides it
              return null;
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-jbmono)", color: C.dim }}
            formatter={(v) =>
              v === "stars" ? "stars/day" : v === "ma7" ? "7d avg" : "night floor (/h)"
            }
          />
          <Bar yAxisId="day" dataKey="stars" fill={C.accent} fillOpacity={0.55} maxBarSize={16} isAnimationActive={false} />
          <Line
            yAxisId="day" dataKey="ma7" stroke={C.ink} strokeWidth={1.4}
            dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Line
            yAxisId="floor" dataKey="floor" stroke={C.warn} strokeWidth={1}
            strokeDasharray="5 3" dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Scatter
            yAxisId="day" dataKey="spike" fill={C.warn} legendType="none" isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <path
                d={`M ${props.cx} ${(props.cy ?? 0) - 9} l 4 4 l -4 4 l -4 -4 Z`}
                fill={C.warn}
                opacity={0.95}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
      {shown.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
          {shown.map(({ key }) => (
            <span key={key} className="numeral text-micro tracking-[0.18em] text-faint">
              <span style={{ color: TC[key] }} aria-hidden>◆</span> {tierLabel(key)}
              {god && lastBand ? ` · ≥${fmt(lastBand.t[key])}/d` : ""}
            </span>
          ))}
          <span className="numeral text-micro text-faint">
            zones = stars a day needed to rank top 10 / 50 / 100 / 250 by new stars among the 1,000 most-starred repos, monthly median
            {god && lastBand
              ? ` · figures for ${monthName(lastBand)}${lastBand.basis === "trailing30" ? ", on the last 30 days (fewer than 7 measured that month)" : ""} (${lastBand.days} days) · ◈ god mode`
              : ""}
          </span>
        </div>
      )}
    </div>
  );
}
