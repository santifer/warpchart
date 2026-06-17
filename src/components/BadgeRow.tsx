// Presentational classification row: renders sigils (+ optional labels) from
// already-computed RepoBadges data. No fs / no hooks, so it works in BOTH server
// components (the /r/ dossier) and client components (the console StatusBar, the
// star-field scan cards) — the data is computed once server-side (lib/badges)
// and threaded down (e.g. through the bundle). `import type` keeps the server-only
// badges module out of the client bundle.
import BadgeSigil from "./BadgeSigil";
import type { RepoBadges } from "@/lib/badges";

export default function BadgeRow({
  badges,
  size = "md",
  compact = false,
  className = "",
}: {
  badges: RepoBadges;
  size?: "sm" | "md" | "lg";
  compact?: boolean;
  className?: string;
}) {
  const all = [...(badges.klass ? [badges.klass] : []), ...badges.designations];
  if (!all.length) return null;
  const px = size === "sm" ? 16 : size === "lg" ? 30 : 22;
  return (
    <div className={`flex flex-wrap items-center ${compact ? "gap-1" : "gap-x-3 gap-y-1.5"} ${className}`}>
      {all.map((b) => (
        <span
          key={b.key}
          title={`${b.label} — ${b.detail}`}
          className="inline-flex cursor-help items-center gap-1.5"
        >
          <BadgeSigil badgeKey={b.key} size={px} />
          {compact ? null : (
            <span
              className={`numeral text-micro tracking-[0.16em] ${b.kind === "class" ? "text-accent" : "text-dim"}`}
            >
              {b.label}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
