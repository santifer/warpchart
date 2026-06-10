"use client";

// Client-side live layer: polls the cached API routes and derives the
// sliding-window metrics that the static bundle cannot know (stars in the
// last 60 minutes, today vs yesterday at the same hour, fresh neighbors).
import {
  createContext, useContext, useEffect, useMemo, useRef, useState,
} from "react";
import type { DashboardBundle } from "@/lib/bundle";
import type { Neighbor } from "@/lib/types";

const HOUR = 3600_000;
const DAY = 86_400_000;

export interface LiveState {
  stars: number;
  rank: number | null;
  starsLastHour: number;
  todayCount: number;
  yesterdaySameHour: number;
  deltaPct: number | null;
  merged: string[]; // recent star timestamps (bundle 48h + live), ascending
  neighbors: Neighbor[];
  neighborsFresh: boolean;
  stale: boolean; // live velocity could not reach the bundled boundary
  offline: boolean; // live fetches failing, showing bundled data
  lastSync: string | null;
  nowMs: number;
}

const LiveContext = createContext<LiveState | null>(null);

export function useLive(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error("useLive outside LiveProvider");
  return ctx;
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default function LiveProvider({
  bundle,
  children,
}: {
  bundle: DashboardBundle;
  children: React.ReactNode;
}) {
  const [stars, setStars] = useState(bundle.netStars);
  const [rank, setRank] = useState<number | null>(bundle.rank);
  const [newTs, setNewTs] = useState<string[]>([]);
  const [neighbors, setNeighbors] = useState<Neighbor[]>(bundle.neighbors);
  const [neighborsFresh, setNeighborsFresh] = useState(false);
  const [stale, setStale] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  // Start from the bundle's build time so the server-rendered HTML and the
  // first client render agree (no hydration mismatch); jump to real time
  // right after mount.
  const [nowMs, setNowMs] = useState(() => Date.parse(bundle.generatedAt));
  const failures = useRef(0);

  useEffect(() => {
    setNowMs(Date.now());
  }, []);

  useEffect(() => {
    let stop = false;

    async function pollFast() {
      const [summary, velocity] = await Promise.all([
        getJson<{ stars: number; rank: number; fetchedAt: string }>("/api/live/summary"),
        getJson<{ newTimestamps: string[]; partial: boolean }>("/api/live/velocity"),
      ]);
      if (stop) return;
      if (summary) {
        setStars(summary.stars);
        setRank(summary.rank);
        setLastSync(summary.fetchedAt);
      }
      if (velocity) {
        setNewTs(velocity.newTimestamps);
        setStale(velocity.partial);
      }
      failures.current = summary && velocity ? 0 : failures.current + 1;
      setOffline(failures.current >= 3);
    }

    async function pollNeighbors() {
      const res = await getJson<{ neighbors: Neighbor[] }>("/api/live/neighbors");
      if (stop || !res) return;
      if (res.neighbors.length) {
        setNeighbors(res.neighbors);
        setNeighborsFresh(true);
      }
    }

    pollFast();
    pollNeighbors();
    const fast = setInterval(pollFast, 60_000);
    const slow = setInterval(pollNeighbors, 300_000);
    const tick = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => {
      stop = true;
      clearInterval(fast);
      clearInterval(slow);
      clearInterval(tick);
    };
  }, []);

  const value = useMemo<LiveState>(() => {
    // newTs are all strictly newer than the bundle boundary: plain concat.
    const merged = bundle.recent48h.concat(newTs);

    let starsLastHour = 0;
    let todayCount = 0;
    let yesterdaySameHour = 0;

    const now = new Date(nowMs);
    const todayKey = now.toISOString().slice(0, 10);
    const yesterdayKey = new Date(nowMs - DAY).toISOString().slice(0, 10);
    const timeOfDay = now.toISOString().slice(11, 19);
    const hourCutoffMs = nowMs - HOUR;

    for (let i = merged.length - 1; i >= 0; i--) {
      const iso = merged[i];
      if (Date.parse(iso) >= hourCutoffMs) starsLastHour++;
      const day = iso.slice(0, 10);
      if (day === todayKey) todayCount++;
      else if (day === yesterdayKey && iso.slice(11, 19) <= timeOfDay) yesterdaySameHour++;
      else if (day < yesterdayKey) break;
    }

    const deltaPct =
      yesterdaySameHour > 0
        ? Math.round(((todayCount - yesterdaySameHour) / yesterdaySameHour) * 100)
        : null;

    return {
      stars,
      rank,
      starsLastHour,
      todayCount,
      yesterdaySameHour,
      deltaPct,
      merged,
      neighbors,
      neighborsFresh,
      stale,
      offline,
      lastSync,
      nowMs,
    };
  }, [bundle.recent48h, newTs, stars, rank, neighbors, neighborsFresh, stale, offline, lastSync, nowMs]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
