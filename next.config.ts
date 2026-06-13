import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // galaxy hero -> /r/ warp jump (React <ViewTransition> over the browser's
  // View Transitions API; browsers without support just don't animate)
  experimental: {
    viewTransition: true,
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
    "/api/[transport]": ["./data/**"],
    "/api/monitor": ["./data/**"],
    "/velocity": ["./data/**"],
    "/feed.xml": ["./data/**"],
    "/hq": ["./data/**"],
    "/r/*": ["./data/**"],
    "/r/**": ["./data/**"],
  },
};

export default nextConfig;
