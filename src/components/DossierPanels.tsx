// Public dossier panels for /r/: MAINTENANCE PULSE (is this system alive
// and sustainable?) and REAL USAGE (is the hype backed by installs?).
// Server components over one cached GraphQL call (lib/explorer dossier).
// Both panels ALWAYS render with stable heights: the loading skeleton draws
// the same boxes, and boxes never move once drawn (zero-CLS contract).
import Panel from "./Panel";
import UsageChart from "./UsageChart";
import { fmtCompact } from "@/lib/format";
import type { Dossier } from "@/lib/explorer";

function ago(iso: string): string {
  const days = Math.max(0, (Date.now() - new Date(iso).getTime()) / 864e5);
  if (days < 1) return "today";
  if (days < 60) return `${Math.round(days)}d ago`;
  if (days < 365) return `${Math.round(days / 30.44)}mo ago`;
  return `${(days / 365.25).toFixed(1)}y ago`;
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "accent" | "warn" | "ink" }) {
  const color = tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="numeral text-micro tracking-[0.2em] text-faint">{label}</span>
      <span className={`numeral text-metric leading-none ${color}`}>{value}</span>
      {hint ? <span className="numeral truncate text-micro text-dim">{hint}</span> : null}
    </div>
  );
}

export function PulsePanel({
  dossier,
  index = "03",
  className = "",
  delay = 0,
}: {
  dossier: Dossier | null;
  index?: string;
  className?: string;
  delay?: number;
}) {
  const d = dossier;
  const net = d ? d.issuesOpened30 - d.issuesClosed30 : 0;
  const flowTotal = d ? d.issuesOpened30 + d.issuesClosed30 : 0;
  const closedShare = flowTotal > 0 ? (d!.issuesClosed30 / flowTotal) * 100 : 50;
  const lastRelease = d?.releases[0] ?? null;
  const releaseDays = lastRelease ? (Date.now() - new Date(lastRelease.at).getTime()) / 864e5 : null;
  return (
    <Panel
      index={index}
      title="Maintenance pulse"
      meta="last 30 days · public telemetry"
      className={className}
      delay={delay}
    >
      <div className="flex min-h-[150px] flex-col justify-between gap-4 py-1">
        {d ? (
          <>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              <Metric
                label="COMMITS"
                value={d.commits30 !== null ? fmtCompact(d.commits30) : "—"}
                hint="default branch"
              />
              <Metric
                label="ISSUE FLOW"
                value={`${fmtCompact(d.issuesOpened30)} in`}
                hint={`${fmtCompact(d.issuesClosed30)} resolved`}
              />
              <Metric label="PRS MERGED" value={fmtCompact(d.prsMerged30)} hint="pull requests" />
              <Metric
                label="LAST RELEASE"
                value={lastRelease ? ago(lastRelease.at) : "—"}
                hint={lastRelease ? lastRelease.tag : "no releases"}
                tone={releaseDays !== null && releaseDays > 120 ? "warn" : "accent"}
              />
            </div>
            {/* issue flow balance: resolved share vs incoming, with the net
                drift of the backlog called out */}
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 w-full overflow-hidden bg-grid/60">
                <div className="h-full bg-accent/70" style={{ width: `${closedShare.toFixed(1)}%` }} />
              </div>
              <div className="numeral flex justify-between text-micro text-faint">
                <span>
                  backlog {net > 0 ? "+" : ""}
                  {fmtCompact(net)} this month{" "}
                  <span className={net > 0 ? "text-warn" : "text-accent"}>{net > 0 ? "▲" : "▼"}</span>
                </span>
                <span>{fmtCompact(d.openIssues)} open issues total</span>
              </div>
            </div>
          </>
        ) : (
          <div className="numeral flex min-h-[150px] items-center justify-center text-micro tracking-[0.2em] text-faint">
            ◌ PULSE TELEMETRY UNAVAILABLE THIS REFRESH
          </div>
        )}
      </div>
    </Panel>
  );
}

export function UsagePanel({
  dossier,
  index = "04",
  className = "",
  delay = 0,
}: {
  dossier: Dossier | null;
  index?: string;
  className?: string;
  delay?: number;
}) {
  const d = dossier;
  const withDownloads = (d?.releases ?? []).filter((r) => r.downloads > 0).slice(0, 4);
  const maxDl = Math.max(1, ...withDownloads.map((r) => r.downloads));
  const hasUsage = Boolean(d && (d.npmLast30 !== null || withDownloads.length));
  return (
    <Panel
      index={index}
      title="Real usage"
      meta="installs, not applause"
      className={className}
      delay={delay}
    >
      <div className="flex min-h-[150px] flex-col gap-3 py-1">
        {hasUsage ? (
          <>
            {d!.npmLast30 !== null ? (
              <Metric
                label="NPM INSTALLS · 30D"
                value={fmtCompact(d!.npmLast30)}
                hint={d!.npmPkg ?? undefined}
                tone="accent"
              />
            ) : null}
            {(d!.npmHistory && d!.npmHistory.length >= 2) ||
            (d!.clonesHistory && d!.clonesHistory.length >= 2) ? (
              <UsageChart npm={d!.npmHistory ?? []} clones={d!.clonesHistory} />
            ) : null}
            {withDownloads.length ? (
              <div className="flex flex-col gap-1.5">
                <span className="numeral text-micro tracking-[0.2em] text-faint">
                  RELEASE DOWNLOADS
                </span>
                {withDownloads.map((r) => (
                  <div key={r.tag} className="flex items-center gap-2">
                    <span className="numeral w-24 truncate text-micro text-dim">{r.tag}</span>
                    <div className="h-1.5 flex-1 overflow-hidden bg-grid/60">
                      <div
                        className="h-full bg-accent/70"
                        style={{ width: `${((r.downloads / maxDl) * 100).toFixed(1)}%` }}
                      />
                    </div>
                    <span className="numeral w-14 text-right text-micro text-ink">
                      {fmtCompact(r.downloads)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="numeral flex min-h-[150px] flex-col items-center justify-center gap-2 text-center text-micro text-faint">
            <span className="tracking-[0.2em]">NO PUBLIC DISTRIBUTION ARTIFACTS</span>
            <span className="text-dim">
              no npm package or release binaries detected: stars, forks and clones carry this
              system&apos;s usage signal
            </span>
          </div>
        )}
      </div>
    </Panel>
  );
}
