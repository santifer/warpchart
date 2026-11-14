// Technical docs for warpchart's open, cache-only layer: the CLI, the MCP
// server, the REST API and the README embed. Everything here is public, free,
// and reads only the daily-refreshed caches (zero GitHub calls per request).
// Static page.
import type { Metadata } from "next";
import Link from "next/link";
import Masthead from "@/components/Masthead";
import SpaceBackdrop from "@/components/SpaceBackdrop";
import { API_ENDPOINTS, CLI_COMMANDS, MCP_TOOLS, commandName } from "@/lib/surface";

export const dynamic = "force-static";

const SITE = "https://warpchart.dev";
// the commands that honour --json, named the way a reader types them
const JSON_COMMANDS = CLI_COMMANDS.filter((c) => c.json).map((c) => (commandName(c) === "<owner/name>" ? "owner/name" : commandName(c)));

export const metadata: Metadata = {
  title: "Docs · API, MCP server and CLI · Warpchart",
  description:
    "Use warpchart from anywhere: a public REST API, an MCP server so AI agents can query GitHub growth telemetry, and a zero-dependency CLI. Worldwide rank, star velocity, overtakes, the rising-by-category directory, and natural-language repo recommendation. Free and cache-only.",
  alternates: { canonical: "/docs" },
};

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="hud overflow-x-auto px-4 py-3 font-mono text-label leading-relaxed text-dim">
      <code>{children}</code>
    </pre>
  );
}

function Row({ sig, desc }: { sig: string; desc: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-grid/60 py-2 last:border-0">
      <code className="font-mono text-label text-accent">{sig}</code>
      <span className="text-label font-light text-dim">{desc}</span>
    </div>
  );
}

export default function DocsPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[920px] flex-col gap-10 px-4 py-8 sm:px-6">
      <SpaceBackdrop mode="scan" />
      <header className="rise" style={{ animationDelay: "0ms" }}>
        <Masthead demo={null} />
      </header>

      <section className="rise flex flex-col gap-3" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-tight tracking-[0.08em] text-star">
          DOCS
        </h1>
        <p className="max-w-[720px] text-base font-light leading-relaxed text-dim">
          Warpchart&apos;s open layer: worldwide GitHub growth telemetry from a REST API, an MCP server
          for agents, and a CLI. Every endpoint is free and reads only the daily-refreshed caches, so
          it never burns GitHub quota and never rate-limits you. The per-repository history, traffic
          and attribution are the separate hosted product.
        </p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 numeral text-micro tracking-[0.12em] text-faint">
          <a href="#cli" className="hover:text-accent">CLI</a>
          <a href="#mcp" className="hover:text-accent">MCP SERVER</a>
          <a href="#api" className="hover:text-accent">REST API</a>
          <a href="#embed" className="hover:text-accent">README EMBED</a>
        </nav>
      </section>

      {/* CLI */}
      <section id="cli" className="rise flex flex-col gap-3 scroll-mt-6" style={{ animationDelay: "120ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">CLI</h2>
        <p className="text-label font-light text-dim">
          A zero-dependency terminal client. No install, no auth, no GitHub token.
        </p>
        <Code>{`npx warpchart find "best agentic memory system"
npx warpchart rising ai-llm
npx warpchart tinygrad/tinygrad        # rank, velocity, star chart
npx warpchart hunters tinygrad/tinygrad
npx warpchart top 20 --lang Rust
npx warpchart embed tinygrad/tinygrad
# --json (agent-friendly output) on: ${JSON_COMMANDS.join(", ")}`}</Code>
        <div className="flex flex-col">
          {CLI_COMMANDS.map((c) => (
            <Row key={c.sig} sig={c.sig} desc={c.desc} />
          ))}
        </div>
      </section>

      {/* MCP */}
      <section id="mcp" className="rise flex flex-col gap-3 scroll-mt-6" style={{ animationDelay: "160ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">MCP SERVER</h2>
        <p className="text-label font-light text-dim">
          A streamable-HTTP MCP server so an AI agent can query live GitHub growth telemetry, including
          the present-tense answer a trained model cannot give. Endpoint:
        </p>
        <Code>{`${SITE}/api/mcp`}</Code>
        <p className="text-label font-light text-dim">Add it to Claude Code:</p>
        <Code>{`claude mcp add --transport http warpchart ${SITE}/api/mcp`}</Code>
        <p className="text-label font-light text-dim">Or in an MCP client config (Cursor, etc.):</p>
        <Code>{`{
  "mcpServers": {
    "warpchart": {
      "url": "${SITE}/api/mcp",
      "transport": "http"
    }
  }
}`}</Code>
        <div className="flex flex-col">
          {MCP_TOOLS.map((t) => (
            <Row key={t.name} sig={t.name} desc={t.desc} />
          ))}
        </div>
      </section>

      {/* API */}
      <section id="api" className="rise flex flex-col gap-3 scroll-mt-6" style={{ animationDelay: "200ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">REST API</h2>
        <p className="text-label font-light text-dim">
          Plain JSON over HTTPS. The base URL is self-describing. Edge-cached, CORS-open.
        </p>
        <Code>{`${SITE}/api/v1`}</Code>
        <div className="flex flex-col">
          {API_ENDPOINTS.map((e) => (
            <Row key={e.sig} sig={e.sig} desc={e.desc} />
          ))}
        </div>
      </section>

      {/* Embed */}
      <section id="embed" className="rise flex flex-col gap-3 scroll-mt-6" style={{ animationDelay: "240ms" }}>
        <h2 className="font-display text-title tracking-[0.14em] text-ink">README EMBED</h2>
        <p className="text-label font-light text-dim">
          An animated star-history chart that updates itself, linking back to the live console. Paste
          into any README (replace the repo):
        </p>
        <Code>{`[![star history](${SITE}/api/chart?repo=owner/name)](${SITE}/r/owner/name)`}</Code>
        <p className="text-label font-light text-dim">
          Prefer a compact badge? <code className="font-mono text-accent">/api/badge?repo=owner/name</code>.
          Get either snippet ready-made with <code className="font-mono text-accent">warpchart embed owner/name</code>.
        </p>
      </section>

      <footer className="rise flex flex-wrap items-center justify-between gap-2 pb-4 pt-2">
        <span className="numeral text-micro tracking-[0.15em] text-faint">
          WARPCHART · open telemetry over public GitHub data
        </span>
        <Link prefetch={false} href="/find" className="numeral text-micro text-faint hover:text-dim">
          ask warpchart →
        </Link>
      </footer>
    </main>
  );
}
