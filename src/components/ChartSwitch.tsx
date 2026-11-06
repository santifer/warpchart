"use client";

// Mounts ONE of the two star charts: the horizontal galaxy (landscape or lg+)
// or the vertical ascent (portrait below lg). Both used to stay mounted, CSS
// hiding the wrong one, and the hidden one kept running: on a phone the
// invisible GalacticChart still ticked its 4 s drift clock, polled
// /api/live/locals and animated; on a desktop the invisible VerticalChart
// still fetched.
//
// The server cannot know the viewport, so the server render (and the hydration
// pass) still emits both behind the same responsive classes as before: no
// layout shift, no hydration mismatch. Right after hydration the hidden one
// unmounts, and a rotation or resize swaps them.
import { useSyncExternalStore, type ReactNode } from "react";

// Tailwind's `landscape:` and `lg:` (64rem) variants, as one query
const WIDE = "(orientation: landscape), (min-width: 64rem)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
const isWideNow = (): boolean | null => window.matchMedia(WIDE).matches;
const unknownOnServer = (): boolean | null => null;

export default function ChartSwitch({ wide, narrow }: { wide: ReactNode; narrow: ReactNode }) {
  const isWide = useSyncExternalStore(subscribe, isWideNow, unknownOnServer);
  return (
    <>
      {isWide !== false ? (
        <div className={isWide === null ? "hidden landscape:block lg:block" : undefined}>{wide}</div>
      ) : null}
      {isWide !== true ? (
        <div className={isWide === null ? "landscape:hidden lg:hidden" : undefined}>{narrow}</div>
      ) : null}
    </>
  );
}
