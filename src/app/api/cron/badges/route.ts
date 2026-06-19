// Daily sticky-badge union. Vercel cron hits this once a day: it reads every
// badge currently met across the catalog and records each one (with today's
// date) in the private earned-badges store the FIRST time a repo earns it.
// Idempotent — re-running only ever adds genuinely new (repo, badge) pairs, so a
// repo keeps a badge forever even after it stops meeting the gate.
import { allActiveBadges } from "@/lib/badges";
import { readEarnedBadgesFresh, saveEarnedBadges } from "@/lib/earned";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  // This writes a PERMANENT ledger, so the secret is REQUIRED: a missing or
  // empty CRON_SECRET must not leave the endpoint open. Vercel cron sends
  // `Authorization: Bearer ${CRON_SECRET}`; manual runs can pass ?key=.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("cron not configured", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const auth = req.headers.get("authorization");
  const key = new URL(req.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const active = allActiveBadges();
  if (!active.length) {
    return Response.json(
      { ok: false, reason: "catalog unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const earned = await readEarnedBadgesFresh();
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  for (const { r, key } of active) {
    const lk = r.toLowerCase();
    if (!earned[lk]) earned[lk] = {};
    if (!earned[lk][key]) {
      earned[lk][key] = today;
      added++;
    }
  }
  if (added) await saveEarnedBadges(earned);

  return Response.json(
    { ok: true, added, repos: Object.keys(earned).length },
    { headers: { "Cache-Control": "no-store" } },
  );
}
