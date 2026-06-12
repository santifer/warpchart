// Dynamic Polar checkout: /api/checkout?repo=owner/name&plan=hosted|fleet
// Creates a checkout session with the repo PREFILLED in the required
// github-repo custom field (so a buyer landing from a /r/ page never has
// to retype what they were just looking at) and tagged in metadata for
// the webhook's automatic provisioning. Falls back to the static checkout
// links when the API token is absent (self-hosters without payments).
import { NextRequest, NextResponse } from "next/server";

const PRODUCTS: Record<string, string> = {
  hosted: "c5042243-2e00-4c49-9681-85f4e4911c52",
  fleet: "db196832-bbef-4e8b-b254-fe9c4686f50e",
};

const STATIC_LINKS: Record<string, string> = {
  hosted: "https://buy.polar.sh/polar_cl_8CDF8qOQrPcZbpqOc8RPnCH9QF18kiKrIPUyh3cPbnU",
  fleet: "https://buy.polar.sh/polar_cl_6CaoF5JYYrFq3Jnwypr8BNqLhDKJfr7vz53Ti2Te5Si",
};

export async function GET(req: NextRequest) {
  const plan = (req.nextUrl.searchParams.get("plan") ?? "hosted").toLowerCase();
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  const product = PRODUCTS[plan];
  const fallback = STATIC_LINKS[plan] ?? STATIC_LINKS.hosted;
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!product || !token) return NextResponse.redirect(fallback, 302);

  const validRepo = /^[\w.-]+\/[\w.-]+$/.test(repo) ? repo : null;
  try {
    const res = await fetch("https://api.polar.sh/v1/checkouts/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        products: [product],
        ...(validRepo
          ? {
              custom_field_data: { "github-repo": validRepo },
              metadata: { repo: validRepo, plan },
              success_url: `https://warpchart.dev/r/${validRepo}?welcome=1`,
            }
          : { metadata: { plan } }),
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`polar checkout ${res.status}`);
    const checkout = (await res.json()) as { url?: string };
    if (!checkout.url) throw new Error("no checkout url");
    return NextResponse.redirect(checkout.url, 302);
  } catch {
    return NextResponse.redirect(fallback, 302);
  }
}
