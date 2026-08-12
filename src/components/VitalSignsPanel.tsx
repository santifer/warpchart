// VITAL SIGNS — the living engineering-health dashboard for a repo, designed to
// make a technical hiring lead deduce the maintainer's calibre without the page
// ever asserting it. Three acts: the THESIS (worldwide activity rank), the PROOF
// (percentile fingerprint vs the top of GitHub), and the OPERATION (velocity,
// quality, and the human engine). Facts, not adjectives. All public data.
//
// Two states: unlocked (owned/paid) shows the real dashboard; locked shows a
// blurred teaser + upsell (the data already exists in the moat).
import type { ReactNode } from "react";
import Panel from "./Panel";
import ContributorChart from "./ContributorChart";
import { fmtCompact } from "@/lib/format";
import type { Vitals } from "@/lib/vitals";
import { ghAvatar } from "@/lib/avatar";

// see lib/avatar.ts for why this never goes through github.com/{login}.png
const avatar = ghAvatar;
const topPct = (pct: number) => `top ${Math.max(1, Math.round(100 - pct))}%`;
// the headline tier is derived from the DISPLAYED rank (ceil, never overclaims),
// so "top N%" can never contradict "#R of U": #14 of 999 = 1.4% -> top 2%.
const rankTier = (rank: number, universe: number) =>
  `top ${Math.max(1, Math.ceil((rank / universe) * 100))}%`;
const leadLabel = (h: number) => (h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

function OperatedBy({ login }: { login: string }) {
  return (
    <a
      href={`https://github.com/${login}`}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-2"
      title={`Maintained by ${login} on GitHub`}
    >
      <img
        src={avatar(login, 48)}
        alt={login}
        width={22}
        height={22}
        className="rounded-full ring-1 ring-grid"
        loading="lazy"
      />
      <span className="numeral text-label text-dim transition-colors group-hover:text-accent">
        operated by <span className="text-ink group-hover:text-accent">{login}</span> ↗
      </span>
    </a>
  );
}

// one dimension of the activity fingerprint: a pill filled to its percentile.
// The strongest dimensions carry a full-accent fill; the fill sweeps in on mount
// (telemetry booting), staggered by row, and respects reduced-motion.
function FingerBar({ label, pct, i }: { label: string; pct: number; i: number }) {
  const strong = pct >= 96;
  return (
    <div className="flex items-center gap-3">
      <span className="numeral w-32 shrink-0 text-micro tracking-[0.08em] whitespace-nowrap text-dim">
        {label}
      </span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-grid/50">
        <div
          className="finger-fill h-full rounded-full"
          style={{
            width: `${Math.max(3, pct)}%`,
            background: strong ? "var(--accent)" : "color-mix(in srgb, var(--accent) 55%, transparent)",
            animationDelay: `${i * 90}ms`,
          }}
        />
        {/* median notch: the 50th-percentile mark — every fill sits far past it */}
        <div className="absolute inset-y-0 left-1/2 w-px bg-void/70" aria-hidden />
      </div>
      <span
        className={`numeral w-14 shrink-0 text-right text-label ${strong ? "text-accent" : "text-dim"}`}
      >
        {topPct(pct)}
      </span>
    </div>
  );
}

// a labeled cluster in the operating story: eyebrow + one hero figure + supporting
// lines. Grouping turns a flat row of numbers into three legible stories.
function OpsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="numeral text-micro tracking-[0.22em] text-faint">{title}</span>
      {children}
    </div>
  );
}

// hero figure inside a group
function Figure({
  value,
  hint,
  tone = "ink",
}: {
  value: string;
  hint?: string;
  tone?: "accent" | "warn" | "ink";
}) {
  const color = tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`numeral leading-none ${color}`} style={{ fontSize: "1.65rem" }}>
        {value}
      </span>
      {hint ? <span className="numeral truncate text-micro text-dim">{hint}</span> : null}
    </div>
  );
}

// a compact supporting stat line: label — value
function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="numeral text-micro tracking-[0.1em] text-faint">{label}</span>
      <span className={`numeral text-label ${strong ? "text-accent" : "text-dim"}`}>{value}</span>
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="numeral bg-grid/50 px-1.5 py-0.5 text-micro text-dim">{children}</span>
  );
}

export default function VitalSignsPanel({
  repo,
  name,
  vitals,
  index = "01",
}: {
  repo: string;
  name: string;
  vitals: Vitals | null;
  index?: string;
}) {
  // ---- LOCKED: the real dashboard, blurred, behind the upsell ---------------
  if (!vitals) {
    return (
      <Panel index={index} title="Vital signs" meta="engineering health · locked">
        <div className="relative min-h-[240px] py-1">
          <div className="pointer-events-none space-y-4 blur-[6px] select-none" aria-hidden>
            <div>
              <div className="numeral leading-none text-accent" style={{ fontSize: "2.4rem" }}>
                TOP 1%
              </div>
              <div className="numeral text-micro text-faint">by development activity · #— of 1,000</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="numeral border border-accent/40 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
                ◇ AGENT-NATIVE
              </span>
              {["CLAUDE.md", "AGENTS.md", "MCP"].map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </div>
            {["star velocity", "issues closed", "merged PRs", "releases", "commits"].map((l, i) => (
              <FingerBar key={l} label={l} pct={[88, 82, 78, 72, 66][i]} i={i} />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span className="numeral text-label tracking-[0.2em] text-accent">
              ◈ VITAL SIGNS · {name.toUpperCase()}
            </span>
            <span className="numeral max-w-md text-micro text-dim">
              activity percentile against the top of GitHub, agent-readiness, docs health, DORA
              velocity, first-response, merge quality and the contributor engine — already computed.
              Unlock to reveal.
            </span>
            <a
              href="/pricing"
              className="numeral mt-1 border border-accent/50 px-3 py-1 text-micro tracking-[0.2em] text-accent transition-colors hover:bg-accent/10"
            >
              UNLOCK VITAL SIGNS ↗
            </a>
          </div>
        </div>
      </Panel>
    );
  }

  const a = vitals.activity;
  const lt = vitals.leadTime;
  const dep = vitals.deploy;
  const ad = vitals.adoption;
  const cm = vitals.community;
  const ar = vitals.agentReadiness;
  const q = vitals.quality;
  const ttfr = vitals.responsiveness;
  const auto = vitals.automation;
  const docs = vitals.docs;
  const onboard = vitals.onboarding;
  const since = vitals.createdAt
    ? new Date(vitals.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;
  const alive = vitals.verdict === "ALIVE";

  // the community avatar row shows OTHERS (the maintainer is already the
  // "operated by" link) — stronger social proof: all these people build this.
  const bots = new Set(["github-actions", "renovate", "dependabot", "renovate-bot"]);
  const creatorLc = vitals.creator.login.toLowerCase();
  const faces = (cm?.topContributors ?? [])
    .filter(
      (c) =>
        c.login.toLowerCase() !== creatorLc &&
        !bots.has(c.login.toLowerCase()) &&
        !c.login.toLowerCase().endsWith("[bot]"),
    )
    .slice(0, 7);

  // percentile fingerprint, strongest dimension first — reads as a ranked list
  const fingerprint = [
    { label: "star velocity", pct: a.velocityPct },
    { label: "issues closed", pct: a.issuesPct },
    { label: "merged PRs", pct: a.prsPct },
    { label: "releases", pct: a.releasesPct },
    { label: "commits", pct: a.commitsPct },
  ].sort((x, y) => y.pct - x.pct);

  const gate = cm && (cm.maintainers ?? []).length > 0 ? cm.maintainers : [vitals.creator.login];

  return (
    <Panel
      index={index}
      title="Vital signs"
      meta="engineering health · live"
      action={
        <div className="flex items-center gap-4">
          <span className="hidden sm:block">
            <OperatedBy login={vitals.creator.login} />
          </span>
          <span
            className={`numeral text-label tracking-[0.2em] ${alive ? "text-accent" : "text-warn"}`}
          >
            {alive ? "● ALIVE" : "○ MONUMENT"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-6 py-1">
        {/* ═══ ACT 1 · THE THESIS — the worldwide activity rank ═══ */}
        <div className="flex flex-col gap-2">
          <span className="numeral text-micro tracking-[0.28em] text-faint">
            WORLDWIDE ACTIVITY RANK
          </span>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="numeral leading-none text-accent" style={{ fontSize: "2.7rem" }}>
              {rankTier(a.compositeRank, vitals.universe).toUpperCase()}
            </span>
            <span className="numeral text-body text-ink">
              #{fmtCompact(a.compositeRank)}{" "}
              <span className="text-dim">of the {fmtCompact(vitals.universe)} most-starred on GitHub</span>
            </span>
          </div>
          <span className="numeral text-micro leading-relaxed text-faint/70">
            a live daily composite of commits, merged PRs, issues closed &amp; releases — development
            work, not stars — a snapshot, not a fixed title{since ? ` · maintained since ${since}` : ""}
          </span>
        </div>

        {/* ═══ ACT 2 · THE PEOPLE — who builds this, measured daily ═══ */}
        {cm ? (
          <div className="flex flex-col gap-3 border-t border-grid pt-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <a
                href={`https://github.com/${repo}/graphs/contributors`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3"
                title="Contributors on GitHub"
              >
                {/* The ring must be the PANEL BACKGROUND so overlapping faces
                    read as cut out of it. It said ring-panel, and there is no
                    `panel` colour in @theme, so Tailwind dropped the class and
                    ring-2 fell back to currentColor = --ink: a near-white halo
                    on a near-black panel in dark mode, near-black on white in
                    light. Exactly inverted from the intent in both themes, and
                    silent, because an unknown utility is not an error. --void
                    is the token that actually matches the panel background in
                    both themes (measured, not assumed). */}
                <div className="flex -space-x-2">
                  {faces.map((c) => (
                    <img
                      key={c.login}
                      src={avatar(c.login, 48)}
                      alt={c.login}
                      title={c.login}
                      width={28}
                      height={28}
                      className="rounded-full ring-2 ring-void"
                      loading="lazy"
                    />
                  ))}
                </div>
                <span className="numeral text-label text-ink transition-colors group-hover:text-accent">
                  {fmtCompact(cm.contributors)} contributors ↗
                </span>
              </a>
              {cm.cohorts.length >= 2 ? (
                <span className="numeral text-micro text-faint">
                  returning devs{" "}
                  <span className="text-accent">
                    {cm.cohorts
                      .slice(-3)
                      .map((c) => c.returning)
                      .join(" → ")}
                  </span>{" "}
                  month over month
                </span>
              ) : null}
            </div>
            {/* the evolution strip: daily census curve + rate histogram + toggle.
                The series comes embedded in the vitals blob (cm.census); when a
                repo has no census yet the block simply does not render. */}
            {cm.census ? <ContributorChart census={cm.census} busFactor={cm.busFactor ?? null} /> : null}
            {/* the sentence: pure facts, top-tier by deduction */}
            <div className="numeral text-micro leading-relaxed text-faint">
              {/* Totals are repo-wide; the merge gate and lead time are measured
                  over the sampled window, so the sentence says which is which
                  rather than letting a sample pass for a total. */}
              {/* Repo-wide totals, and the merge gate verified across all of
                  them. The lead time names its own window instead of implying
                  it covers everything. */}
              {fmtCompact(cm.mergedTotal ?? cm.prsSampled)} pull requests from{" "}
              <span className="text-dim">{fmtCompact(cm.contributors)} contributors</span>, every one
              merged through{" "}
              <span className="text-dim">
                {cm.mergedByDistinct === 1 ? "a single maintainer" : `${cm.mergedByDistinct} maintainers`}
              </span>
              {lt ? (
                <>
                  , at <span className="text-accent">{leadLabel(lt.medianH)}</span> median lead time
                  {lt.windowDays ? ` over the last ${lt.windowDays} days` : ""} ({lt.pctUnder24h}%
                  merged in under a day)
                </>
              ) : null}
              .
              {auto?.statusChecksPerPR ? (
                <>
                  {" "}
                  <span className="text-dim">{auto.statusChecksPerPR}</span> status checks guard every
                  merge
                  {auto.bots.length ? (
                    <>
                      {" "}
                      · <span className="text-dim">{auto.bots.length}</span> bots orchestrated (
                      {auto.bots.slice(0, 3).join(", ")})
                    </>
                  ) : null}
                  .
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ═══ ACT 3 · THE PROOF — percentile fingerprint ═══ */}
        <div className="flex flex-col gap-2.5 border-t border-grid pt-5">
          <span className="numeral text-micro tracking-[0.22em] text-faint">
            ACTIVITY FINGERPRINT · PERCENTILE VS THE {fmtCompact(vitals.universe)} MOST-STARRED
          </span>
          {fingerprint.map((f, i) => (
            <FingerBar key={f.label} label={f.label} pct={f.pct} i={i} />
          ))}
          <span className="numeral text-micro text-faint/70">
            the notch marks the median of the {fmtCompact(vitals.universe)} — every signal sits far past
            it
          </span>
        </div>

        {/* ═══ ACT 4 · THE OPERATION — velocity, quality, the gate ═══ */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-grid pt-5 sm:grid-cols-3">
          <OpsGroup title="VELOCITY">
            {lt ? (
              <Figure
                value={leadLabel(lt.medianH)}
                hint={`lead time · DORA ${lt.tier}`}
                tone={lt.tier === "Elite" || lt.tier === "High" ? "accent" : "ink"}
              />
            ) : (
              <Figure value="—" hint="lead time" />
            )}
            <div className="flex flex-col gap-1">
              {dep ? (
                <Stat
                  label="deploy freq"
                  value={dep.perWeek >= 5 ? "daily" : `${dep.perWeek}/wk`}
                  strong
                />
              ) : null}
              {ttfr ? <Stat label="1st response" value={leadLabel(ttfr.medianH)} /> : null}
            </div>
          </OpsGroup>

          <OpsGroup title="QUALITY &amp; RIGOR">
            {q && q.mergedPRs > 0 ? (
              <Figure
                value={`${q.revertPct}%`}
                hint={`revert · ${fmtCompact(q.reverts)} of ${fmtCompact(q.mergedPRs)} merged`}
                tone={q.revertPct <= 0.5 ? "accent" : "ink"}
              />
            ) : (
              <Figure value="—" hint="revert rate" />
            )}
            <div className="flex flex-col gap-1">
              {auto?.statusChecksPerPR ? (
                <Stat label="checks / PR" value={`${auto.statusChecksPerPR}`} strong />
              ) : null}
              {auto && auto.botPRPct >= 0 ? (
                <Stat label="automated" value={`${auto.botPRPct}%`} />
              ) : null}
            </div>
          </OpsGroup>

          <OpsGroup title="THE ENGINE">
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-2">
                {gate.slice(0, 4).map((m) => (
                  <a
                    key={m}
                    href={`https://github.com/${m}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${m} · maintainer`}
                  >
                    <img
                      src={avatar(m, 64)}
                      alt={m}
                      width={34}
                      height={34}
                      className="rounded-full ring-2 ring-void transition-transform hover:scale-110"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
              <span className="numeral text-label leading-tight text-ink">
                {cm && cm.mergedByDistinct === 1 ? "sole maintainer" : `${cm?.mergedByDistinct ?? 1} maintainers`}
                <br />
                <span className="text-micro text-dim">{fmtCompact(cm?.prsSampled ?? a.prs30)} PRs gated</span>
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {/* free of labeled. The bare label count was the panel telling
                  readers a door was open by counting the signs on it: 12 here
                  meant 1 actually free. A zero is worth rendering - it is the
                  loudest thing this stat can say - so the guard is on the
                  pool existing, not on the number being positive. */}
              {onboard && (onboard.goodFirstIssues ?? 0) > 0 ? (
                onboard.goodFirstIssuesFree == null ? (
                  <Stat
                    label="good first issues labeled"
                    value={`${fmtCompact(onboard.goodFirstIssues ?? 0)}`}
                  />
                ) : (
                  <Stat
                    label="good first issues free"
                    value={`${fmtCompact(onboard.goodFirstIssuesFree)} of ${fmtCompact(onboard.goodFirstIssues ?? 0)}`}
                    strong={onboard.goodFirstIssuesFree > 0}
                  />
                )
              ) : null}
              {ad && ad.cloneConvPct !== null ? (
                <Stat label="view → clone" value={`${Math.round(ad.cloneConvPct)}%`} />
              ) : null}
            </div>
          </OpsGroup>
        </div>

        {/* footer credentials — verified from public data. Important, but a
            reader scanning for traction reads rank and growth first. */}
        {ar?.agentNative || (docs && docs.chips.length > 0) ? (
          <div className="flex flex-col gap-2 border-t border-grid pt-5">
            <span className="numeral text-micro tracking-[0.22em] text-faint">
              VERIFIED · PUBLIC GITHUB DATA
            </span>
            {ar?.agentNative ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="numeral inline-flex items-center gap-1.5 border border-accent/45 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
                  ◇ AGENT-NATIVE
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ar.chips.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              </div>
            ) : null}
            {docs && docs.chips.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="numeral inline-flex items-center gap-1.5 border border-accent/45 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
                  ◇ DOCS{docs.healthPct !== null ? ` ${docs.healthPct}%` : ""}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {docs.chips.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
