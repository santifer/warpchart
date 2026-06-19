// Presentational classification row: sigils (+ optional labels) from already-
// computed RepoBadges data. No fs / no hooks, so it works in BOTH server
// components (the /r/ dossier) and client components (the console StatusBar, the
// star field). A CSS-only hover tooltip (reliable, no JS, no layout shift) shows
// what the classification means AND the exact data that earned it. `import type`
// keeps the server-only badges module out of the client bundle.
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
    <div className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-x-3 gap-y-1.5"} ${className}`}>
      {all.map((b) => (
        <span
          key={b.key}
          className={`group relative inline-flex cursor-help items-center gap-1.5 ${b.active === false ? "opacity-40" : ""}`}
        >
          <BadgeSigil badgeKey={b.key} size={px} />
          {compact ? null : (
            <span
              className={`numeral text-micro tracking-[0.16em] ${b.kind === "class" ? "text-accent" : "text-dim"}`}
            >
              {b.label}
            </span>
          )}
          <span
            className="pointer-events-none invisible absolute left-0 top-full z-50 mt-2 flex w-max max-w-[300px] flex-col gap-1 border border-grid p-3 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
            style={{ background: "var(--void)" }}
          >
            <span
              className={`numeral text-label tracking-[0.18em] ${b.kind === "class" ? "text-accent" : "text-ink"}`}
            >
              {b.glyph} {b.label}
            </span>
            <span className="text-data font-light leading-snug text-dim">{b.blurb}</span>
            <span className="numeral text-micro leading-snug text-faint">{b.detail}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
