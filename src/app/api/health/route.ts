// Heartbeat for external monitors (UptimeRobot etc.): 200 while the
// collector keeps the tenant snapshot fresh, 503 when it has gone quiet
// for over 3 hours (the hourly Action failing) so a free uptime monitor
// can page the operator. Also reports the token pool's fuel state.
import { lastSnapshot } from "@/lib/history";
import { lowFuel } from "@/lib/github";

export const dynamic = "force-dynamic";

const STALE_MS = 3 * 3600 * 1000;

export async function GET() {
  const snap = lastSnapshot();
  const ageMs = snap ? Date.now() - Date.parse(snap.ts) : null;
  const collectorOk = ageMs !== null && ageMs < STALE_MS;
  const body = {
    ok: collectorOk,
    collector: {
      lastSnapshot: snap?.ts ?? null,
      ageMinutes: ageMs !== null ? Math.round(ageMs / 60_000) : null,
    },
    fuel: lowFuel() ? "low" : "ok",
  };
  return Response.json(body, {
    status: collectorOk ? 200 : 503,
    headers: { "Cache-Control": "public, s-maxage=60" },
  });
}
