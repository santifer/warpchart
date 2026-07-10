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

// "16h" / "2.3d" / "42d" / "4mo" / "1y 8mo" / "8y"
// Mixed units read at a glance: nobody converts "1.75y" in their head, and
// "117950d" is noise. Months take over past 60 days, years past one year
// (with the leftover months until ~5y, where they stop mattering).
export function fmtEtaDays(days: number | null): string {
  if (days === null) return "n/a";
  if (days <= 0) return "now";
  if (days < 1) return Math.max(1, Math.round(days * 24)) + "h";
  // whole days only: a projected ETA is not precise to the tenth, and a
  // decimal reads as false precision the velocity data does not support
  if (days < 60) return Math.max(1, Math.round(days)) + "d";
  if (days < 365) {
    const mo = Math.round(days / 30.44);
    return mo >= 12 ? "1y" : mo + "mo";
  }
  const years = Math.floor(days / 365.25);
  const months = Math.round((days - years * 365.25) / 30.44);
  if (years >= 5 || months === 0) return Math.round(days / 365.25) + "y";
  if (months === 12) return years + 1 + "y";
  return `${years}y ${months}mo`;
}

// Format ETA with confidence band: "12d" (firm) or "~10-18d" (soft/noisy).
// The ~ prefix signals "honesty layer" — uncertainty, not false precision.
export function fmtEtaRange(
  etaDays: number | null,
  etaRange?: { min: number; max: number } | null
): string {
  if (!etaRange) return fmtEtaDays(etaDays);
  // Format range as "~Xd-Yd" when min and max are both in days
  if (etaRange.min < 1 && etaRange.max < 1) return "~" + Math.max(1, Math.round(etaRange.min * 24)) + "-" + Math.round(etaRange.max * 24) + "h";
  if (etaRange.min < 60 && etaRange.max < 60) {
    return "~" + Math.max(1, Math.round(etaRange.min)) + "-" + Math.round(etaRange.max) + "d";
  }
  // If range spans units (e.g., 55d-2mo), use point estimate with ~ prefix
  return "~" + fmtEtaDays(etaDays);
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
