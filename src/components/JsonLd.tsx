// Server-rendered JSON-LD. Build the object server-side and stringify it (never
// hand-concatenate) so the markup is always valid. Safe in the RSC tree — no
// client JS, no next/script needed.
export default function JsonLd({ data }: { data: object | object[] }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify already escapes quotes; guard the one sequence that can
      // break out of a <script> context.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export const ORG_ID = "https://warpchart.dev/#org";

// Organization + WebSite, the stable entity anchor every other page references
// via ORG_ID. Rendered once sitewide (the layout).
export const siteGraph = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "Warpchart",
      url: "https://warpchart.dev",
      logo: "https://warpchart.dev/icon.svg",
      description:
        "Warpchart is a developer tool that ranks every public GitHub repository by worldwide star rank and growth velocity, live and free.",
      sameAs: ["https://github.com/santifer/warpchart"],
    },
    {
      "@type": "WebSite",
      "@id": "https://warpchart.dev/#website",
      url: "https://warpchart.dev",
      name: "Warpchart",
      publisher: { "@id": ORG_ID },
    },
  ],
};

// Per-repo telemetry page = a Dataset (we publish data ABOUT the repo, not the
// code) + a breadcrumb. The highest-value, long-tail, LLM-citable surface.
export function repoGraph(repo: string, opts?: { stars?: number; rank?: number | null }) {
  const url = `https://warpchart.dev/r/${repo}`;
  const rankBit = opts?.rank ? ` — ranked #${opts.rank} worldwide` : "";
  const starBit =
    opts?.stars != null ? ` with ${opts.stars.toLocaleString("en-US")} stars` : "";
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Dataset",
        "@id": `${url}#dataset`,
        name: `${repo} — worldwide GitHub star rank & velocity`,
        description: `Worldwide GitHub star rank, growth velocity and the repos closing in on ${repo}${rankBit}${starBit}. Live and updated continuously.`,
        url,
        creator: { "@id": ORG_ID },
        isAccessibleForFree: true,
        keywords: [
          "github stars",
          "repository worldwide rank",
          "star velocity",
          "open source growth",
          "github trending",
        ],
        variableMeasured: ["worldwide star rank", "total stars", "stars per day"],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Warpchart", item: "https://warpchart.dev" },
          { "@type": "ListItem", position: 2, name: "Codex", item: "https://warpchart.dev/codex" },
          { "@type": "ListItem", position: 3, name: repo, item: url },
        ],
      },
    ],
  };
}

// The product as a SoftwareApplication with its public price tiers. Prices are
// the canonical public plans (mirror src/app/pricing GENERIC_PLANS).
const monthly = (price: string) => ({
  "@type": "Offer",
  name: undefined as unknown as string, // set per-offer below
  price,
  priceCurrency: "USD",
  url: "https://warpchart.dev/pricing",
  priceSpecification: {
    "@type": "UnitPriceSpecification",
    price,
    priceCurrency: "USD",
    unitText: "MONTH",
  },
});
export const pricingGraph = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  "@id": "https://warpchart.dev/#app",
  name: "Warpchart",
  url: "https://warpchart.dev",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  publisher: { "@id": ORG_ID },
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", url: "https://warpchart.dev/pricing" },
    { ...monthly("29"), name: "Pro" },
    { ...monthly("149"), name: "Team" },
    { ...monthly("399"), name: "Business" },
  ],
};

// The Codex as a curated CollectionPage / ItemList of charted repos.
export function codexGraph(items: { repo: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": "https://warpchart.dev/codex#page",
    name: "The Warpchart Codex",
    url: "https://warpchart.dev/codex",
    isPartOf: { "@id": "https://warpchart.dev/#website" },
    description:
      "A growing atlas of GitHub repositories, each charted by worldwide star rank and growth velocity.",
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: items.length,
      itemListElement: items.slice(0, 200).map((e, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: e.repo,
        url: `https://warpchart.dev/r/${e.repo}`,
      })),
    },
  };
}
