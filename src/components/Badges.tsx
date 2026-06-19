// Server wrapper: computes a repo's classifications WITH the sticky layer
// (live badges + the ones it earned before and no longer meets) and hands them
// to the presentational BadgeRow. Used in server contexts (the /r/ dossier).
// Client surfaces fed by the bundle render <BadgeRow> directly (live-only).
import { repoBadgesWithHistory } from "@/lib/badges";
import { loadEarnedBadges } from "@/lib/earned";
import BadgeRow from "./BadgeRow";

export default async function Badges({
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
  const earned = await loadEarnedBadges();
  return (
    <BadgeRow
      badges={repoBadgesWithHistory(repo, earned)}
      size={size}
      compact={compact}
      className={className}
    />
  );
}
