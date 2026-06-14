"use client";

// Traffic Vault panel: the daily views and clones GitHub deletes after 14 days,
// kept forever, plus the latest top referrers. The DevRel surface: where star
// growth gets its "why" (referrers) and its reach (views). Renders an empty
// "vault filling" state until a traffic token is configured and the first
// snapshot lands, so it is safe on every console (house, tenant, locked demo).
import { useMemo } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt } from "@/lib/format";
import type { TrafficVault } from "@/lib/traffic";

const WINDOW = 60; // most recent ~2 months on screen

export default function TrafficPanel({ vault }: { vault: TrafficVault | null }) {
  const C = usePalette();
  const view = useMemo(() => (vault?.days ?? []).slice(-WINDOW), [vault]);

  if (!vault || !view.length) {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center">
        <span className="font-display text-label tracking-[0.3em] text-dim">TRAFFIC VAULT</span>
        <span className="numeral max-w-[42ch] text-label leading-relaxed text-faint">
          GitHub deletes views, clones and referrers every 14 days. The vault keeps every day from
          the moment tracking starts. Filling now.
        </span>
      </div>
    );
  }

  const rows = view.map((d) => ({ label: d.d.slice(5).replace("-", "/"), views: d.views, clones: d.clones }));
  const maxV = Math.max(1, ...rows.map((r) => Math.max(r.views, r.clones)));

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="numeral text-data text-dim">
          <span className="text-accent">{fmt(vault.totalViews)}</span> views ·{" "}
          <span className="text-ink">{fmt(vault.totalClones)}</span> clones ·{" "}
          <span className="text-faint">{vault.daysKept} days kept</span>
        </span>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          github keeps 14 days · you keep all of it
        </span>
      </div>

      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 6, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.faint, fontSize: 9 }} tickLine={false} axisLine={{ stroke: C.grid }} interval={Math.ceil(rows.length / 8)} />
            <YAxis domain={[0, Math.ceil(maxV * 1.05)]} tick={{ fill: C.faint, fontSize: 9 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip
              cursor={{ fill: C.accentSoft }}
              contentStyle={{ background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
              labelStyle={{ color: C.dim }}
              formatter={(value, name) => [`${value}`, name === "views" ? "views" : "clones"]}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-jbmono)", color: C.dim }} />
            <Bar dataKey="views" fill={C.accent} fillOpacity={0.5} maxBarSize={14} isAnimationActive={false} />
            <Line dataKey="clones" stroke={C.ink} strokeWidth={1.4} dot={false} type="monotone" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {vault.referrers.length ? (
        <div className="flex flex-col gap-1">
          <span className="module-title !text-micro">Top referrers (last 14 days)</span>
          <div className="flex flex-wrap gap-1.5">
            {vault.referrers.slice(0, 6).map((r) => (
              <span key={r.r} className="numeral border border-grid px-2 py-0.5 text-micro text-dim">
                {r.r} · {fmt(r.c)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
