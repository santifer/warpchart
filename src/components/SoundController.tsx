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

  useEffect(() => {
    const n = live.merged.length;
    if (prevCount.current !== null && n > prevCount.current) {
      const delta = Math.min(n - prevCount.current, 40);
      const intensity = Math.min(live.starsLastHour / 120, 1);
      for (let i = 0; i < delta; i++) {
        setTimeout(() => sound.ping(intensity), Math.random() * 50_000);
      }
    }
    prevCount.current = n;
  }, [live.merged.length, live.starsLastHour]);

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
