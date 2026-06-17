// Server wrapper: computes a repo's classifications (cache-only) and hands them
// to the presentational BadgeRow. Used in server contexts (the /r/ dossier).
// Client surfaces fed by the bundle render <BadgeRow> directly.
import { repoBadges } from "@/lib/badges";
import BadgeRow from "./BadgeRow";

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
  return <BadgeRow badges={repoBadges(repo)} size={size} compact={compact} className={className} />;
}
