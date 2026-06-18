import type { MetadataRoute } from "next";
import { listCodexes } from "@/lib/codex";

const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

// Regenerated hourly: the charted /r/ corpus grows daily, and the home/codex
// freshness is daily. listCodexes() is the same cache-only Blob listing the
// home + /codex read, so this costs no extra GitHub calls.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const statics: MetadataRoute.Sitemap = [
    { url: `${base}`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/codex`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/velocity`, lastModified: now, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/find`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/compare`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/methodology`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/docs`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/sponsors`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];

  // every charted repo's console (owner/name); the most valuable long-tail
  const charted = await listCodexes().catch(() => []);
  const repos: MetadataRoute.Sitemap = charted
    .filter((c) => /^[\w.-]+\/[\w.-]+$/.test(c.repo))
    .map((c) => ({
      url: `${base}/r/${c.repo}`,
      lastModified: c.chartedAt ? new Date(c.chartedAt) : now,
      changeFrequency: "daily" as const,
      priority: 0.7,
    }));

  return [...statics, ...repos];
}
