"use client";

// "Add to constellation" toggle on a repo's /r/ page. Writes the no-login
// localStorage watchlist (src/lib/watchlist). Renders on the server and the
// first client paint as the neutral (unpinned) state, then reconciles to the
// stored state in an effect, so there is no hydration mismatch.
import { useEffect, useState } from "react";
import { isWatched, toggleWatch } from "@/lib/watchlist";

export default function PinButton({ repo }: { repo: string }) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(isWatched(repo));
  }, [repo]);

  return (
    <button
      type="button"
      onClick={() => {
        const next = toggleWatch(repo);
        setOn(next.some((w) => w.repo.toLowerCase() === repo.toLowerCase()));
      }}
      aria-pressed={on}
      className={`numeral inline-flex items-center gap-1.5 border px-3 py-1.5 text-label tracking-[0.16em] transition-colors ${
        on
          ? "border-accent/60 bg-accent/10 text-accent"
          : "border-grid text-dim hover:border-accent/40 hover:text-accent"
      }`}
    >
      <span aria-hidden>{on ? "✦" : "✧"}</span>
      {on ? "IN YOUR CONSTELLATION" : "ADD TO CONSTELLATION"}
    </button>
  );
}
