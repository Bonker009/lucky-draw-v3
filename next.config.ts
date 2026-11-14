import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image runs Next's minimal standalone server (`server.js`)
  // instead of shipping node_modules. Only the Docker build sets
  // NEXT_STANDALONE: the e2e suite runs against `next start`, which does not
  // serve standalone output.
  output: process.env.NEXT_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
