import type { MetadataRoute } from "next";
import { loadRoute } from "@/lib/history";
import { listCodexes } from "@/lib/codex";
import { listCategories } from "@/lib/catalog";

const base = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : "http://localhost:3000";

// Regenerated hourly. A QUALITY /r/ set (the worldwide top-200 ∪ everything
// charted, see TOP below) plus the static pages and the /c category directory.
// All sources are cache-only (route.json on disk, the codex + catalog listings),
// so this costs no GitHub calls and stays well under the 50k/sitemap limit.
export const revalidate = 3600;

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

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

  // QUALITY set, not the whole corpus: the worldwide top-200 (the most notable
  // and searchable, and the ones actually linked from home/velocity/codex) plus
  // everything charted (each has a unique dossier). The deep untracked repos
  // (rank 200+ that nobody has charted) are intentionally left OUT — they are
  // orphan + thin, so sitemapping them is noise, not reach. They earn a place
  // once a browsable index links them and their prose is enriched.
  const TOP = 200;
  const route = loadRoute();
  const routeMod = route?.generated_at ? new Date(route.generated_at) : now;
  const charted = await listCodexes().catch(() => []);
  const chartedAt = new Map(charted.map((c) => [c.repo.toLowerCase(), c.chartedAt]));

  const seen = new Set<string>();
  const repos: MetadataRoute.Sitemap = [];
  for (const r of [...(route?.repos ?? []).slice(0, TOP).map((p) => p.r), ...charted.map((c) => c.repo)]) {
    const k = r.toLowerCase();
    if (seen.has(k) || !REPO_RE.test(r)) continue;
    seen.add(k);
    const at = chartedAt.get(k);
    repos.push({
      url: `${base}/r/${r}`,
      lastModified: at ? new Date(at) : routeMod,
      changeFrequency: "daily",
      priority: 0.6,
    });
  }

  // The rising-by-category directory (/c + its ~40 topic/language pages): the
  // GEO "where software is moving" surface that llms.txt promotes as a Key Page,
  // previously orphaned from the sitemap. Cache-only (catalog listing), daily.
  const cats = listCategories();
  const catMod = cats.asOf ? new Date(cats.asOf) : now;
  const categoryUrls: MetadataRoute.Sitemap = [
    { url: `${base}/c`, lastModified: catMod, changeFrequency: "daily", priority: 0.6 },
    ...cats.categories.map((c) => ({
      url: `${base}/c/${c.id}`,
      lastModified: catMod,
      changeFrequency: "daily" as const,
      priority: 0.6,
    })),
  ];

  return [...statics, ...categoryUrls, ...repos.slice(0, 45000)];
}
