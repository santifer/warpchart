"use client";

// Landing search: the shared RepoSearch pointed at navigation. Picking a
// repo opens its full telemetry scan at /r/owner/name. When the galaxy hero
// is mounted, the pick warps THROUGH the map first (zoom to the system's
// real position, then the route change rides the warp view transition).
import { useRouter } from "next/navigation";
import RepoSearch, { type CatalogEntry } from "./RepoSearch";

export type { CatalogEntry };

export default function ExploreSearch({ catalog }: { catalog: CatalogEntry[] }) {
  const router = useRouter();
  return (
    <RepoSearch
      catalog={catalog}
      autoFocus
      size="lg"
      label="SCAN"
      onPick={(r) => {
        const stars = catalog.find((c) => c.r === r)?.s;
        if (window.__gxWarpTo?.(r, stars)) return;
        router.push(`/r/${r}`);
      }}
    />
  );
}
