import { withEve } from "eve/next";
import type { NextConfig } from "next";

// Minimal config while we integrate eve. withEve() mounts the agent (agent/)
// and the Next app as one project (no CORS, no URL env vars).
const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Lets dev HMR work when this box is reached over the LAN or Tailscale
  // instead of localhost (otherwise Next blocks the cross-origin websocket).
  allowedDevOrigins: [
    "10.0.0.225",
    "100.88.189.93",
    "christophers-mac-mini",
    "100.70.156.8",
    "christophers-macbook-air",
  ],
  // The commons package ships raw TypeScript from a workspace; transpile it.
  transpilePackages: ["@epistack/db"],
  images: {
    remotePatterns: [{ hostname: "avatar.vercel.sh" }],
  },
};

export default withEve(nextConfig);
