"use client";

// Traffic Vault panel. Traffic (views, clones, referrers) is the repo OWNER's
// PRIVATE data, so it is NEVER server-rendered into the public console. The
// public panel is a value-prop teaser; the real numbers are fetched client-side
// from /api/traffic ONLY when the URL carries a valid ?vault=<key> (the private
// link the owner gets in their welcome email). No key -> no numbers, ever —
// EXCEPT the house repo, which the API serves publicly (radical transparency +
// the live demo of the product), flagged by `public: true` in the response.
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt } from "@/lib/format";
import type { TrafficVault } from "@/lib/traffic";

const WINDOW = 60; // most recent ~2 months on screen

// search engines and GitHub's own pages carry no growth signal — the EXTERNAL
// referrers (a tweet, a newsletter, a subreddit) are what actually drove people
// to the repo, so they are what the attribution line surfaces.
const SEARCH = /^(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex|search\.brave\.com|github\.com)$/i;

export default function TrafficPanel({ repo }: { repo: string }) {
  const C = usePalette();
  const [vault, setVault] = useState<TrafficVault | null>(null);
  const [isPublic, setIsPublic] = useState(false);

  useEffect(() => {
    if (!repo) return;
    // The owner's private vault link carries ?vault=<key>. The house repo needs
    // no key (the API serves it publicly), so we ALWAYS try the fetch and let
    // the endpoint decide: a non-house repo with no key just fails and we keep
    // the teaser.
    const key = new URLSearchParams(window.location.search).get("vault");
    const url = `/api/traffic?repo=${encodeURIComponent(repo)}${key ? `&key=${encodeURIComponent(key)}` : ""}`;
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.vault?.days?.length) return;
        setVault(j.vault as TrafficVault);
        setIsPublic(!!j.public);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [repo]);

  // teaser: shown to everyone on the public console (privacy is the pitch)
  if (!vault) {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center">
        <span className="font-display text-label tracking-[0.3em] text-accent">◈ PRIVATE TRAFFIC VAULT</span>
        <span className="numeral max-w-[46ch] text-label leading-relaxed text-faint">
          GitHub deletes your views, clones and referrers every 14 days, and only you can read them.
          The vault keeps every day from the moment tracking starts, and only the owner sees the
          numbers. Open your private vault link to view.
        </span>
      </div>
    );
  }

  const view = vault.days.slice(-WINDOW);
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
          {isPublic ? "public · github erases 14 days · we kept it all" : "private · github keeps 14 days · you keep all of it"}
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
        (() => {
          // attribution: the top EXTERNAL referrer is the likeliest driver of
          // recent growth (search/github traffic is ambient, not a "what drove
          // this" event).
          const externals = vault.referrers.filter((r) => !SEARCH.test(r.r));
          const topExternal = externals[0] ?? null;
          return (
            <div className="flex flex-col gap-1.5">
              {topExternal ? (
                <span className="numeral text-micro leading-relaxed text-dim">
                  ◈ Driving growth right now:{" "}
                  <span className="text-accent">{topExternal.r}</span>{" "}
                  <span className="text-faint">({fmt(topExternal.c)} visits)</span>
                  {externals[1] ? (
                    <>
                      , then <span className="text-ink">{externals[1].r}</span>
                      {externals[2] ? (
                        <>
                          {" "}and <span className="text-ink">{externals[2].r}</span>
                        </>
                      ) : null}
                    </>
                  ) : null}
                </span>
              ) : null}
              <span className="module-title !text-micro">Top referrers · last 14 days</span>
              <div className="flex flex-wrap gap-1.5">
                {vault.referrers.slice(0, 6).map((r) => {
                  const ext = !SEARCH.test(r.r);
                  return (
                    <span
                      key={r.r}
                      className={`numeral border px-2 py-0.5 text-micro ${ext ? "border-accent/40 text-dim" : "border-grid text-faint"}`}
                    >
                      {r.r} · {fmt(r.c)}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })()
      ) : null}
    </div>
  );
}
