// Dynamic Polar checkout: /api/checkout?repo=owner/name&plan=hosted|fleet
// Creates a checkout session with the repo PREFILLED in the required
// github-repo custom field (so a buyer landing from a /r/ page never has
// to retype what they were just looking at) and tagged in metadata for
// the webhook's automatic provisioning. Falls back to the static checkout
// links when the API token is absent (self-hosters without payments).
import { NextRequest, NextResponse } from "next/server";

// Plan aliases map to the SAME Polar product IDs, so re-pricing a product in the
// Polar dashboard (Hosted $19 -> Pro $29, Fleet $79 -> Team $149) changes what
// the checkout charges with NO code change. `pro` == hosted product, `team` ==
// fleet product. Business is concierge (a mailto on the pricing page), no
// self-serve product yet.
const PRODUCTS: Record<string, string> = {
  hosted: "c5042243-2e00-4c49-9681-85f4e4911c52",
  pro: "c5042243-2e00-4c49-9681-85f4e4911c52",
  fleet: "db196832-bbef-4e8b-b254-fe9c4686f50e",
  team: "db196832-bbef-4e8b-b254-fe9c4686f50e",
};

const STATIC_LINKS: Record<string, string> = {
  hosted: "https://buy.polar.sh/polar_cl_8CDF8qOQrPcZbpqOc8RPnCH9QF18kiKrIPUyh3cPbnU",
  pro: "https://buy.polar.sh/polar_cl_8CDF8qOQrPcZbpqOc8RPnCH9QF18kiKrIPUyh3cPbnU",
  fleet: "https://buy.polar.sh/polar_cl_6CaoF5JYYrFq3Jnwypr8BNqLhDKJfr7vz53Ti2Te5Si",
  team: "https://buy.polar.sh/polar_cl_6CaoF5JYYrFq3Jnwypr8BNqLhDKJfr7vz53Ti2Te5Si",
};

// Annual plans map to env-configured Polar product IDs (Santiago creates the
// annual products in the Polar dashboard; until then an annual link falls back to
// its monthly product so it never 404s). Annual = the single easiest ACV lever
// and the only recurring-discount tier; e.g. ?plan=pro-annual / team-annual.
const ANNUAL_ENV: Record<string, string | undefined> = {
  "pro-annual": process.env.POLAR_PRODUCT_PRO_ANNUAL,
  "team-annual": process.env.POLAR_PRODUCT_TEAM_ANNUAL,
};

export async function GET(req: NextRequest) {
  const plan = (req.nextUrl.searchParams.get("plan") ?? "hosted").toLowerCase();
  const repo = (req.nextUrl.searchParams.get("repo") ?? "").trim();
  const monthly = plan.replace(/-annual$/, "");
  const product = PRODUCTS[plan] ?? ANNUAL_ENV[plan] ?? PRODUCTS[monthly];
  const fallback = STATIC_LINKS[plan] ?? STATIC_LINKS[monthly] ?? STATIC_LINKS.hosted;
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
