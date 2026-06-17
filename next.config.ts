import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // galaxy hero -> /r/ warp jump (React <ViewTransition> over the browser's
  // View Transitions API; browsers without support just don't animate)
  experimental: {
    viewTransition: true,
  },
  // The public JSON API is meant to be consumed from anywhere (browser apps,
  // notebooks, agents), so it advertises open CORS. It is read-only, cache-only
  // public data — nothing to protect with same-origin.
  async headers() {
    return [
      {
        source: "/api/v1/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type" },
        ],
      },
    ];
  },
  // data/ files are read with fs by the live API routes, the badge, the OG
  // card and the explorer; force-include them in the function bundles.
  outputFileTracingIncludes: {
    "/api/live/summary": ["./data/**"],
    "/api/live/velocity": ["./data/**"],
    "/api/live/neighbors": ["./data/**"],
    "/api/badge": ["./data/**"],
    "/api/og": ["./data/**"],
    "/api/chart": ["./data/**"],
    "/api/curve": ["./data/**"],
    "/api/search": ["./data/**"],
    "/api/health": ["./data/**"],
    "/api/v1": ["./data/**"],
    "/api/v1/repo": ["./data/**"],
    "/api/v1/velocity": ["./data/**"],
    "/api/v1/overtakes": ["./data/**"],
    "/api/v1/compare": ["./data/**"],
    "/api/v1/leaderboard": ["./data/**"],
    "/api/v1/rising": ["./data/**"],
    "/api/v1/find": ["./data/**"],
    "/api/[transport]": ["./data/**"],
    "/api/monitor": ["./data/**"],
    "/api/tenant-status": ["./data/**"],
    "/api/traffic": ["./data/**"],
    "/pricing": ["./data/**"],
    "/velocity": ["./data/**"],
    "/feed.xml": ["./data/**"],
    "/": ["./data/**"],
    "/console": ["./data/**"],
    "/hq": ["./data/**"],
    "/r/*": ["./data/**"],
    "/r/**": ["./data/**"],
    "/c": ["./data/**"],
    "/c/*": ["./data/**"],
    "/c/[topic]": ["./data/**"],
    "/find": ["./data/**"],
  },
};

export default nextConfig;
