import { isSampleMode } from "@/lib/history";

// Shown ONLY when the app runs on the synthetic sample dataset — a fork with no
// private data store. The accumulated real telemetry is the moat and never
// ships in git, so a fork renders the "toy". This bar turns every free fork
// deploy into a billboard back to the hosted product. On the real site (a real
// repo lives in data/) isSampleMode() is false and this renders nothing.
export default function DemoBanner() {
  if (!isSampleMode()) return null;
  return (
    <div className="demo-banner numeral" role="note">
      <span className="demo-banner__tag">DEMO</span>
      <span className="demo-banner__txt">synthetic telemetry · this fork ships sample data</span>
      <a
        className="demo-banner__cta"
        href="https://warpchart.dev"
        target="_blank"
        rel="noopener noreferrer"
      >
        chart your repo for real →
      </a>
    </div>
  );
}
