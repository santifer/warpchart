// RPG rarity colours for the rank zones, one set per theme: saturated enough
// to name the zone at a glance, faint enough (fill opacity) that the marks on
// top keep the contrast. Common gets no fill: the default zone. Shared by the
// daily velocity rank (GodVelocityRank) and the daily ladder's zones, so a
// colour means the same tier on both panels.
import type { TierKey } from "./velocity-rank-view";

export const TIER_COLOR: Record<"dark" | "light", Record<TierKey, string>> = {
  dark: { legendary: "#ff8c1a", epic: "#b06cff", rare: "#4c8dff", uncommon: "#34c26b", common: "#8a94a6" },
  light: { legendary: "#e07000", epic: "#9333ea", rare: "#2563eb", uncommon: "#15924a", common: "#6b7280" },
};
export const TIER_FILL: Record<"dark" | "light", number> = { dark: 0.11, light: 0.09 };

// orange over navy reads brown at the shared opacity: legendary gets a little more
export const tierFillOpacity = (key: TierKey, theme: "dark" | "light", scale = 1) =>
  TIER_FILL[theme] * (key === "legendary" && theme === "dark" ? 1.7 : 1) * scale;
