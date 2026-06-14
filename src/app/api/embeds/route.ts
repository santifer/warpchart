// Embed adoption dashboard (owner-only). Lists every repo whose README has
// rendered the Warpchart embed (recorded by embed-track on the first camo
// render), so you can MEASURE adoption, not just get the first-time alert.
// Gated by the VAULT_KEY master secret. ?forget=owner/name removes an entry
// (e.g. a test sighting). No-store; never cached.
import { NextRequest, NextResponse } from "next/server";
import { get, put } from "@vercel/blob";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private" };
const KEY = "embeds/seen.json";

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

type SeenMap = Record<string, { at: string; surface: string }>;

export async function GET(req: NextRequest) {
  const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
  const master = process.env.VAULT_KEY ?? "";
  if (!master || !safeEqual(key, master)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "no blob store" }, { status: 500, headers: NO_STORE });
  }

  let seen: SeenMap = {};
  try {
    const res = await get(KEY, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) {
      seen = JSON.parse(await new Response(res.stream).text()) as SeenMap;
    }
  } catch {
    /* none yet */
  }

  const forget = (req.nextUrl.searchParams.get("forget") ?? "").trim().toLowerCase();
  if (forget && seen[forget]) {
    delete seen[forget];
    try {
      await put(KEY, JSON.stringify(seen), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        token,
      });
    } catch {
      /* best effort */
    }
  }

  const repos = Object.entries(seen)
    .map(([repo, v]) => ({ repo, at: v.at, surface: v.surface }))
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  return NextResponse.json({ count: repos.length, repos }, { headers: NO_STORE });
}
