export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 10_000) return Math.round(n / 1000) + "K";
  if (n >= 1_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export function fmtSigned(n: number): string {
  return (n >= 0 ? "+" : "") + fmt(Math.round(n));
}

// "2.3d" / "16h" / "now" / "8y"
export function fmtEtaDays(days: number | null): string {
  if (days === null) return "n/a";
  if (days <= 0) return "now";
  if (days < 1) return Math.max(1, Math.round(days * 24)) + "h";
  if (days < 10) return days.toFixed(1).replace(/\.0$/, "") + "d";
  // beyond a year, day counts read as noise ("eta 117950d"); years stay honest
  if (days > 365) return (days / 365).toFixed(days < 1825 ? 1 : 0).replace(/\.0$/, "") + "y";
  return Math.round(days) + "d";
}

export function etaDate(days: number | null, from = new Date()): string | null {
  if (days === null || days > 365) return null;
  const d = new Date(from.getTime() + days * 86_400_000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function shortName(fullName: string): string {
  const name = fullName.split("/")[1];
  return name || fullName;
}

export function timeAgo(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
