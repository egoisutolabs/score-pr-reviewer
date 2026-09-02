import path from "node:path";
import type { NextConfig } from "next";

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
