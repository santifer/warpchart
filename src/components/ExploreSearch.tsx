"use client";

// Landing search: the shared RepoSearch pointed at navigation. Picking a
// repo opens its full telemetry scan at /r/owner/name.
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
      onPick={(r) => router.push(`/r/${r}`)}
    />
  );
}
