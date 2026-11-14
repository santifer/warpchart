// Daily sticky-badge union. Vercel cron hits this once a day: it reads every
// badge currently met across the catalog and records each one (with today's
// date) in the private earned-badges store the FIRST time a repo earns it.
// Idempotent — re-running only ever adds genuinely new (repo, badge) pairs, so a
// repo keeps a badge forever even after it stops meeting the gate.
import { allActiveBadges } from "@/lib/badges";
import { recordEarnedBadges } from "@/lib/earned";

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

  // An unreadable ledger is not an empty one: write nothing, retry tomorrow.
  let added: number, repos: number;
  try {
    ({ added, repos } = await recordEarnedBadges(active, new Date().toISOString().slice(0, 10)));
  } catch (e) {
    return Response.json(
      { ok: false, reason: `earned ledger not written: ${e instanceof Error ? e.message : e}` },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { ok: true, added, repos },
    { headers: { "Cache-Control": "no-store" } },
  );
}
