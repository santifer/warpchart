import Link from "next/link";
import SoundToggle from "./SoundToggle";
import ThemeToggle from "./ThemeToggle";

// Shared top strip: the brand always routes home (the tweet-landing visitor
// must have an obvious way to scan their own repo), controls on the right.
export default function Masthead({ demo }: { demo?: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link
        prefetch={false}
        href="/"
        className="font-display text-sm tracking-[0.3em] text-star transition-colors hover:text-accent"
      >
        WARPCHART
      </Link>
      <div className="flex flex-wrap items-center gap-x-4">
        <Link
          prefetch={false}
          href="/velocity"
          className="numeral text-micro tracking-[0.2em] text-dim transition-colors hover:text-accent"
        >
          VELOCITY
        </Link>
        <SoundToggle />
        <ThemeToggle />
        {demo ? (
          <Link
            prefetch={false}
            href={`/r/${demo}`}
            className="numeral border border-grid px-3 py-1.5 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            LIVE DEMO MISSION: {demo} →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
