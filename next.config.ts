import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveServerActionAllowedOriginsFromEnv } from "./lib/config/server-action-origins";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  // Local reverse-tunnel domain for development-only Next dev access.
  allowedDevOrigins: isDevelopment
    ? ["127.0.0.1", "local.negotaitions.ru"]
    : [],
  experimental: {
    serverActions: {
      allowedOrigins: resolveServerActionAllowedOriginsFromEnv(),
    },
  },
  serverExternalPackages: ["ffmpeg-static", "fluent-ffmpeg"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
