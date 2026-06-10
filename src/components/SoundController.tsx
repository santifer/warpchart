"use client";

// Connects the live data layer to the audio engine:
//  - each new star detected by polling becomes a sonar ping (jittered over
//    the following ~50s, so the soundscape feels organic)
//  - ambient pad brightness follows current velocity
//  - crossing the next milestone threshold triggers a one-time fanfare
import { useEffect, useRef } from "react";
import { useLive } from "./LiveProvider";
import { sound } from "@/lib/sound";

export default function SoundController({
  nextThreshold,
  nextRank,
}: {
  nextThreshold: number | null;
  nextRank: number | null;
}) {
  const live = useLive();
  const prevCount = useRef<number | null>(null);
  // The first sync after load replays the backlog since the bundle was
  // built: those are PAST stars, not live events, so they stay silent.
  // Only once armed does every new timestamp become a real-time ping.
  const armed = useRef(false);

  useEffect(() => {
    const n = live.merged.length;
    const prev = prevCount.current;
    prevCount.current = n;
    if (prev === null) return;
    if (n > prev) {
      if (!armed.current) {
        armed.current = true; // backlog catch-up absorbed silently
        return;
      }
      const delta = Math.min(n - prev, 40);
      const intensity = Math.min(live.starsLastHour / 120, 1);
      // small deltas are real-time events: ring them close to the moment the
      // counter moves; only genuine bursts get spread out to feel organic
      const spread = delta <= 3 ? 2_000 : 50_000;
      for (let i = 0; i < delta; i++) {
        setTimeout(() => sound.ping(intensity), Math.random() * spread);
      }
    } else if (live.lastSync !== null) {
      armed.current = true; // synced with nothing pending: live from here on
    }
  }, [live.merged.length, live.starsLastHour, live.lastSync]);

  useEffect(() => {
    sound.setAmbientIntensity(Math.min(live.starsLastHour / 150, 1));
  }, [live.starsLastHour]);

  useEffect(() => {
    if (nextThreshold === null || nextRank === null) return;
    if (live.stars < nextThreshold) return;
    const key = `mc_gate_${nextRank}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, new Date().toISOString());
    } catch { /* private mode */ }
    sound.fanfare();
  }, [live.stars, nextThreshold, nextRank]);

  return null;
}
