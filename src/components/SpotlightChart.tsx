"use client";

// Landing spotlight chart: measures its real container width and hands it
// to GalacticChart as the canvas width, so wide monitors get MORE MAP at
// design-size type instead of proportionally giant letters (same principle
// as the command deck's adaptive canvas).
import { useEffect, useRef, useState } from "react";
import GalacticChart from "./GalacticChart";
import type { ComponentProps } from "react";

type ChartInputs = ComponentProps<typeof GalacticChart>["inputs"];

export default function SpotlightChart({ inputs }: { inputs: ChartInputs }) {
  const holeRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number | null>(null);

  useEffect(() => {
    const el = holeRef.current;
    if (!el) return;
    const measure = () => setW(Math.round(el.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={holeRef}>
      {w ? <GalacticChart inputs={inputs} fitW={w} /> : null}
    </div>
  );
}
