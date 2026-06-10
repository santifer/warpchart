import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // data/ files are read with fs by the live API routes; force-include them
  // in the serverless function bundles.
  outputFileTracingIncludes: {
    "/api/live/velocity": ["./data/**"],
    "/api/live/neighbors": ["./data/**"],
  },
};

export default nextConfig;
