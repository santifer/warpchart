// Host-aware entry: on the PRODUCT domain (env LANDING_HOST) the root is
// the explore landing and the tenant dashboard lives at /hq. Self-hosted
// instances (no LANDING_HOST) keep / as their dashboard, and /hq simply
// redirects home so snippets work everywhere.
import { NextRequest, NextResponse } from "next/server";

export const config = { matcher: ["/", "/hq"] };

export function proxy(req: NextRequest) {
  const landingHost = (process.env.LANDING_HOST ?? "").toLowerCase();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const isProduct = landingHost !== "" && host.split(":")[0] === landingHost;
  const { pathname } = req.nextUrl;

  if (pathname === "/") {
    return isProduct ? NextResponse.rewrite(new URL("/explore", req.url)) : NextResponse.next();
  }
  // pathname === "/hq"
  return isProduct
    ? NextResponse.rewrite(new URL("/", req.url))
    : NextResponse.redirect(new URL("/", req.url), 308);
}
