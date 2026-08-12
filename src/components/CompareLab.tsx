"use client";

// THE RACE: an interactive multi-repo comparison. Reuses /api/curve (the cached
// reconstruction that also feeds the embed and the OG card), so adding repos
// never multiplies GitHub cost. What it does that star-history cannot:
//   - two metrics: cumulative stars AND growth rate (stars/day over time)
//   - align by day-0 (compare trajectories from birth, not calendar date)
//   - a rich legend (live stars, world rank, velocity per repo)
//   - an auto-written readout: who is biggest, who is fastest, who overtook whom
//   - a shareable OG card baked from the same data (the viral loop)
// Mission-control aesthetic, URL-stateful, sound-free.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceDot,
} from "recharts";
import { usePalette } from "@/lib/usePalette";
import { fmt, fmtCompact } from "@/lib/format";
import {
  DAY, repoColor, rateAt, lastCrossover, projectCrossing, shortRepo, type CurvePoint,
} from "@/lib/compare";
import { useRace } from "./RaceContext";
import BadgeSigil from "./BadgeSigil";
import { ghAvatarForRepo } from "@/lib/avatar";

interface Curve {
  repo: string;
  total: number;
  pts: CurvePoint[];
  dashedFrom: number | null;
  archiveFrom?: number | null;
  // recent window from our own exact daily record (rank-history moat)
  exactFrom?: number | null;
}
interface Stats {
  repo: string;
  rank: number;
  stars: number;
  velocityPerDay: number | null;
}
interface SearchItem {
  r: string;
  s: number;
  d: string | null;
}
type Metric = "cumulative" | "growth";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX = 8;
const SUGGEST = ["ollama/ollama", "tinygrad/tinygrad", "simonw/llm"];

function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  const out = arr.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

// transformed rows [{x,y}] for one repo under the current metric/align
function seriesRows(curve: Curve, metric: Metric, align: boolean): { x: number; y: number }[] {
  const pts = curve.pts;
  if (pts.length < 2) return [];
  const t0 = pts[0].t;
  if (metric === "cumulative") {
    return downsample(pts, 160).map((p) => ({ x: align ? (p.t - t0) / DAY : p.t, y: p.v }));
  }
  // growth: trailing 7-day rate sampled across the lifespan
  const t1 = pts[pts.length - 1].t;
  const days = Math.max(1, (t1 - t0) / DAY);
  const N = Math.min(180, Math.max(8, Math.round(days)));
  const rows: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    rows.push({ x: align ? (t - t0) / DAY : t, y: Math.round(rateAt(pts, t)) });
  }
  return rows;
}

function interpAtX(rows: { x: number; y: number }[], x: number): number | null {
  if (!rows.length || x < rows[0].x || x > rows[rows.length - 1].x) return null;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].x < x) lo = mid + 1;
    else hi = mid;
  }
  if (rows[lo].x === x) return rows[lo].y;
  const b = rows[lo];
  const a = rows[lo - 1];
  const k = (x - a.x) / Math.max(1e-9, b.x - a.x);
  return a.y + (b.y - a.y) * k;
}

export default function CompareLab({
  initialRepos,
  initialMetric = "cumulative",
  initialAlign = false,
  initialLog = false,
  embedded = false,
}: {
  initialRepos: string[];
  initialMetric?: Metric;
  initialAlign?: boolean;
  initialLog?: boolean;
  // embedded: lives inside a repo page / console panel as the star chart itself.
  // Hides the manual add-bar and shareable footer, fills its container, and
  // shows a threat-alert toggle that injects the repo's rivals (race in place).
  embedded?: boolean;
}) {
  const C = usePalette();
  const [repos, setRepos] = useState<string[]>(initialRepos);
  const [curves, setCurves] = useState<Record<string, Curve>>({});
  const [status, setStatus] = useState<Record<string, "loading" | "ok" | "error">>({});
  // each repo's earned classifications (badges), fetched from the public API so
  // the sigil rides alongside its name in the race.
  const [cls, setCls] = useState<Record<string, { key: string; label: string; kind: string }[]>>({});
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [metric, setMetric] = useState<Metric>(initialMetric);
  const [align, setAlign] = useState(initialAlign);
  const [log, setLog] = useState(initialLog && initialMetric === "cumulative");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // embedded solo starts WITHOUT the crossover zoom (nothing to cross until
  // rivals are toggled in); the toggle turns it on with the race.
  const [zoom, setZoom] = useState(!embedded && initialMetric === "cumulative");
  const [zoomP, setZoomP] = useState(1); // 0 = full view, 1 = zoomed to crossover
  const [drawing, setDrawing] = useState(true); // line draw-in active (phase 1)
  const fetched = useRef<Set<string>>(new Set());

  // ---- embedded race-in-place ----
  // The chart is the page's own repo; the race state (and the threat-alert
  // toggle, which lives in the panel HEADER next to the title) is held by
  // RaceContext above us, so the controls leave the whole body for the chart.
  // Embedded mirrors the controlled repos: solo = [main], race = [main,
  // ...rivals], with the crossover zoom auto-armed in race mode. /compare has
  // no provider, so useRace() is inert there.
  const mainRepo = initialRepos[0] ?? "";
  const race = useRace();
  const raceOn = embedded && race.raceOn;
  const rivalsKey = race.rivals.join(",");
  useEffect(() => {
    if (!embedded) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRepos(raceOn ? [mainRepo, ...race.rivals] : [mainRepo]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(raceOn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, raceOn, mainRepo, rivalsKey]);

  // fetch each repo's curve once (cached server-side)
  useEffect(() => {
    for (const repo of repos) {
      const key = repo.toLowerCase();
      if (fetched.current.has(key)) continue;
      fetched.current.add(key);
      // classifications (badges) ride alongside the curve, from the public API
      fetch(`/api/v1/repo?repo=${encodeURIComponent(repo)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.classifications?.length) setCls((c) => ({ ...c, [key]: j.classifications }));
        })
        .catch(() => {});
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus((s) => ({ ...s, [key]: "loading" }));
      (async () => {
        try {
          const res = await fetch(`/api/curve?repo=${encodeURIComponent(repo)}`);
          if (!res.ok) throw new Error(String(res.status));
          const data = (await res.json()) as Curve;
          setCurves((c) => ({ ...c, [key]: data }));
          setStatus((s) => ({ ...s, [key]: "ok" }));
        } catch {
          setStatus((s) => ({ ...s, [key]: "error" }));
        }
      })();
    }
  }, [repos]);

  // live stats (rank/velocity) from the cache-only compare endpoint
  useEffect(() => {
    if (!repos.length) return;
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/compare?repos=${encodeURIComponent(repos.join(","))}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { results: { repo: string; stats: Stats | null }[] };
        const map: Record<string, Stats> = {};
        for (const r of body.results) if (r.stats) map[r.repo.toLowerCase()] = r.stats;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setStats(map);
      } catch { /* stats are optional */ }
    }, 250);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [repos]);

  // URL state (shareable, SSR-able for the OG card). Embedded never owns the
  // URL — it lives on a repo/console page, not /compare.
  useEffect(() => {
    if (embedded) return;
    const p = new URLSearchParams();
    if (repos.length) p.set("repos", repos.join(","));
    if (metric !== "cumulative") p.set("metric", metric);
    if (align) p.set("align", "1");
    if (log) p.set("log", "1");
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `/compare?${qs}` : "/compare");
  }, [repos, metric, align, log]);

  // autocomplete
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { items: SearchItem[] };
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setItems(body.items ?? []);
      } catch { /* ignore */ }
    }, 200);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [query]);

  const addRepo = (raw: string) => {
    const r = raw.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\/$/, "");
    if (!REPO_RE.test(r)) return;
    if (repos.some((x) => x.toLowerCase() === r.toLowerCase())) return;
    if (repos.length >= MAX) return;
    setRepos([...repos, r]);
    setQuery("");
    setItems([]);
    setOpen(false);
  };
  const removeRepo = (r: string) =>
    setRepos(repos.filter((x) => x.toLowerCase() !== r.toLowerCase()));

  // Stable per-repo colors: a repo keeps its color when OTHERS are removed.
  // Index-based color would reshuffle every line/chip on each removal, which
  // is exactly what confuses someone testing with many repos. Removed colors
  // are freed and reused by the next add.
  const colorIdx = useRef<Record<string, number>>({});
  const colors = useMemo(() => {
    const map = colorIdx.current;
    const keys = repos.map((r) => r.toLowerCase());
    for (const k of Object.keys(map)) if (!keys.includes(k)) delete map[k];
    for (const k of keys) {
      if (map[k] === undefined) {
        const used = new Set(Object.values(map));
        let idx = 0;
        while (used.has(idx)) idx++;
        map[k] = idx;
      }
    }
    return keys.map((k) => repoColor(map[k]));
  }, [repos]);

  // build the merged chart data (+ forecast projection + crossover zoom frame)
  const view = useMemo(() => {
    type S = { repo: string; i: number; c: Curve; rows: { x: number; y: number }[] };
    const series: S[] = repos
      .map((repo, i) => {
        const c = curves[repo.toLowerCase()];
        return c ? { repo, i, c, rows: seriesRows(c, metric, align) } : null;
      })
      .filter((s): s is S => !!s && s.rows.length > 0);

    const xs = new Set<number>();
    let yMax = 1;
    let yMin = Infinity;
    for (const s of series) for (const r of s.rows) {
      xs.add(r.x);
      if (r.y > yMax) yMax = r.y;
      if (r.y < yMin) yMin = r.y;
    }

    // zoom-to-crossover only makes sense on the calendar cumulative view
    const zoomable = zoom && metric === "cumulative" && !align && series.length >= 1;
    const velOf = (s: S) => {
      const st = stats[s.repo.toLowerCase()];
      if (st && st.velocityPerDay != null) return st.velocityPerDay;
      return rateAt(s.c.pts, s.c.pts[s.c.pts.length - 1].t);
    };

    type Cross = { t: number; val: number; winner: number; loser: number; future: boolean };
    let focus: { t: number; val: number } | null = null;
    let crossovers: Cross[] = [];
    const projByI: Record<number, { x: number; y: number }[]> = {};
    if (zoomable) {
      const nowMs = Math.max(...series.map((s) => s.rows[s.rows.length - 1].x));
      const cur = series.map((s) => ({
        i: s.i,
        x: s.rows[s.rows.length - 1].x,
        y: s.rows[s.rows.length - 1].y,
        v: velOf(s),
      }));
      // every pair can cross: a forecast crossover (faster repo catching up) or
      // a historical one (they already swapped). Collect them all.
      const ev: Cross[] = [];
      for (let a = 0; a < series.length; a++)
        for (let b = a + 1; b < series.length; b++) {
          // only contact points that involve the MAIN repo (i===0): the
          // monitored repo's own crossings (who it passes / who passes it),
          // never a race between two rivals that does not touch us
          if (series[a].i !== 0 && series[b].i !== 0) continue;
          const A = cur[a];
          const B = cur[b];
          // forecast crossover through the SHARED projection (same math the
          // neighbor scan-cards use): a meeting exists only when the behind
          // repo is the faster one, so etaDays is non-null exactly then.
          const x = projectCrossing(A.y, A.v, B.y, B.v);
          if (x.etaDays !== null && x.etaDays > 0 && x.etaDays < 140) {
            const faster = A.v > B.v ? series[a].i : series[b].i;
            const slower = A.v > B.v ? series[b].i : series[a].i;
            ev.push({ t: nowMs + x.etaDays * DAY, val: A.y + A.v * x.etaDays, winner: faster, loser: slower, future: true });
          }
          const hc = lastCrossover(series[a].c.pts, series[b].c.pts);
          if (hc) {
            ev.push({
              t: hc.t,
              val: interpAtX(series[a].rows, hc.t) ?? A.y,
              winner: hc.leader === "a" ? series[a].i : series[b].i,
              loser: hc.leader === "a" ? series[b].i : series[a].i,
              future: false,
            });
          }
        }
      // one event per pair (the one nearest to now), nearest first, capped
      const byPair = new Map<string, Cross>();
      for (const e of ev) {
        const key = [Math.min(e.winner, e.loser), Math.max(e.winner, e.loser)].join("-");
        const prev = byPair.get(key);
        if (!prev || Math.abs(e.t - nowMs) < Math.abs(prev.t - nowMs)) byPair.set(key, e);
      }
      crossovers = [...byPair.values()].sort((p, q) => Math.abs(p.t - nowMs) - Math.abs(q.t - nowMs)).slice(0, 6);
      focus = crossovers.length ? { t: crossovers[0].t, val: crossovers[0].val } : { t: nowMs, val: cur[0].y };
      // project the dashed forecast only as far as the FURTHEST relevant
      // (main-repo) crossover, plus a hair so its dot isn't on the edge — the
      // line should stop at the last contact point with us, not keep running
      // past it into a future that touches nobody we care about
      const futureT = crossovers.map((c) => c.t).filter((t) => t > nowMs);
      const lastDays = futureT.length ? (Math.max(...futureT) - nowMs) / DAY : 0;
      const horizon = nowMs + Math.max(lastDays > 0 ? lastDays * 1.06 : 7, 3) * DAY;
      for (const c of cur) {
        projByI[c.i] = [
          { x: c.x, y: c.y },
          { x: horizon, y: c.y + (c.v * (horizon - c.x)) / DAY },
        ];
        xs.add(c.x);
        xs.add(horizon);
      }
      for (const e of crossovers) xs.add(e.t);
    }

    const masterX = [...xs].sort((a, b) => a - b);
    const rows = masterX.map((x) => {
      const row: Record<string, number | null> = { x };
      for (const s of series) row[`r${s.i}`] = interpAtX(s.rows, x);
      if (zoomable) for (const s of series) row[`p${s.i}`] = projByI[s.i] ? interpAtX(projByI[s.i], x) : null;
      return row;
    });
    const refDots = series.map((s) => {
      const last = s.rows[s.rows.length - 1];
      return { i: s.i, x: last.x, y: log && metric === "cumulative" && !zoom ? Math.max(1, last.y) : last.y };
    });

    const minX = series.length ? series.reduce((m, s) => Math.min(m, s.rows[0].x), Infinity) : 0;
    const maxX = series.length ? Math.max(...series.map((s) => s.rows[s.rows.length - 1].x)) : 1;
    const fullX: [number, number] = [minX, maxX];
    const fullY: [number, number] = [log && metric === "cumulative" && !zoom ? Math.max(1, yMin) : 0, Math.max(yMax, 1)];

    let zoomX: [number, number] | null = null;
    let zoomY: [number, number] | null = null;
    if (zoomable && focus) {
      const nowMs = maxX;
      const focusDays = Math.abs((focus.t - nowMs) / DAY);
      const hist = Math.min(120, Math.max(30, focusDays * 2.5)) * DAY;
      const proj = Math.min(45, Math.max(6, focusDays * 0.5 + 7)) * DAY;
      const x0 = focus.t - hist;
      const x1 = focus.t + proj;
      zoomX = [x0, x1];
      let lo = Infinity;
      let hi = -Infinity;
      for (const row of rows) {
        if (row.x! < x0 || row.x! > x1) continue;
        for (const s of series) for (const k of [`r${s.i}`, `p${s.i}`]) {
          const v = row[k];
          if (v != null) {
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
      }
      if (lo === Infinity) {
        lo = fullY[0];
        hi = fullY[1];
      }
      const pad = (hi - lo) * 0.08 || 1;
      zoomY = [Math.max(0, lo - pad), hi + pad];
    }

    return {
      data: rows,
      refDots,
      focus: zoomable ? focus : null,
      crossovers: zoomable ? crossovers : [],
      fullX,
      fullY,
      zoomX,
      zoomY,
      projRepos: zoomable ? series.map((s) => s.i) : [],
      hasZoom: !!(zoomable && zoomX),
      anyLoading: repos.some((r) => status[r.toLowerCase()] === "loading"),
    };
  }, [repos, curves, metric, align, log, status, stats, zoom]);

  // camera: the lines draw in the full view, then (after ~1.1s) the frame
  // animates a zoom into the crossover. Re-runs when the comparison or its
  // loaded data changes, and when the zoom toggle flips.
  const loadedKey = repos.map((r) => (curves[r.toLowerCase()] ? "1" : "0")).join("") + metric + align;
  useEffect(() => {
    const zoomable = zoom && view.hasZoom;
    // phase 1: the lines draw in the full view
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawing(true);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoomP(zoomable ? 0 : 1);
    let raf = 0;
    const t = setTimeout(() => {
      // phase 2: FREEZE the drawn lines, then zoom the FRAME only (a pure
      // vector reframe — no redraw, which was the broken-segments effect)
      setDrawing(false);
      if (!zoomable) return;
      const start = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / 900);
        setZoomP(1 - Math.pow(1 - k, 3));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }, 1050);
    return () => {
      clearTimeout(t);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [zoom, view.hasZoom, loadedKey]);

  // auto-insight: biggest, fastest, most recent overtake
  const insight = useMemo(() => {
    const ready = repos
      .map((repo) => ({ repo, c: curves[repo.toLowerCase()] }))
      .filter((x): x is { repo: string; c: Curve } => !!x.c && x.c.pts.length > 1);
    if (ready.length < 1) return null;
    const biggest = [...ready].sort((a, b) => b.c.total - a.c.total)[0];
    const fastest = [...ready]
      .map((x) => ({ repo: x.repo, rate: rateAt(x.c.pts, x.c.pts[x.c.pts.length - 1].t) }))
      .sort((a, b) => b.rate - a.rate)[0];
    let cross: { a: string; b: string; t: number } | null = null;
    for (let i = 0; i < ready.length; i++)
      for (let j = i + 1; j < ready.length; j++) {
        const x = lastCrossover(ready[i].c.pts, ready[j].c.pts);
        if (x && (!cross || x.t > cross.t)) {
          const leader = x.leader === "a" ? ready[i].repo : ready[j].repo;
          const trailer = x.leader === "a" ? ready[j].repo : ready[i].repo;
          cross = { a: leader, b: trailer, t: x.t };
        }
      }
    return {
      biggest: biggest.repo,
      fastest: fastest.repo,
      fastestRate: Math.round(fastest.rate),
      cross,
    };
  }, [repos, curves]);


  const shareUrl = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "https://warpchart.dev";
    const p = new URLSearchParams({ repos: repos.join(",") });
    if (metric !== "cumulative") p.set("metric", metric);
    if (align) p.set("align", "1");
    return `${base}/compare?${p.toString()}`;
  }, [repos, metric, align]);
  const ogUrl = useMemo(() => {
    const base = typeof window !== "undefined" ? window.location.origin : "https://warpchart.dev";
    return `${base}/api/og?compare=${encodeURIComponent(repos.join(","))}`;
  }, [repos]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Star race · Warpchart", url: shareUrl });
        return;
      } catch { /* fell through to copy */ }
    }
    copyLink();
  };
  const downloadCsv = () => {
    const lines = ["repo,date,stars"];
    for (const repo of repos) {
      const c = curves[repo.toLowerCase()];
      if (!c) continue;
      for (const p of c.pts) lines.push(`${repo},${new Date(p.t).toISOString().slice(0, 10)},${Math.round(p.v)}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warpchart-race-${repos.map(shortRepo).join("-").slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const btn = "numeral border border-grid px-3 py-1.5 text-micro tracking-[0.2em] text-dim transition-colors hover:border-accent/50 hover:text-accent";

  // camera frame: lerp between the full view and the crossover zoom by zoomP
  const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
  const useZoom = zoom && view.hasZoom && view.zoomX != null && view.zoomY != null;
  const xDomain: [number, number] = useZoom
    ? [lerp(view.fullX[0], view.zoomX![0], zoomP), lerp(view.fullX[1], view.zoomX![1], zoomP)]
    : view.fullX;
  const yDomain: [number, number] = useZoom
    ? [lerp(view.fullY[0], view.zoomY![0], zoomP), lerp(view.fullY[1], view.zoomY![1], zoomP)]
    : view.fullY;

  // X axis labels adapt to the visible span: month+year zoomed out, day when
  // closer, day + predicted hour in the tight crossover window.
  const xSpanDays = (xDomain[1] - xDomain[0]) / DAY;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const fmtX = (x: number) => {
    if (align) {
      if (x < 60) return `${Math.round(x)}d`;
      if (x < 730) return `${Math.round(x / 30.44)}mo`;
      return `${(x / 365.25).toFixed(1)}y`;
    }
    const d = new Date(x);
    if (xSpanDays > 420) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    if (xSpanDays > 9) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${pad2(d.getHours())}:00`;
  };
  const focusLabel = view.focus
    ? `~ ${new Date(view.focus.t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${
        xSpanDays <= 9 ? ` ${pad2(new Date(view.focus.t).getHours())}:00` : ""
      }`
    : "";

  // Solo (embedded, one repo) relocates the per-repo honesty that the race
  // view can't show across many lines: where the curve is exact vs reconstructed.
  const mainCurve = curves[mainRepo.toLowerCase()];
  const seamNote = !mainCurve
    ? "reconstructing trajectory…"
    : (mainCurve.exactFrom ?? null) !== null
      ? "recent window: exact daily record · earlier: reconstructed beyond GitHub's 40K cap"
      : (mainCurve.archiveFrom ?? null) !== null
        ? "exact api timestamps + gh archive beyond the 40K cap (normalized)"
        : mainCurve.dashedFrom !== null
          ? "solid = real stargazer timestamps · dashed = estimated beyond the 40K cap"
          : "every point is a real stargazer timestamp";

  return (
    <div className={embedded ? "flex h-full min-h-0 flex-col gap-2" : "flex flex-col gap-4"}>
      {/* embedded legend: the chips are hidden here, so this carries each racer's
          colour, short name and earned sigils (the star chart on /r/ + console) */}
      {embedded && repos.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
          {repos.map((repo, i) => (
            <span key={repo} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0" style={{ background: colors[i] }} />
              <span className="numeral text-micro text-dim">{shortRepo(repo)}</span>
              {(cls[repo.toLowerCase()] ?? []).map((c) => (
                <BadgeSigil key={c.key} badgeKey={c.key} size={15} />
              ))}
            </span>
          ))}
        </div>
      ) : null}
      {/* add bar (manual repo picker) — hidden when embedded in a repo/console panel */}
      {!embedded ? (
      <div className="hud relative px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRepo(items[0]?.r ?? query);
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="add a repo to the race — owner/name"
              className="numeral w-full border border-grid bg-void/60 px-3 py-2 text-label text-ink outline-none placeholder:text-faint focus:border-accent/60"
            />
            {open && items.length > 0 ? (
              <div className="hud absolute left-0 right-0 top-full z-20 mt-1 max-h-[280px] overflow-auto bg-void/95 p-1 backdrop-blur">
                {items.map((it) => (
                  <button
                    key={it.r}
                    onClick={() => addRepo(it.r)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/10"
                  >
                    <span className="numeral truncate text-label text-ink">{it.r}</span>
                    <span className="numeral shrink-0 text-micro text-faint">{fmtCompact(it.s)}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button onClick={() => addRepo(items[0]?.r ?? query)} className={btn}>
            + ADD
          </button>
          {repos.length ? (
            <button onClick={() => setRepos([])} className={btn}>
              CLEAR
            </button>
          ) : null}
        </div>
        {/* chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {repos.map((repo, i) => (
            <span
              key={repo}
              className="flex items-center gap-2 border px-2.5 py-1"
              style={{ borderColor: `${colors[i]}66` }}
            >
              <span className="h-2.5 w-2.5 shrink-0" style={{ background: colors[i] }} />
              <span className="numeral text-label text-ink">{repo}</span>
              {(cls[repo.toLowerCase()] ?? []).map((c) => (
                <BadgeSigil key={c.key} badgeKey={c.key} size={16} />
              ))}
              {status[repo.toLowerCase()] === "loading" ? (
                <span className="numeral text-micro text-faint">scanning…</span>
              ) : status[repo.toLowerCase()] === "error" ? (
                <span className="numeral text-micro text-warn">failed</span>
              ) : null}
              <button onClick={() => removeRepo(repo)} className="text-dim transition-colors hover:text-warn" aria-label={`remove ${repo}`}>
                ✕
              </button>
            </span>
          ))}
          {repos.length === 0
            ? SUGGEST.map((s) => (
                <button key={s} onClick={() => addRepo(s)} className="numeral border border-grid px-2.5 py-1 text-micro text-faint transition-colors hover:border-accent/50 hover:text-accent">
                  + {s}
                </button>
              ))
            : null}
        </div>
      </div>
      ) : null}

      {/* toolbar — entirely hidden when embedded: the only control there is the
          header race toggle, and the crossover zoom auto-arms with the race.
          The full lab (/compare) keeps the tabs + zoom/align/log. */}
      {!embedded ? (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 border border-grid p-1">
          {(["cumulative", "growth"] as Metric[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMetric(m);
                if (m === "growth") {
                  setLog(false);
                  setZoom(false);
                } else {
                  setZoom(true);
                }
              }}
              className={`numeral px-3 py-1.5 text-micro tracking-[0.2em] transition-colors ${
                metric === m ? "bg-accent/15 text-accent" : "text-dim hover:text-ink"
              }`}
            >
              {m === "cumulative" ? "CUMULATIVE STARS" : "GROWTH · STARS/DAY"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className={`numeral flex items-center gap-2 text-micro tracking-[0.15em] ${metric === "growth" ? "text-faint/50" : "cursor-pointer text-accent"}`}>
            <input
              type="checkbox"
              disabled={metric === "growth"}
              checked={zoom}
              onChange={(e) => {
                setZoom(e.target.checked);
                if (e.target.checked) {
                  setAlign(false);
                  setLog(false);
                }
              }}
              className="accent-[var(--accent)]"
            />
            CROSSOVER ZOOM
          </label>
          <label className="numeral flex cursor-pointer items-center gap-2 text-micro tracking-[0.15em] text-dim">
            <input
              type="checkbox"
              checked={align}
              onChange={(e) => {
                setAlign(e.target.checked);
                if (e.target.checked) setZoom(false);
              }}
              className="accent-[var(--accent)]"
            />
            ALIGN AT DAY 0
          </label>
          <label className={`numeral flex items-center gap-2 text-micro tracking-[0.15em] ${metric === "growth" ? "text-faint/50" : "cursor-pointer text-dim"}`}>
            <input
              type="checkbox"
              disabled={metric === "growth"}
              checked={log}
              onChange={(e) => {
                setLog(e.target.checked);
                if (e.target.checked) setZoom(false);
              }}
              className="accent-[var(--accent)]"
            />
            LOG SCALE
          </label>
        </div>
      </div>
      ) : null}

      {/* chart */}
      <div className={embedded ? "min-h-0 flex-1" : "hud px-3 py-4 sm:px-5"}>
        {repos.length === 0 ? (
          <div className="numeral flex h-[440px] flex-col items-center justify-center gap-2 text-center text-dim">
            <span className="font-display text-label tracking-[0.3em] text-dim">THE RACE IS EMPTY</span>
            <span className="text-micro text-faint">add two or more repos to chart their climb side by side</span>
          </div>
        ) : (
          // embedded: fill a stretched grid cell on desktop, but keep a height
          // floor (min-h) so it never collapses to 0 in a single mobile column
          // where no sibling stretches the cell.
          <div className={embedded ? "h-full min-h-[320px] w-full" : "h-[440px] w-full"}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={view.data} margin={{ top: 10, right: 18, bottom: 0, left: 4 }}>
                <CartesianGrid stroke={C.grid} strokeDasharray="2 6" vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={xDomain}
                  scale={align ? "linear" : "time"}
                  tickFormatter={fmtX}
                  tick={{ fill: C.dim, fontSize: 12, fontFamily: "var(--font-jbmono)" }}
                  tickLine={false}
                  axisLine={{ stroke: C.grid }}
                  minTickGap={48}
                  allowDataOverflow
                />
                <YAxis
                  domain={yDomain}
                  allowDataOverflow
                  scale={log && metric === "cumulative" && !zoom ? "log" : "linear"}
                  tickFormatter={(v: number) => (metric === "growth" ? `${fmtCompact(v)}/d` : fmtCompact(v))}
                  tick={{ fill: C.dim, fontSize: 12, fontFamily: "var(--font-jbmono)" }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                />
                <Tooltip
                  cursor={{ stroke: C.grid }}
                  // custom content: dedupe by repo (each repo has a real line
                  // r{i} AND a projection p{i}; the default tooltip listed both,
                  // showing the same repo twice). Prefer the real value.
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(p: any) => {
                    if (!p?.active || !p?.payload?.length) return null;
                    const byRepo = new Map<number, { v: number; proj: boolean }>();
                    for (const it of p.payload as { dataKey?: unknown; value?: number | null }[]) {
                      if (it.value == null) continue;
                      const k = String(it.dataKey);
                      const i = Number(k.slice(1));
                      const proj = k.startsWith("p");
                      const prev = byRepo.get(i);
                      if (!prev || (prev.proj && !proj)) byRepo.set(i, { v: Number(it.value), proj });
                    }
                    if (!byRepo.size) return null;
                    const lx = Number(p.label);
                    const when = align
                      ? `day ${Math.round(lx)}`
                      : xSpanDays <= 9
                        ? `${new Date(lx).toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${pad2(new Date(lx).getHours())}:00`
                        : new Date(lx).toLocaleDateString("en-US", { dateStyle: "medium" });
                    return (
                      <div
                        className="numeral border border-grid px-3 py-2"
                        style={{ background: C.hull, fontFamily: "var(--font-jbmono)", fontSize: 13 }}
                      >
                        <div className="mb-1 text-micro text-dim">{when}</div>
                        {[...byRepo.entries()]
                          .sort((a, b) => b[1].v - a[1].v)
                          .map(([i, d]) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="inline-block h-2 w-2 shrink-0" style={{ background: colors[i] }} />
                              <span className="text-ink">{shortRepo(repos[i])}</span>
                              <span className="text-faint">
                                {/* values are interpolated between points → round,
                                    never show decimals on a star count */}
                                {metric === "growth" ? `${fmt(Math.round(d.v))}/day` : `${fmt(Math.round(d.v))} ★`}
                                {d.proj ? " · proj" : ""}
                              </span>
                            </div>
                          ))}
                      </div>
                    );
                  }}
                />
                {repos.map((repo, i) => (
                  <Line
                    key={repo}
                    dataKey={`r${i}`}
                    name={shortRepo(repo)}
                    stroke={colors[i]}
                    strokeWidth={2}
                    dot={false}
                    type="monotone"
                    connectNulls={false}
                    isAnimationActive={drawing}
                    animationDuration={1000}
                  />
                ))}
                {/* forecast projection at current velocity (dashed) */}
                {useZoom
                  ? view.projRepos.map((i) => (
                      <Line
                        key={`p${i}`}
                        dataKey={`p${i}`}
                        stroke={colors[i]}
                        strokeWidth={2}
                        strokeDasharray="3 6"
                        strokeOpacity={0.85}
                        dot={false}
                        type="linear"
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    ))
                  : null}
                {view.refDots.map((d) => (
                  <ReferenceDot
                    key={d.i}
                    x={d.x}
                    y={d.y}
                    r={4}
                    fill={colors[d.i]}
                    stroke={C.void}
                    strokeWidth={1.5}
                  />
                ))}
                {useZoom
                  ? view.crossovers.map((e, idx) => (
                      <ReferenceDot
                        key={`x${idx}`}
                        x={e.t}
                        y={e.val}
                        r={idx === 0 ? 6 : 4.5}
                        fill={colors[e.winner] ?? "#ffffff"}
                        stroke={C.void}
                        strokeWidth={2}
                        label={
                          idx === 0
                            ? {
                                value: focusLabel,
                                position: "top",
                                fill: "#f5fbff",
                                fontSize: 12,
                                fontFamily: "var(--font-jbmono)",
                              }
                            : undefined
                        }
                      />
                    ))
                  : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* embedded readout: solo = where the data is exact; race = the verdict */}
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
          <span className="numeral text-micro text-faint">
            {raceOn ? (
              view.crossovers.length ? (
                <>
                  <span className="text-ink">{shortRepo(repos[view.crossovers[0].winner])}</span>{" "}
                  <span className="text-dim">{view.crossovers[0].future ? "passes" : "passed"}</span>{" "}
                  <span className="text-ink">{shortRepo(repos[view.crossovers[0].loser])}</span>{" "}
                  <span className={view.crossovers[0].future ? "text-accent" : "text-faint"}>
                    {view.crossovers[0].future ? "~ " : ""}
                    {new Date(view.crossovers[0].t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    {view.crossovers[0].future ? " est." : ""}
                  </span>
                  {view.crossovers.length > 1 ? (
                    <span className="text-faint"> · +{view.crossovers.length - 1} more</span>
                  ) : null}
                </>
              ) : (
                "no crossover in range — rivals holding station"
              )
            ) : (
              seamNote
            )}
          </span>
          {raceOn ? (
            <Link
              href={`/compare?repos=${encodeURIComponent(repos.join(","))}`}
              className="numeral inline-flex shrink-0 items-center gap-1.5 border border-accent/60 bg-accent/10 px-3.5 py-1.5 text-label tracking-[0.16em] text-accent transition-colors hover:bg-accent/20"
            >
              OPEN THE FULL RACE ▸
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* legend + insight */}
      {!embedded && repos.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="hud px-4 py-3 lg:col-span-2">
            <div className="module-title !text-micro mb-2">Contenders</div>
            <div className="flex flex-col gap-2">
              {repos.map((repo, i) => {
                const st = stats[repo.toLowerCase()];
                const c = curves[repo.toLowerCase()];
                const total = c?.total ?? st?.stars ?? null;
                return (
                  <div key={repo} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="h-3 w-3 shrink-0" style={{ background: colors[i] }} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ghAvatarForRepo(repo, 40)} alt="" width={18} height={18} className="shrink-0 border border-grid" />
                    <Link href={`/r/${repo}`} className="numeral text-label text-ink transition-colors hover:text-accent">
                      {repo}
                    </Link>
                    <span className="numeral text-micro text-faint">
                      {total !== null ? `${fmt(total)} ★` : "—"}
                      {st ? ` · #${fmt(st.rank)}` : ""}
                      {st?.velocityPerDay != null ? ` · ${fmt(Math.round(st.velocityPerDay))}/d` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="hud px-4 py-3">
            <div className="module-title !text-micro mb-2">Race readout</div>
            {insight ? (
              <div className="flex flex-col gap-2 text-label">
                <p className="text-dim">
                  Biggest: <span className="text-ink">{shortRepo(insight.biggest)}</span>
                </p>
                <p className="text-dim">
                  Fastest now: <span className="text-accent">{shortRepo(insight.fastest)}</span>
                  <span className="numeral text-micro text-faint"> · {fmt(insight.fastestRate)}/day</span>
                </p>
                {view.crossovers.length ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-dim">
                      Crossovers{" "}
                      <span className="numeral text-micro text-faint">· in order · ~ projected estimate</span>
                    </span>
                    {/* chronological (a timeline): what already happened first,
                        the projected estimates last */}
                    {[...view.crossovers]
                      .sort((a, b) => a.t - b.t)
                      .map((e, idx) => (
                        <p key={idx} className="flex flex-wrap items-center gap-x-1.5 text-label">
                          <span className="inline-block h-2 w-2 shrink-0" style={{ background: colors[e.winner] }} />
                          <span className="text-ink">{shortRepo(repos[e.winner])}</span>
                          <span className="text-dim">{e.future ? "passes" : "passed"}</span>
                          <span className="text-ink">{shortRepo(repos[e.loser])}</span>
                          <span className={`numeral text-micro ${e.future ? "text-accent" : "text-faint"}`}>
                            {e.future ? "~ " : ""}
                            {new Date(e.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                          </span>
                          {e.future ? (
                            <span className="numeral text-micro text-accent/70">est.</span>
                          ) : null}
                        </p>
                      ))}
                  </div>
                ) : insight.cross ? (
                  <p className="text-dim">
                    Last overtake: <span className="text-ink">{shortRepo(insight.cross.a)}</span> passed{" "}
                    <span className="text-ink">{shortRepo(insight.cross.b)}</span>
                    <span className="numeral text-micro text-faint">
                      {" "}
                      · {new Date(insight.cross.t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                    </span>
                  </p>
                ) : (
                  <p className="numeral text-micro text-faint">no overtakes in the overlapping window yet</p>
                )}
              </div>
            ) : (
              <p className="numeral text-micro text-faint">{view.anyLoading ? "reconstructing trajectories…" : "add repos to see the readout"}</p>
            )}
          </div>
        </div>
      ) : null}

      {/* actions */}
      {!embedded && repos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={copyLink} className={btn}>{copied ? "✓ COPIED" : "COPY LINK"}</button>
          <button onClick={share} className={btn}>SHARE</button>
          <a href={ogUrl} target="_blank" rel="noopener noreferrer" className={btn}>SHARE CARD ↗</a>
          <button onClick={downloadCsv} className={btn}>CSV</button>
          <span className="numeral ml-auto text-micro text-faint">
            real stargazer timestamps · reconstructed & cached · {repos.length}/{MAX}
          </span>
        </div>
      ) : null}
    </div>
  );
}
