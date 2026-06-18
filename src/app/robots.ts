import type { MetadataRoute } from "next";

const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

// Explicit crawl policy. The public pages are all server-rendered and meant to
// be indexed; the JSON API and the private unlock route are not pages. We name
// the AI crawlers explicitly (a positive allow signal for GEO) and keep
// /api/og reachable so social + image crawlers can fetch the OpenGraph card.
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bingbot",
];

export default function robots(): MetadataRoute.Robots {
  const rule = { allow: ["/", "/api/og"], disallow: ["/api/", "/unlock"] };
  return {
    rules: [
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, ...rule })),
      { userAgent: "*", ...rule },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
