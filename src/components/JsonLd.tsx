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

// Santiago's canonical entity. SAME @id that santifer.io and career-ops use, so
// engines and LLMs resolve ONE consolidated person across all his domains — the
// E-E-A-T cluster (santifer.io <-> career-ops <-> warpchart). This is a MIRROR of
// the canonical node in cv-santiago's src/articles/json-ld.ts; if that sameAs
// list changes, update it here too. The authority identifiers (Wikidata
// Q138710224, ORCID, Crunchbase, Stack Overflow) are what actually resolve and
// validate the entity — not the social profiles.
export const PERSON_ID = "https://santifer.io/#person";
const SANTIAGO = {
  "@type": "Person",
  "@id": PERSON_ID,
  name: "Santiago Fernández de Valderrama Aparicio",
  url: "https://santifer.io",
  jobTitle: "Head of Applied AI",
  sameAs: [
    "https://www.linkedin.com/in/santifer",
    "https://github.com/santifer",
    "https://x.com/santifer",
    "https://dev.to/santifer",
    "https://santifer.substack.com",
    "https://contentdigest.santifer.io",
    "https://www.youtube.com/@santifer_io",
    "https://stackoverflow.com/users/32541743",
    "https://orcid.org/0009-0006-2192-7210",
    "https://www.crunchbase.com/person/santiago-fernandez-de-valderrama",
    "https://huggingface.co/santifer",
    "https://www.wikidata.org/wiki/Q138710224",
    "https://santiferirepair.es",
    "https://career-ops.org/about",
    "https://www.facebook.com/santifer.io/",
    "https://www.producthunt.com/@santifer",
    "https://app.daily.dev/santifer",
  ],
};

// Person + Organization + WebSite, the stable entity anchor every other page
// references via ORG_ID / PERSON_ID. Rendered once sitewide (the layout).
export const siteGraph = {
  "@context": "https://schema.org",
  "@graph": [
    SANTIAGO,
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: "Warpchart",
      url: "https://warpchart.dev",
      logo: "https://warpchart.dev/icon.svg",
      description:
        "Warpchart is a developer tool that ranks every public GitHub repository by worldwide star rank and growth velocity, live and free.",
      // Project -> person by @id (never duplicated). This is what clusters
      // warpchart with career-ops and santifer.io under one creator.
      founder: { "@id": PERSON_ID },
      // warpchart's own entity links. Add its Wikidata item URI here once the
      // item exists (statements drafted in seo-audit/off-site-drafts.md) so the
      // graph closes both ways.
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
        // freshness is the product's differentiator; stamp the render time
        // (ISR-regenerated), so crawlers and LLMs see a recent dateModified
        dateModified: new Date().toISOString().slice(0, 10),
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
  author: { "@id": PERSON_ID },
  publisher: { "@id": ORG_ID },
  // Only the SELF-SERVE, purchasable plans are published as buyable Offers.
  // Business ($399) is concierge (a mailto, no Polar product), so emitting a
  // machine-readable Offer for it would advertise a price a buyer cannot
  // actually purchase: an honesty/credibility liability (and a crawler/agent
  // would surface it as buyable). It stays on the pricing page as "contact".
  offers: [
    { "@type": "Offer", name: "Free", price: "0", priceCurrency: "USD", url: "https://warpchart.dev/pricing" },
    { ...monthly("29"), name: "Pro" },
    { ...monthly("149"), name: "Team" },
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
