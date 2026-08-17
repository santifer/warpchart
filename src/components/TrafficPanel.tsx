"use client";

// Traffic Vault panel. Traffic (views, clones, referrers) is the repo OWNER's
// PRIVATE data, so it is NEVER server-rendered into the public console. The
// public panel is a value-prop teaser; the real numbers are fetched client-side
// from /api/traffic ONLY when this browser holds a valid key. No key -> no
// numbers, ever, and since 2026-08-12 that includes the house repo: it used to
// be served publicly here as the live demo, until the policy that justified it
// was reversed.
//
// TWO WAYS TO HOLD THE KEY, ONE PLACE IT LIVES:
//   - ?vault=<key> in the URL: the private link a tenant gets on provisioning.
//     A link is a DELIVERY mechanism, not a place to keep a secret, so the key
//     is moved into localStorage and stripped from the address bar on arrival.
//     Left in the URL it rides along in history sync, screenshots, shared
//     screens and any copy-pasted link.
//   - localStorage "wc_vault": set by the link above, or by /unlock?v=<key> for
//     the owner master key. Survives reloads, never travels.
// The server re-validates the key on every request either way (/api/traffic):
// nothing here grants access, it only decides which key to present.
//
// The capped panel IS the free tier now: what a visitor sees is exactly what a
// tenant buys the key to unlock.
import { useEffect, useState } from "react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";
import type { TrafficVault } from "@/lib/traffic";

const WINDOW = 60; // most recent ~2 months on screen

// search engines and GitHub's own pages carry no growth signal — the EXTERNAL
// referrers (a tweet, a newsletter, a subreddit) are what actually drove people
// to the repo, so they are what the attribution line surfaces.
const SEARCH = /^(google|bing|yahoo|duckduckgo|ecosia|baidu|yandex|search\.brave\.com|github\.com)$/i;

const TOKEN = "wc_vault";

const read = (): string | null => {
  try {
    return localStorage.getItem(TOKEN);
  } catch {
    return null; // private mode / storage disabled: behave like no key
  }
};

export default function TrafficPanel({ repo }: { repo: string }) {
  const C = usePalette();
  const [vault, setVault] = useState<TrafficVault | null>(null);
  // a key this browser holds that the server refused, or that returned nothing.
  // Falling back to the teaser here would be an absence that lies: it reads as
  // "no data for this repo" when the truth is "your key did not work".
  const [failed, setFailed] = useState<null | "denied" | "empty">(null);
  const [held, setHeld] = useState(false);
  const [arming, setArming] = useState(false);
  const [people, setPeople] = useState(false);

  useEffect(() => {
    if (!repo) return;
    // A private link delivers the key once; from then on it lives in this
    // browser and not in the address bar.
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get("vault");
    if (fromLink) {
      try {
        localStorage.setItem(TOKEN, fromLink);
      } catch {}
      url.searchParams.delete("vault");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    // No key -> no request at all: the endpoint would 400 anyway now that no
    // repo is exempt, and not asking is the clearer statement of the invariant
    // (it also drops one request from every public page view).
    const key = fromLink || read();
    if (!key) return;
    setHeld(true);
    let cancelled = false;
    fetch(`/api/traffic?repo=${encodeURIComponent(repo)}&key=${encodeURIComponent(key)}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (cancelled) return;
        if (!j?.vault?.days?.length) return setFailed("empty");
        setVault(j.vault as TrafficVault);
      })
      .catch(() => !cancelled && setFailed("denied"));
    return () => {
      cancelled = true;
    };
  }, [repo]);

  const forget = () => {
    try {
      localStorage.removeItem(TOKEN);
    } catch {}
    location.reload();
  };

  // LOCK asks twice. It sits at the end of a text line in a panel people read,
  // one stray click destroys the only copy of a key this browser holds, and
  // there is no undo: the key cannot be read back out of Vercel. Santiago hit
  // it by accident within minutes of the first deploy.
  const lock = () => (arming ? forget() : setArming(true));
  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 4000);
    return () => clearTimeout(t);
  }, [arming]);

  // a key that does not work is worth saying out loud, with the way out
  if (failed) {
    return (
      <div className="flex h-[230px] flex-col items-center justify-center gap-2 text-center">
        <span className="font-display text-label tracking-[0.3em] text-warn">
          {failed === "denied" ? "◈ VAULT KEY REJECTED" : "◈ VAULT EMPTY"}
        </span>
        <span className="numeral max-w-[46ch] text-label leading-relaxed text-faint">
          {failed === "denied"
            ? "This browser holds a key the server did not accept for this repo."
            : `No traffic collected for ${repo} yet.`}
        </span>
        {/* no confirmation here: a key the server rejects is worth nothing, so
            dropping it costs nothing either */}
        <button onClick={forget} className="numeral text-micro tracking-[0.24em] text-dim hover:text-accent">
          FORGET KEY
        </button>
      </div>
    );
  }

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
  const rows = view.map((d) => ({
    label: d.d.slice(5).replace("-", "/"),
    views: people ? d.viewsU : d.views,
    clones: people ? d.clonesU : d.clones,
  }));
  const u14 = vault.uniq14;
  const vLabel = people ? "unique visitors" : "views";
  const cLabel = people ? "unique cloners" : "clones";

  // How old the DATA is, not how recently the collector ran. GitHub publishes a
  // day's traffic about a day late, so being 1 day behind is the normal state
  // and saying so would be noise. Past that it is worth saying out loud: on
  // 2026-08-16 GitHub's traffic API started 503ing and stopped publishing new
  // days entirely, and the panel had no way to tell the reader that the last
  // two days were missing rather than empty.
  const lagDays = vault.newestDay
    ? Math.floor((Date.now() - Date.parse(`${vault.newestDay}T00:00:00Z`)) / 86_400_000)
    : 0;
  const stale = lagDays >= 2;

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        {/* PER-DAY totals are addable; per-day UNIQUES are not (a person who
            comes back on Tuesday is two of them). So the people view heads with
            GitHub's own 14-day dedup instead of a sum it has no right to make.
            Summing them is exactly how this panel once published 91,685 when
            the real headcount was 29,837. */}
        {people ? (
          <span className="numeral text-data text-dim">
            {u14?.visitors != null ? (
              <>
                <span className="text-accent">{fmt(u14.visitors)}</span> visitors ·{" "}
              </>
            ) : null}
            {u14?.cloners != null ? (
              <>
                <span className="text-ink">{fmt(u14.cloners)}</span> cloners ·{" "}
              </>
            ) : null}
            <span className="text-faint">{"github's own 14-day dedup"}</span>
          </span>
        ) : (
          <span className="numeral text-data text-dim">
            <span className="text-accent">{fmt(vault.totalViews)}</span> views ·{" "}
            <span className="text-ink">{fmt(vault.totalClones)}</span> clones ·{" "}
            <span className="text-faint">{vault.daysKept} days kept</span>
          </span>
        )}
        {/* only when it matters: a day behind is how GitHub always works */}
        {stale ? (
          <span
            className={`numeral text-micro tracking-[0.15em] ${lagDays >= 3 ? "text-warn" : "text-dim"}`}
            title="GitHub publishes traffic with about a day of lag. Longer than that means its feed stalled, not that your repo went quiet."
          >
            ◈ THROUGH {vault.newestDay} · {lagDays}d BEHIND
          </span>
        ) : null}
        {/* The switch exists because CI inflates the raw count: every
            actions/checkout is a clone, so on a busy PR day most of the clone
            line is the repo's own runners. Uniques cut that down but do NOT
            remove it (runners are cloners too), and the label says so rather
            than promising a clean number. */}
        <span className="numeral flex gap-1 text-micro tracking-[0.2em]">
          {([["TOTAL", false], ["UNIQUE", true]] as const).map(([label, on]) => (
            <button
              key={label}
              onClick={() => setPeople(on)}
              // bordered like the referrer chips: an unboxed word in a line of
              // notes reads as prose, not as something you can press
              className={`border px-1.5 py-0.5 ${
                people === on
                  ? "border-accent/50 text-accent"
                  : "border-grid text-faint hover:border-dim hover:text-dim"
              }`}
            >
              {label}
            </button>
          ))}
        </span>
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          {people
            ? "per day, not addable · ci runners count as cloners too"
            : "private · github keeps 14 days · you keep all of it"}
        </span>
        {/* unmistakable that THIS browser is holding a key: the same screen is
            a teaser for everyone else, and that difference must never be
            something you have to remember while sharing a screen. */}
        {held ? (
          <span className="numeral ml-auto text-micro tracking-[0.24em] text-accent/70">
            ◈ UNLOCKED HERE ·{" "}
            <button
              onClick={lock}
              title={arming ? "click again to forget the key on this browser" : "forget the key on this browser"}
              className={`tracking-[0.24em] ${arming ? "text-warn" : "text-dim hover:text-accent"}`}
            >
              {arming ? "SURE? · FORGETS THE KEY" : "LOCK"}
            </button>
          </span>
        ) : null}
      </div>

      <div className="h-[160px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          {/* left margin + YAxis width are paired: a busy repo puts 5 digits on
              the axis, and the old -16/40 clipped them to their last 3 ("18377"
              read as "377"). */}
          <ComposedChart data={rows} margin={{ top: 6, right: 4, left: -6, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: C.faint, fontSize: 9 }} tickLine={false} axisLine={{ stroke: C.grid }} interval={Math.ceil(rows.length / 8)} />
            <YAxis
              // "auto" so recharts picks round ticks; a hard max forced ugly
              // ones (4.5K / 9K / 14K instead of 4K / 8K / 12K / 16K)
              domain={[0, "auto"]}
              tickFormatter={(v: number) => fmtCompact(v)}
              tick={{ fill: C.faint, fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={38}
            />
            <Tooltip
              cursor={{ fill: C.accentSoft }}
              contentStyle={{ background: C.hull, border: `1px solid ${C.grid}`, borderRadius: 0, fontSize: 11, fontFamily: "var(--font-jbmono)" }}
              labelStyle={{ color: C.dim }}
              formatter={(value, name) => [`${value}`, String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-jbmono)", color: C.dim }} />
            <Bar dataKey="views" name={vLabel} fill={C.accent} fillOpacity={0.5} maxBarSize={14} isAnimationActive={false} />
            <Line dataKey="clones" name={cLabel} stroke={C.ink} strokeWidth={1.4} dot={false} type="monotone" isAnimationActive={false} />
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
