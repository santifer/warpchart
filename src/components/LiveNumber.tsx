"use client";

// A live counter that CANNOT fail to show its number.
//
// This replaces @number-flow/react in the telemetry headers. That library
// renders each digit position as a stacked 0-9 column and slides it into place
// with the Web Animations API. When those animations never start - which is
// what happens here, reproducibly, on a fully loaded and visible page - every
// column keeps `transform: none`, so the element reserves the exact width of
// the number and displays nothing. STARS, WORLD RANK and LAST 60 MIN went
// blank while their labels stayed put. Upgrading 0.6.0 -> 0.6.2 did not change
// it: five elements, transform none, zero animations created.
//
// The rule this encodes: a figure on a telemetry panel must never depend on an
// animation succeeding in order to be legible. The number is plain text in the
// DOM - server-rendered, readable with JavaScript broken, copyable, and
// reachable by a screen reader. The motion is a CSS accent on top, and if the
// accent fails the number is still simply there.
import { useEffect, useRef, useState } from "react";

export default function LiveNumber({
  value,
  locales = "en-US",
  fallback = "n/a",
}: {
  value: number | null | undefined;
  locales?: string;
  fallback?: string;
}) {
  const [bump, setBump] = useState(false);
  const prev = useRef<number | null | undefined>(value);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setBump(true);
    const t = window.setTimeout(() => setBump(false), 420);
    return () => window.clearTimeout(t);
  }, [value]);

  // null/undefined is UNKNOWN, and says so, rather than rendering as an empty
  // gap that reads like a broken widget (or as 0, which reads like a fact).
  if (value == null || !Number.isFinite(value)) {
    return <span className="text-faint">{fallback}</span>;
  }

  return (
    <span
      className={`tabular-nums${bump ? " live-number-bump" : ""}`}
      // announce the change politely; the label beside it carries the meaning
      aria-live="polite"
    >
      {value.toLocaleString(locales)}
    </span>
  );
}
