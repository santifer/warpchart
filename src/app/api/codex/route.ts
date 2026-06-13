// GET /api/codex?repo=owner/name — return the system's CODEX, charting it on
// first request (README -> Haiku -> private Blob cache), then serving the
// cached dossier to everyone after. Best-effort: a miss returns 204 and the
// UI simply omits the codex panel.
import { NextRequest, NextResponse } from "next/server";
import { getCodex } from "@/lib/codex";

export const maxDuration = 30; // first charting does a GitHub fetch + an LLM call

const VALID = /^[\w.-]+\/[\w.-]+$/;

export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo")?.trim() ?? "";
  if (!VALID.test(repo)) {
    return NextResponse.json({ error: "invalid repo" }, { status: 400 });
  }
  const codex = await getCodex(repo);
  if (!codex) {
    return new NextResponse(null, {
      status: 204,
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  }
  return NextResponse.json(codex, {
    // the dossier is immutable once charted; cache it hard at the edge
    headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
