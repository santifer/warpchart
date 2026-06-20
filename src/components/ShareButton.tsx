"use client";

// The trigger the OG card was missing: a /r/ page generates a rich share card
// (rank, velocity, badge) but nothing prompted anyone to share it. Native share
// on mobile, copy-link fallback, and an X intent. Copy is factual and quiet
// (builder-silencioso: no hype, no emoji, no em-dash) so it never reads as a
// growth-hack.
import { useState } from "react";

export default function ShareButton({
  repo,
  stars,
  rank,
  vel,
}: {
  repo: string;
  stars: number;
  rank: number | null;
  vel: number;
}) {
  const [copied, setCopied] = useState(false);
  const url = `https://warpchart.dev/r/${repo}`;
  const starStr = stars.toLocaleString("en-US");
  const vpd = Math.round(vel); // round BEFORE the guard: vel=0.3 must not print "climbing 0 a day"
  const text =
    rank !== null
      ? `${repo} is #${rank.toLocaleString("en-US")} worldwide on GitHub, ${starStr} stars` +
        (vpd > 0 ? `, climbing ${vpd.toLocaleString("en-US")} a day.` : ".")
      : `${repo} on warpchart: ${starStr} stars and its worldwide rank.`;

  const onShare = async () => {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title: `${repo} · Warpchart`, text, url });
        return;
      } catch (e) {
        // dismissing the share sheet throws AbortError — do NOT fall through to
        // copy (it would wrongly flash "LINK COPIED" on a cancel). Only a real
        // share failure falls through.
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    try {
      await nav?.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* no clipboard: the X link below still works */
    }
  };

  const cls =
    "numeral border border-grid px-2.5 py-1 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent";

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={onShare} className={cls}>
        {copied ? "LINK COPIED" : "SHARE ↗"}
      </button>
      <a
        href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        aria-label="Share on X"
      >
        ON X
      </a>
    </div>
  );
}
