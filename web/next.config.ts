import path from "node:path";
import type { NextConfig } from "next";

// One .env at the repo root configures both halves (README). Next only reads
// env files from web/, so without this the runtime never saw AGENT_URL or
// COPILOTKIT_TELEMETRY_DISABLED and CopilotKit's Segment telemetry stayed on.
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  // No .env yet (fresh clone before `cp .env.example .env`): defaults apply.
}

const nextConfig: NextConfig = {
  // @pierre/diffs renders through a Lit element whose async render is aborted
  // by StrictMode's dev-only mount/unmount/mount and never restarted, leaving
  // empty diff bodies in `next dev` only. Production never double-mounts.
  reactStrictMode: false,
  // The repo root holds its own package.json; pin it so Next stops guessing.
  turbopack: { root: path.join(__dirname, "..") },
  // Dev-mode asset requests from an origin other than the bind host are refused;
  // let both spellings of loopback work so `make dev` is not a guessing game.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
