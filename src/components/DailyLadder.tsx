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
  ComposedChart,
  ReferenceLine, Bar, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
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
// the full-screen deck (fill) shows the World rank window (62 days). A `wide` panel spans the
// whole console row on desktop (it used to share it with the heatmap), so it
// shows TWICE the days at the same bar width; below lg it is one column, as
// wide as before, and keeps the month.
const VISIBLE_COMPACT = 31;
const VISIBLE_WIDE = 62;
// the deck shows the same 62 days as its World rank panel beside it, so a
// rank climb and the star days behind it read against one date range
const VISIBLE_FILL = 62;

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
        // the deck writes every date as "Aug 3", like its other panels
        label: fill
          ? new Date(`${p.d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
          : p.d.slice(5).replace("-", "/"),
        stars,
        ma7: bundle.ma7[i],
        floor: floorByDay.get(p.d) ?? null,
        spike: cause ? stars : null,
        cause,
      };
    });
  }, [bundle.daily, bundle.ma7, bundle.floor, bundle.spikes, live.todayCount, todayKey, fill]);

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
  // the deck has no right axis: the night-floor series is labelled directly
  // with its latest value (rounded, it is a rate of whole stars)
  const lastFloor = [...view].reverse().find((r) => r.floor !== null)?.floor ?? null;
  const canPan = all.length > visible;
  // deck: even 1-2-5 steps and a domain that ends ON a labelled tick
  // (0 · 250 · … · 1000), so the top of the scale is readable
  const dayStep = (() => {
    const raw = (dayMax * 1.02) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
    return [1, 2, 2.5, 5, 10].map((k) => k * mag).find((x) => x >= raw) ?? 10 * mag;
  })();
  const yTop = fill ? Math.ceil((dayMax * 1.02) / dayStep) * dayStep : Math.ceil(dayMax * 1.05);
  const dayTicks = (() => {
    const out: number[] = [];
    for (let v = 0; v <= yTop + 1e-9; v += dayStep) out.push(Math.round(v));
    return out;
  })();

  // zones for the visible window, clipped to the re-fitted axis; the legend
  // names only the zones on screen and quotes the newest visible month
  const areas = bands?.length ? bandAreas(view, bands, yTop) : [];
  const shown = BAND_TIERS.filter((t) => areas.some((a) => a.tier === t.key));
  const lastBand = bands?.length && view.length ? bandFor(view[view.length - 1].d, bands) : null;
  const zoneCaption =
    "zones = stars a day needed to rank top 10 / 50 / 100 / 250 by new stars among the 1,000 most-starred repos, monthly median" +
    (god && lastBand
      ? ` · figures for ${monthName(lastBand)}${lastBand.basis === "trailing30" ? ", on the last 30 days (fewer than 7 measured that month)" : ""} (${lastBand.days} days) · ◈ god mode`
      : "");

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
        <ComposedChart data={view} margin={{ top: 6, right: fill ? 48 : 4, left: -14, bottom: 0 }}>
          {/* deck: thresholds as thin neutral lines, labelled at the right
              edge (FT style); tinted zones and their swatch legend read as
              colours nobody could match in a short cell */}
          {fill
            ? areas
                .filter((a) => a.y1 > 0 && a.y1 < yTop)
                .map((a) => (
                  <ReferenceLine
                    key={`t-${a.key}`}
                    yAxisId="day"
                    segment={[
                      { x: a.x1, y: a.y1 },
                      { x: a.x2, y: a.y1 },
                    ]}
                    stroke={C.dim}
                    strokeOpacity={0.55}
                    strokeDasharray="3 3"
                    ifOverflow="hidden"
                    label={
                      view.length && a.x2 === view[view.length - 1].label
                        ? { value: `top ${rankOf(a.tier)}`, position: "right", fill: C.dim, fontSize: 10 }
                        : undefined
                    }
                  />
                ))
            : null}
          {!fill && areas.map((a) => (
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
              // in the deck the zones are context, not content: half strength
              fillOpacity={tierFillOpacity(a.tier, resolved, (resolved === "dark" && a.tier !== "legendary" ? 1.5 : 1) * (fill ? 0.3 : 1))}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}
          <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.faint, fontSize: fill ? 11 : 9 }}
            tickLine={false}
            axisLine={{ stroke: C.grid }}
            // the deck labels one day every 14, counted back from today, the
            // same marks as the World rank axis beside it
            ticks={fill ? view.filter((r) => (Math.round(Date.parse(`${todayKey}T00:00:00Z`) / 864e5) - Math.round(Date.parse(`${r.d}T00:00:00Z`) / 864e5)) % 14 === 0).map((r) => r.label) : undefined}
            interval={fill ? 0 : 3}
            minTickGap={fill ? 0 : 5}
          />
          <YAxis
            yAxisId="day"
            domain={[0, yTop]}
            ticks={fill ? dayTicks : undefined}
            allowDataOverflow
            tick={{ fill: C.faint, fontSize: fill ? 11 : 9 }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <YAxis
            yAxisId="floor"
            orientation="right"
            domain={[0, Math.ceil(floorMax * 1.1)]}
            allowDataOverflow
            // a second numbered axis invites comparing heights that are not
            // comparable: the deck keeps the night-floor line but drops its
            // scale (values stay in the tooltip)
            tick={fill ? false : { fill: C.warn, fontSize: 9, opacity: 0.7 }}
            tickLine={false}
            axisLine={false}
            width={fill ? 0 : 34}
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
          {/* the deck folds the series key into the one legend row below */}
          {!fill && <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-jbmono)", color: C.dim }}
            formatter={(v) =>
              v === "stars" ? "stars/day" : v === "ma7" ? "7d avg" : "night floor (/h)"
            }
          />}
          <Bar yAxisId="day" dataKey="stars" fill={C.accent} fillOpacity={0.55} maxBarSize={16} isAnimationActive={false} />
          <Line
            yAxisId="day" dataKey="ma7" stroke={C.ink} strokeWidth={1.4}
            dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Line
            // deck: orange is for alerts only, so the night floor goes neutral
            yAxisId="floor" dataKey="floor" stroke={fill ? C.dim : C.warn} strokeWidth={1}
            strokeDasharray="5 3" dot={false} type="monotone" connectNulls isAnimationActive={false}
          />
          <Scatter
            // deck: the cause markers are white, so they never read as the
            // orange TOP 10 zone in the legend
            yAxisId="day" dataKey="spike" fill={fill ? C.ink : C.warn} legendType="none" isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <path
                d={`M ${props.cx} ${(props.cy ?? 0) - 9} l 4 4 l -4 4 l -4 -4 Z`}
                fill={fill ? C.ink : C.warn}
                opacity={0.95}
              />
            )}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
      {(fill || shown.length > 0) && (
        // in the deck (fill) the cell is short: ONE legend row carries the
        // series key and the zones, and the zone definition moves to a tooltip
        // on it, so the bars keep the height
        <div
          className={`flex flex-wrap items-center gap-y-1 px-1 ${fill ? "justify-center gap-x-3" : "gap-x-4"}`}
          title={fill && shown.length ? zoneCaption : undefined}
        >
          {fill ? (
            <>
              <span className="numeral text-micro text-faint">
                <span style={{ color: C.accent }} aria-hidden>▮</span> stars/day
              </span>
              <span className="numeral text-micro text-faint">
                <span style={{ color: C.ink }} aria-hidden>━</span> 7d avg
              </span>
              {bundle.spikes.length ? (
                <span className="numeral text-micro text-faint" title="a day with a known cause (post, launch, mention); hover the bar">
                  <span style={{ color: C.ink }} aria-hidden>◆</span> event
                </span>
              ) : null}
              <span className="numeral text-micro text-faint">
                <span style={{ color: C.dim }} aria-hidden>┅</span> night floor
                {lastFloor !== null ? <span className="text-ink"> {Math.round(lastFloor)}/h</span> : null}
              </span>
            </>
          ) : null}
          {fill && shown.length ? (
            <span className="numeral text-micro text-faint">
              <span style={{ color: C.dim }} aria-hidden>┄</span> top-N thresholds
            </span>
          ) : null}
          {!fill && shown.map(({ key }) => (
            <span key={key} className="numeral text-micro tracking-[0.18em] text-faint">
              {/* the deck keeps the rank and drops the tier name (in the tooltip) */}
              {/* zones are background bands: a swatch in the deck, so the ◆ glyph
                  means only "event" there */}
              <span style={{ color: TC[key] }} aria-hidden>{fill ? "▮" : "◆"}</span>{" "}
              {fill ? (tierLabel(key).split(" · ").pop() ?? "").replace("TOP ", "") : tierLabel(key)}
              {god && lastBand ? ` · ≥${fmt(lastBand.t[key])}/d` : ""}
            </span>
          ))}
          {shown.length && !fill ? <span className="numeral text-micro text-faint">{zoneCaption}</span> : null}
        </div>
      )}
    </div>
  );
}
