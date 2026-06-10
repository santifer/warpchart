"use client";

// The diffusion engine: type any repo, watch its animated chart draw itself,
// copy the README snippet. The snippet uses the <picture> pattern so the
// embed follows GitHub's color scheme.
import { useEffect, useMemo, useState } from "react";

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export default function EmbedGenerator({ defaultRepo }: { defaultRepo: string }) {
  const [repo, setRepo] = useState(defaultRepo);
  const [applied, setApplied] = useState(defaultRepo);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const valid = REPO_RE.test(repo.trim());

  const chartUrl = (theme?: string) =>
    `${origin}/api/chart?repo=${encodeURIComponent(applied)}${theme ? `&theme=${theme}` : ""}`;

  // The embed links to the full live telemetry: the tenant's chart goes to
  // its mission dashboard, any other repo to its explorer system.
  const targetUrl =
    applied.toLowerCase() === defaultRepo.toLowerCase()
      ? `${origin}/`
      : `${origin}/r/${applied}`;

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

  const scan = () => {
    if (!valid) return;
    setStatus("loading");
    setApplied(repo.trim());
    setCopied(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="hud flex items-center gap-3 px-4 py-2.5">
        <span className="numeral shrink-0 text-[10px] tracking-[0.25em] text-accent">EMBED</span>
        <input
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") scan();
          }}
          placeholder="owner/name"
          className="numeral w-full bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          aria-label="Repository for the embeddable chart"
        />
        <button
          onClick={scan}
          disabled={!valid}
          className="numeral shrink-0 border border-accent/40 px-3 py-1 text-[9px] tracking-[0.18em] text-accent transition-colors hover:bg-accent/10 disabled:opacity-40"
        >
          RENDER
        </button>
      </div>

      <div className="hud relative min-h-[120px] p-3">
        {status === "loading" ? (
          <div className="numeral absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.2em] text-dim">
            RECONSTRUCTING TRAJECTORY… first scan of a repo can take ~20s
          </div>
        ) : null}
        {status === "error" ? (
          <div className="numeral absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.2em] text-warn">
            SCAN FAILED · check the repository name
          </div>
        ) : null}
        {origin ? (
          <a href={targetUrl} title={`Open the full telemetry of ${applied}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={applied}
              src={chartUrl()}
              alt={`Animated cumulative star chart of ${applied}`}
              className="w-full"
              style={{ opacity: status === "ready" ? 1 : 0 }}
              onLoad={() => setStatus("ready")}
              onError={() => setStatus("error")}
            />
          </a>
        ) : null}
      </div>

      <div className="hud p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="module-title !text-[9px]">README snippet · theme-aware</span>
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
            className="numeral border border-grid px-3 py-1 text-[9px] tracking-[0.18em] text-dim transition-colors hover:border-accent/50 hover:text-accent"
          >
            {copied ? "COPIED ✓" : "COPY"}
          </button>
        </div>
        <pre className="numeral mt-2 overflow-x-auto whitespace-pre text-[10px] leading-relaxed text-dim">
          {snippet || "…"}
        </pre>
      </div>
    </div>
  );
}
