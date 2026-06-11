"use client";

// The embeddable chart rendered INSIDE the app must follow the SITE theme
// (which can be manually overridden), not the OS scheme: a <picture> with
// prefers-color-scheme picks the OS variant and shows a white chart on a
// dark page whenever the two disagree. We request ?theme= explicitly from
// the resolved site theme instead.
import { useThemeMode } from "@/lib/usePalette";

export default function ThemedChart({ repo, alt }: { repo?: string; alt: string }) {
  const { resolved } = useThemeMode();
  const params = new URLSearchParams();
  if (repo) params.set("repo", repo);
  params.set("theme", resolved);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={resolved}
      src={`/api/chart?${params.toString()}`}
      alt={alt}
      className="w-full"
      loading="lazy"
    />
  );
}
