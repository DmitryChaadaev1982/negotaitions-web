import {
  buildDefaultPocHealthUrl,
  DEFAULT_POC_PUBLIC_BASE_URL,
} from "@/lib/voximplant/poc/poc-health";

import type { PocOrchestratorMode, PocOrchestratorOptions } from "./types";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function readArg(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

export function parsePocOrchestratorArgs(
  argv: string[] = process.argv.slice(2),
): PocOrchestratorOptions {
  const modeRaw = readArg(argv, "--mode") ?? "full";
  const mode: PocOrchestratorMode =
    modeRaw === "transport" ? "transport" : "full";

  const timeoutRaw = readArg(argv, "--timeout-seconds");
  const timeoutSeconds =
    timeoutRaw && Number.isFinite(Number(timeoutRaw))
      ? Math.max(1, Number(timeoutRaw))
      : null;

  const appBaseUrl =
    readArg(argv, "--app-base-url") ||
    process.env.POC_APP_BASE_URL?.trim() ||
    "http://localhost:3000";

  // Prefer explicit public base (tunnel) when set; otherwise loopback app base
  // so Node fetch is not blocked by local TLS/revocation issues.
  const publicBaseUrl =
    readArg(argv, "--public-base-url") ||
    process.env.POC_PUBLIC_BASE_URL?.trim() ||
    appBaseUrl ||
    DEFAULT_POC_PUBLIC_BASE_URL;

  return {
    mode,
    dryRun: hasFlag(argv, "--dry-run"),
    confirmLivePoc: hasFlag(argv, "--confirm-live-poc"),
    confirmLocalDbWrite: hasFlag(argv, "--confirm-local-db-write"),
    keepSession: hasFlag(argv, "--keep-session"),
    keepBrowser: hasFlag(argv, "--keep-browser"),
    skipLogFetch: hasFlag(argv, "--skip-log-fetch"),
    timeoutSeconds,
    appBaseUrl,
    healthUrl:
      readArg(argv, "--health-url") ||
      process.env.POC_HEALTH_URL?.trim() ||
      buildDefaultPocHealthUrl(publicBaseUrl),
  };
}
