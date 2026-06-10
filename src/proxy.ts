// Host-aware entry: on the PRODUCT domain (env LANDING_HOST) the root is
// the explore landing. Self-hosted instances (no LANDING_HOST) keep / as
// their dashboard. The tracked repo's full console lives at /r/owner/name
// like every other repo; /hq is a legacy redirect handled by its route.
import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: ["/"] };

export function proxy(req: NextRequest) {
  const landingHost = (process.env.LANDING_HOST ?? "").toLowerCase();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isProduct = landingHost !== "" && host.split(":")[0] === landingHost;
  return isProduct ? NextResponse.rewrite(new URL("/explore", req.url)) : NextResponse.next();
}
