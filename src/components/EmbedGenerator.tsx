"use client";

// The diffusion engine: search any repo (same live finder as the landing
// scan), watch its animated chart draw itself, copy the README snippet.
// The snippet uses the <picture> pattern so the embed follows GitHub's
// color scheme.
import { useEffect, useMemo, useState } from "react";
import { useThemeMode } from "@/lib/usePalette";
import RepoSearch, { type CatalogEntry } from "./RepoSearch";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export default function EmbedGenerator({
  defaultRepo,
  catalog,
}: {
  defaultRepo: string;
  catalog: CatalogEntry[];
}) {
  const { resolved } = useThemeMode();
  const [applied, setApplied] = useState(defaultRepo);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setOrigin(window.location.origin);
    // deep link from the explorer: /explore#embed=owner/name pre-fills
    const m = window.location.hash.match(/embed=([^&]+)/);
    if (m) {
      const r = decodeURIComponent(m[1]);
      if (REPO_RE.test(r)) {
        setApplied(r);
        setStatus("loading");
      }
    }
  }, []);

  const isTenant = applied.toLowerCase() === defaultRepo.toLowerCase();

  // The tenant's chart needs no ?repo= : it reads the exact local archive
  // (instant, zero GitHub calls), while other repos use sampled history.
  const chartUrl = (theme?: string) => {
    const params = new URLSearchParams();
    if (!isTenant) params.set("repo", applied);
    if (theme) params.set("theme", theme);
    const qs = params.toString();
    return `${origin}/api/chart${qs ? `?${qs}` : ""}`;
  };

  // Every repo's full telemetry lives on its own /r/ route: the tracked
  // repo simply renders unlocked there. One link pattern for everything.
  const targetUrl = `${origin}/r/${applied}`;

  const snippet = useMemo(() => {
    if (!origin) return "";
    // loading="lazy" defers the fetch until the chart nears the viewport,
    // so the draw-on animation fires as the reader scrolls to it (GitHub
    // already lazy-loads README images; this extends it to any site).
    return [
      `<a href="${targetUrl}">`,
      `  <picture>`,
      `    <source media="(prefers-color-scheme: dark)" srcset="${chartUrl("dark")}">`,
      `    <img alt="Live star telemetry of ${applied}" src="${chartUrl("light")}" loading="lazy">`,
      `  </picture>`,
      `</a>`,
    ].join("\n");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, applied]);

  const scan = (r: string) => {
    setStatus("loading");
    setApplied(r);
    setCopied(false);
    setRetry(0);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* the same live finder as the landing scan, pointed at rendering:
          pick a repo and its chart + snippet appear below */}
      <RepoSearch
        catalog={catalog}
        size="sm"
        label="EMBED"
        placeholder={`search any repository to embed… (showing ${applied})`}
        onPick={scan}
      />

      <div className="hud relative min-h-[120px] p-3">
        {status === "loading" ? (
          <div className="numeral absolute inset-0 flex items-center justify-center text-label tracking-[0.2em] text-dim">
            RECONSTRUCTING TRAJECTORY… first scan of a repo can take ~20s
          </div>
        ) : null}
        {status === "error" ? (
          <div className="numeral absolute inset-0 flex items-center justify-center text-label tracking-[0.2em] text-warn">
            SCAN FAILED · check the repository name
          </div>
        ) : null}
        {origin ? (
          <a href={targetUrl} title={`Open the full telemetry of ${applied}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={`${applied}:${retry}:${resolved}`}
              src={chartUrl(resolved)}
              alt={`Animated cumulative star chart of ${applied}`}
              className="w-full"
              style={{ opacity: status === "ready" ? 1 : 0 }}
              onLoad={() => setStatus("ready")}
              onError={() => {
                // cold render of a big repo can trip on a transient GitHub
                // 5xx; retry twice before declaring the scan failed
                if (retry < 2) setTimeout(() => setRetry((r) => r + 1), 2500);
                else setStatus("error");
              }}
            />
          </a>
        ) : null}
      </div>

      <div className="hud p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="module-title !text-micro">README snippet · theme-aware</span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              } catch {
                /* clipboard unavailable */
              }
            }}
            className="numeral border border-grid px-3 py-1 text-micro tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            {copied ? "COPIED ✓" : "COPY"}
          </button>
        </div>
        <pre className="numeral mt-2 overflow-x-auto whitespace-pre text-label leading-relaxed text-dim">
          {snippet || "…"}
        </pre>
      </div>
    </div>
  );
}
