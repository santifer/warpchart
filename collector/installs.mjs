// Install-wave detection from the Traffic Vault.
//
// WHY THIS EXISTS. An influential post once told its readers to hand a repo's
// URL to their coding agent and say "fork this repo". Because the repo's
// installer CLONES it, everyone who obeyed registered as one unique cloner -
// and as nothing else. No page view (the agent never opens a browser), no star
// (they never see the UI), no referrer (git clone does not send one). Stars
// stayed flat, views went DOWN, and the dashboard reported the largest
// adoption event in the project's history as a quiet Saturday.
//
// The lesson, and the reason this file is not just an alert: when the user tells
// an agent to install something, the star stops being the conversion metric and
// the unique cloner becomes it. This turns that into a measured number.
//
// TWO SHAPES, OPPOSITE MEANINGS. Both are "a clone spike"; conflating them is
// how you get a wrong answer either way.
//
//   ratio = clones / unique cloners
//
//   LOW ratio + high volume   -> many distinct actors, one clone each.
//                                An INSTALL WAVE (an agent-mediated campaign).
//   HIGH ratio + flat volume  -> few actors looping. CI, mirrors, automation.
//
// A previous version of this doctrine said "measure unique cloners, total clones
// are machine noise". The wave broke it: a distributed fleet inflates uniques
// too. What actually separates signal from noise is the ratio TOGETHER WITH the
// view and star response, which is why this reports all three and refuses to
// classify without them.
//
// Writes private/installs.json (private prefix: nothing reads it but us) and,
// when ALERT_WEBHOOK_URL is set, posts one line per new event.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node collector/installs.mjs
import { put, get } from "@vercel/blob";

const KEY = "private/installs.json";
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.log("[installs] no BLOB_READ_WRITE_TOKEN, skipping");
  process.exit(0);
}

// Baseline window and thresholds. Deliberately wide: this must fire on the
// once-a-quarter event that matters, not on every busy Tuesday. In the first
// 63 days of history exactly ONE day cleared them.
const BASELINE_DAYS = 28;
const MIN_BASELINE = 10; // fewer days than this and the median means nothing
const WAVE_VOLUME = 2.5; // unique cloners this many times the median...
const WAVE_RATIO = 1.6; // ...with each actor cloning ~once
const K = 3.5; // how many MADs above the median counts as "not normal"

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Median absolute deviation: the robust analogue of a standard deviation, and
// the reason the first version of this file missed both machine-loop days it
// was written to catch: a fixed multiple of the median sat just above them, because
// a repo's day-to-day ratio is genuinely wide. A multiplier cannot know that;
// a dispersion measure can. MAD is used rather
// than a standard deviation precisely because outliers must not widen the very
// band that is supposed to exclude them.
const mad = (xs, med) => {
  const d = median(xs.map((x) => Math.abs(x - med)));
  // A degenerate baseline (every day identical) would make any deviation
  // "infinitely" anomalous. Floor at 5% of the median so it stays sane.
  return Math.max(d ?? 0, Math.abs(med) * 0.05);
};

async function readJson(key) {
  try {
    const res = await get(key, { access: "private", token });
    if (res?.statusCode === 200 && res.stream) {
      return JSON.parse(await new Response(res.stream).text());
    }
  } catch {
    /* missing or transient */
  }
  return null;
}

async function listVaults() {
  const { list } = await import("@vercel/blob");
  const out = [];
  let cursor;
  do {
    const r = await list({ token, prefix: "traffic/", cursor, limit: 1000 });
    out.push(...r.blobs.map((b) => b.pathname));
    cursor = r.cursor;
  } while (cursor);
  return out;
}

// Classify ONE day against the trailing baseline that precedes it.
function classify(day, vault, days, i) {
  const cl = vault.clones[day];
  if (!cl?.u) return null;
  const prior = days.slice(Math.max(0, i - BASELINE_DAYS), i);
  if (prior.length < MIN_BASELINE) return null;

  const priorU = prior.map((d) => vault.clones[d]?.u).filter(Boolean);
  const priorR = prior
    .map((d) => (vault.clones[d]?.u ? vault.clones[d].c / vault.clones[d].u : null))
    .filter(Boolean);
  const baseU = median(priorU);
  const baseR = median(priorR);
  if (!baseU || !baseR) return null;

  const ratio = cl.c / cl.u;
  const volX = cl.u / baseU;
  const loopCut = baseR + K * mad(priorR, baseR);
  const volCut = baseU + K * mad(priorU, baseU);

  // The corroborating channels. An install wave is defined as much by what does
  // NOT move as by what does: browsers stay home, so views and stars flatline.
  const vw = vault.views[day];
  const prevVw = median(prior.map((d) => vault.views[d]?.u).filter(Boolean));
  const viewX = vw?.u && prevVw ? vw.u / prevVw : null;

  // An install wave has to clear BOTH bars: statistically abnormal volume AND a
  // big plain multiple. The multiple is not redundant - it keeps this rare and
  // meaningful rather than firing on every busy Tuesday that clears the MAD.
  let kind = null;
  if (cl.u >= volCut && volX >= WAVE_VOLUME && ratio <= WAVE_RATIO) kind = "install-wave";
  else if (ratio >= loopCut && volX < WAVE_VOLUME) kind = "machine-loop";
  if (!kind) return null;

  return {
    day,
    kind,
    cloners: cl.u,
    clones: cl.c,
    ratio: Math.round(ratio * 100) / 100,
    baselineCloners: Math.round(baseU),
    volumeX: Math.round(volX * 10) / 10,
    viewsUniques: vw?.u ?? null,
    viewsX: viewX == null ? null : Math.round(viewX * 100) / 100,
    // Agent-mediated when the humans never showed up in the browser. Null (not
    // false) when we cannot see views at all: unknown is not "no".
    agentMediated: kind === "install-wave" ? (viewX == null ? null : viewX < 1.2) : null,
  };
}

async function main() {
  const vaults = await listVaults();
  if (!vaults.length) {
    console.log("[installs] no traffic vault yet, skipping");
    return;
  }

  const store = (await readJson(KEY)) ?? { events: [] };
  const known = new Set(store.events.map((e) => `${e.repo}@${e.day}`));
  const fresh = [];

  for (const key of vaults) {
    const vault = await readJson(key);
    if (!vault?.clones || !vault?.views) continue;
    const repo = vault.repo ?? key;
    const days = Object.keys(vault.clones).sort();
    // Skip the most recent day: GitHub's traffic counters for "today" are still
    // filling, and a partial day reads as a collapse. Measure only closed days.
    for (let i = 0; i < days.length - 1; i++) {
      const ev = classify(days[i], vault, days, i);
      if (!ev) continue;
      ev.repo = repo;
      if (known.has(`${repo}@${ev.day}`)) continue;
      fresh.push(ev);
    }
  }

  if (!fresh.length) {
    console.log(`[installs] ${vaults.length} vault(s), no new events`);
    return;
  }

  store.events = [...store.events, ...fresh].sort((a, b) => (a.day < b.day ? -1 : 1));
  store.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  await put(KEY, JSON.stringify(store), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token,
  });

  for (const e of fresh) {
    console.log(
      `[installs] ${e.day} ${e.repo}: ${e.kind} · ${e.cloners.toLocaleString("en-US")} cloners` +
        ` (${e.volumeX}x baseline ${e.baselineCloners}) · ratio ${e.ratio}` +
        (e.viewsX == null ? "" : ` · views ${e.viewsX}x`) +
        (e.agentMediated ? " · agent-mediated (no browser response)" : "")
    );
  }

  // Only the install wave pages a human. The two kinds are not two severities of
  // the same thing: a wave means "something happened outside, go find out what",
  // and it is rare (once in 63 days of history). A machine loop means "do not
  // read these clones as growth", which is an annotation on a number nobody is
  // looking at right now, and it fires roughly every ten days. Pushing both to
  // the same webhook would train the reader to ignore the one that matters.
  const pageable = fresh.filter((e) => e.kind === "install-wave");
  if (process.env.ALERT_WEBHOOK_URL && pageable.length) {
    try {
      const lines = pageable.map(
        (e) =>
          `▸ ${e.repo}: INSTALL WAVE on ${e.day} · ${e.cloners.toLocaleString("en-US")} unique cloners` +
          ` (${e.volumeX}x normal), ratio ${e.ratio}` +
          (e.agentMediated
            ? ". Agent-mediated: no view or star response, so stars and traffic will look FLAT. Do not read that as nothing happening."
            : "")
      );
      const url = process.env.ALERT_WEBHOOK_URL;
      const text = lines.join("\n");
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(url.includes("hooks.slack.com") ? { text } : { content: text }),
      });
      console.log(
        `[installs] alert sent (${pageable.length} wave(s);` +
          ` ${fresh.length - pageable.length} machine-loop day(s) recorded, not paged)`
      );
    } catch (err) {
      console.error(`[installs] alert failed: ${err.message}`);
    }
  }
}

main().catch((err) => {
  // Never break the collect run over a side metric.
  console.error(`[installs] failed (non-fatal): ${err?.message ?? err}`);
  process.exit(0);
});
