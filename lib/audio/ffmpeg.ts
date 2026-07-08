import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export type FfmpegSource = "env" | "system" | "static";

export type FfmpegStatus = {
  available: boolean;
  path: string | null;
  source: FfmpegSource | null;
};

const require = createRequire(import.meta.url);

function verifyFfmpegExecutable(candidate: string): boolean {
  const result = spawnSync(candidate, ["-version"], { encoding: "utf8" });
  return !result.error && result.status === 0;
}

function resolveSystemFfmpegPath(): string | undefined {
  try {
    const lookupCommand = process.platform === "win32" ? "where.exe" : "which";
    const lookup = spawnSync(lookupCommand, ["ffmpeg"], { encoding: "utf8" });
    if (lookup.error || lookup.status !== 0) {
      return undefined;
    }
    const candidate = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (!candidate || !verifyFfmpegExecutable(candidate)) {
      return undefined;
    }
    return candidate;
  } catch {
    return undefined;
  }
}

function resolveStaticFfmpegPath(): string | undefined {
  try {
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath && existsSync(staticPath) && verifyFfmpegExecutable(staticPath)) {
      return staticPath;
    }
  } catch {
    // ffmpeg-static may be unavailable in some deployments.
  }

  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const fallback = join(process.cwd(), "node_modules", "ffmpeg-static", executableName);
  if (existsSync(fallback) && verifyFfmpegExecutable(fallback)) {
    return fallback;
  }
  return undefined;
}

function resolveEnvFfmpegPath(): string | undefined {
  const overridePath =
    process.env.FFMPEG_PATH?.trim() || process.env.FFMPEG_BIN?.trim();
  if (!overridePath) {
    return undefined;
  }
  if (verifyFfmpegExecutable(overridePath)) {
    return overridePath;
  }
  return undefined;
}

export function getFfmpegStatus(): FfmpegStatus {
  const envPath = resolveEnvFfmpegPath();
  if (envPath) {
    return { available: true, path: envPath, source: "env" };
  }

  const systemPath = resolveSystemFfmpegPath();
  if (systemPath) {
    return { available: true, path: systemPath, source: "system" };
  }

  const staticPath = resolveStaticFfmpegPath();
  if (staticPath) {
    return { available: true, path: staticPath, source: "static" };
  }

  return { available: false, path: null, source: null };
}

export function getFfmpegVersion(path: string): string | null {
  const result = spawnSync(path, ["-version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    return null;
  }
  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? null;
}
