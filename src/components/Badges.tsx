// Repo classifications, rendered as circular sigils (BadgeSigil) + label. A CLASS
// (accent) plus additive DESIGNATIONS. Server component, cache-only. Hover shows
// the exact data that earned each one. `compact` shows sigils only (for dense
// places like the star field / lists, where the label would crowd the name).
import { repoBadges } from "@/lib/badges";
import BadgeSigil from "./BadgeSigil";

export default function Badges({
  repo,
  size = "md",
  compact = false,
  className = "",
}: {
  repo: string;
  size?: "sm" | "md" | "lg";
  compact?: boolean;
  className?: string;
}) {
  const { klass, designations } = repoBadges(repo);
  const all = [...(klass ? [klass] : []), ...designations];
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
