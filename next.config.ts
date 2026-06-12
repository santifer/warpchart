import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    "/api/monitor": ["./data/**"],
    "/feed.xml": ["./data/**"],
    "/hq": ["./data/**"],
    "/r/*": ["./data/**"],
    "/r/**": ["./data/**"],
  },
};

export default nextConfig;
