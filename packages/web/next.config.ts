import { withEve } from "eve/next";
import type { NextConfig } from "next";

// Minimal config while we integrate eve. withEve() mounts the agent (agent/)
// and the Next app as one project (no CORS, no URL env vars).
const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // The commons package ships raw TypeScript from a workspace; transpile it.
  transpilePackages: ["@epistack/db"],
  images: {
    remotePatterns: [{ hostname: "avatar.vercel.sh" }],
  },
};

export default withEve(nextConfig);
