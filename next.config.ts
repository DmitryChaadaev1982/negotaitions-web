import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = process.env.NODE_ENV !== "production";
const serverActionAllowedOrigins = [
  "negotaitions.ru",
  "local.negotaitions.ru",
  "127.0.0.1:3000",
  "127.0.0.1:3100",
  "localhost:3000",
  "localhost:3100",
];

const nextConfig: NextConfig = {
  // Local reverse-tunnel domain for development-only Next dev access.
  allowedDevOrigins: isDevelopment
    ? ["127.0.0.1", "local.negotaitions.ru"]
    : ["127.0.0.1"],
  experimental: {
    serverActions: {
      allowedOrigins: serverActionAllowedOrigins,
    },
  },
  serverExternalPackages: ["ffmpeg-static", "fluent-ffmpeg"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
