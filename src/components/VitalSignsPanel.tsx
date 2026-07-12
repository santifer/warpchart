// VITAL SIGNS — the living engineering-health dashboard for a repo: the activity
// fingerprint (percentile vs the top of GitHub across every dimension), DORA
// velocity, and the human engine (contributors + the maintainer merge gate).
// Facts, not adjectives.
//
// Two states: unlocked (owned/paid) shows the real dashboard; locked shows a
// blurred teaser + upsell (the data already exists in the moat).
import Panel from "./Panel";
import { fmtCompact } from "@/lib/format";
import type { Vitals } from "@/lib/vitals";

const avatar = (login: string, size = 48) => `https://github.com/${login}.png?size=${size}`;
const topPct = (pct: number) => `top ${Math.max(1, Math.round(100 - pct))}%`;
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

// one dimension of the activity fingerprint: a bar filled to its percentile
function FingerBar({ label, pct }: { label: string; pct: number }) {
  const strong = pct >= 85;
  return (
    <div className="flex items-center gap-3">
      <span className="numeral w-24 shrink-0 text-micro tracking-[0.15em] text-faint">{label}</span>
      <div className="h-2 flex-1 overflow-hidden bg-grid/60">
        <div
          className={`h-full ${strong ? "bg-accent/80" : "bg-accent/45"}`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
      <span
        className={`numeral w-16 shrink-0 text-right text-micro ${strong ? "text-accent" : "text-dim"}`}
      >
        {topPct(pct)}
      </span>
    </div>
  );
}

function Block({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "accent" | "warn" | "ink";
}) {
  const color = tone === "warn" ? "text-warn" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="numeral text-micro tracking-[0.2em] text-faint">{label}</span>
      <span className={`numeral text-metric leading-none ${color}`}>{value}</span>
      {hint ? <span className="numeral truncate text-micro text-dim">{hint}</span> : null}
    </div>
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
        <div className="relative min-h-[210px] py-1">
          <div className="pointer-events-none space-y-3 blur-[6px] select-none" aria-hidden>
            <div className="numeral text-body text-ink">
              #— of the 1,000 most-starred repositories on GitHub, by development activity
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="numeral border border-accent/40 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
                ◇ AGENT-NATIVE
              </span>
              {["CLAUDE.md", "AGENTS.md", "— skills", "MCP"].map((c) => (
                <span key={c} className="numeral bg-grid/50 px-1.5 py-0.5 text-micro text-dim">
                  {c}
                </span>
              ))}
            </div>
            {["commits", "merged PRs", "issues", "releases", "velocity"].map((l, i) => (
              <FingerBar key={l} label={l} pct={[74, 82, 88, 70, 66][i]} />
            ))}
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span className="numeral text-label tracking-[0.2em] text-accent">
              ◈ VITAL SIGNS · {name.toUpperCase()}
            </span>
            <span className="numeral max-w-md text-micro text-dim">
              activity percentile against the top of GitHub, agent-readiness, DORA velocity, lead
              time, merge quality and the contributor engine — already computed. Unlock to reveal.
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
          <span className={`numeral text-label tracking-[0.2em] ${alive ? "text-accent" : "text-warn"}`}>
            {alive ? "● ALIVE" : "○ MONUMENT"}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-5 py-1">
        {/* the headline claim: the number that does the bragging */}
        <div className="flex flex-col gap-1">
          <div className="text-body leading-snug text-ink">
            <span className="numeral text-accent">#{fmtCompact(a.compositeRank)}</span> of the{" "}
            <span className="numeral">{fmtCompact(vitals.universe)}</span> most-starred repositories on
            GitHub, by development activity.
          </div>
          <div className="numeral text-micro text-faint">
            {topPct(a.compositePct)} · a living project, not a star monument
          </div>
        </div>

        {/* agent-native badge: file-existence from the public tree, nothing said */}
        {ar?.agentNative ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="numeral inline-flex items-center gap-1.5 border border-accent/40 px-2 py-0.5 text-micro tracking-[0.18em] text-accent">
              ◇ AGENT-NATIVE
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {ar.chips.map((c) => (
                <span key={c} className="numeral bg-grid/50 px-1.5 py-0.5 text-micro text-dim">
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* activity fingerprint: top of GitHub across EVERY dimension, not one */}
        <div className="flex flex-col gap-2.5">
          <span className="numeral text-micro tracking-[0.2em] text-faint">
            ACTIVITY FINGERPRINT · PERCENTILE VS TOP {fmtCompact(vitals.universe)}
          </span>
          <FingerBar label="commits" pct={a.commitsPct} />
          <FingerBar label="merged PRs" pct={a.prsPct} />
          <FingerBar label="issues closed" pct={a.issuesPct} />
          <FingerBar label="releases" pct={a.releasesPct} />
          <FingerBar label="star velocity" pct={a.velocityPct} />
        </div>

        {/* DORA velocity + the engine */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-grid pt-4 sm:grid-cols-3">
          {lt ? (
            <Block
              label="LEAD TIME"
              value={leadLabel(lt.medianH)}
              hint={`DORA ${lt.tier} · median merge`}
              tone={lt.tier === "Elite" || lt.tier === "High" ? "accent" : "ink"}
            />
          ) : (
            <Block label="LEAD TIME" value="—" hint="no merged PRs" />
          )}
          {dep ? (
            <Block
              label="DEPLOY FREQ"
              value={dep.perWeek >= 5 ? "daily" : `${dep.perWeek}/wk`}
              hint={`${fmtCompact(dep.releases90)} releases · 90d · DORA ${dep.tier}`}
              tone="accent"
            />
          ) : (
            <Block label="COMMITS · 30D" value={fmtCompact(a.commits30)} hint="default branch" />
          )}
          {cm ? (
            (() => {
              const gate =
                (cm.maintainers ?? []).length > 0 ? cm.maintainers : [vitals.creator.login];
              const extra = cm.mergedByDistinct - gate.length;
              return (
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="numeral text-micro tracking-[0.2em] text-faint">THE GATE</span>
                  <div className="flex items-center gap-2 leading-none">
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
                            src={avatar(m, 56)}
                            alt={m}
                            width={30}
                            height={30}
                            className="rounded-full ring-2 ring-panel transition-transform hover:scale-110"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                    {extra > 0 ? (
                      <span className="numeral text-metric leading-none text-warn">+{extra}</span>
                    ) : null}
                  </div>
                  <span className="numeral truncate text-micro text-dim">
                    {cm.mergedByDistinct === 1 ? "sole maintainer" : `${cm.mergedByDistinct} maintainers`} ·{" "}
                    {fmtCompact(cm.prsSampled)} PRs merged
                  </span>
                </div>
              );
            })()
          ) : (
            <Block label="MERGED PRS · 30D" value={fmtCompact(a.prs30)} hint="pull requests" />
          )}
          {ad && ad.cloneConvPct !== null ? (
            <Block
              label="CONVERSION"
              value={`${Math.round(ad.cloneConvPct)}%`}
              hint="view → clone · 7d"
            />
          ) : (
            <Block label="ISSUES · 30D" value={fmtCompact(a.issues30)} hint="closed" />
          )}
          {/* merge quality as ONE quiet stat: title-revert rate, no ranking */}
          {q && q.mergedPRs > 0 ? (
            <Block
              label="REVERT · 90D"
              value={`${q.revertPct}%`}
              hint={`${fmtCompact(q.reverts)} of ${fmtCompact(q.mergedPRs)} merged`}
              tone={q.revertPct <= 0.5 ? "accent" : "ink"}
            />
          ) : null}
          {/* CHAOSS time-to-first-response: the system attends the community */}
          {ttfr ? (
            <Block
              label="1ST RESPONSE"
              value={leadLabel(ttfr.medianH)}
              hint={`${ttfr.pctUnder24h}% under 24h · ${fmtCompact(ttfr.sample)} issues`}
              tone={ttfr.medianH < 48 ? "accent" : "ink"}
            />
          ) : null}
        </div>

        {/* automation footprint: the unattended machinery, made visible */}
        {auto && (auto.statusChecksPerPR || auto.bots.length) ? (
          <div className="numeral text-micro leading-relaxed text-faint">
            {auto.statusChecksPerPR ? (
              <>
                <span className="text-dim">{auto.statusChecksPerPR}</span> status checks per merged PR
              </>
            ) : null}
            {auto.bots.length ? (
              <>
                {auto.statusChecksPerPR ? " · " : ""}
                <span className="text-dim">{auto.bots.length}</span> bots orchestrated (
                {auto.bots.slice(0, 5).join(", ")})
              </>
            ) : null}
            {auto.botPRPct > 0 ? <> · {auto.botPRPct}% of merges automated</> : null}
          </div>
        ) : null}

        {/* the human engine: contributors (social proof) + the implicit flex */}
        {cm ? (
          <div className="flex flex-col gap-2.5 border-t border-grid pt-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <a
                href={`https://github.com/${repo}/graphs/contributors`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-3"
                title="Contributors on GitHub"
              >
                <div className="flex -space-x-2">
                  {faces.map((c) => (
                    <img
                      key={c.login}
                      src={avatar(c.login, 48)}
                      alt={c.login}
                      title={c.login}
                      width={26}
                      height={26}
                      className="rounded-full ring-2 ring-panel"
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
            {/* the sentence: pure facts, top-tier by deduction */}
            <div className="numeral text-micro leading-relaxed text-faint">
              {fmtCompact(cm.prsSampled)} pull requests from{" "}
              <span className="text-dim">{fmtCompact(cm.contributors)} contributors</span>, every one
              merged through{" "}
              <span className="text-dim">
                {cm.mergedByDistinct === 1 ? "a single maintainer" : `${cm.mergedByDistinct} maintainers`}
              </span>
              {lt ? (
                <>
                  , at <span className="text-accent">{leadLabel(lt.medianH)}</span> median lead time (
                  {lt.pctUnder24h}% merged in under a day)
                </>
              ) : null}
              .
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
