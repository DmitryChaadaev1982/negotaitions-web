import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type {
  EnhancementProviderCallObservation,
  EnhancementProviderCallObserver,
} from "../../../lib/services/transcript-enhancement-provider-observation";

/**
 * Keep these literals aligned with `./large-realistic-uat-constants.ts`.
 * Native file-URL loads cannot resolve tsconfig `@/` aliases or extensionless
 * relative TypeScript specifiers, so this helper must not import other `.ts`
 * modules at runtime.
 */
export const LARGE_UAT_PROVIDER_CALLS_FILE = "provider-calls.jsonl";
const LARGE_UAT_PROVIDER_OBSERVE_REPORT_DIR = ".debug/large-realistic-uat";

export const LARGE_UAT_PROVIDER_OBSERVE_FLAG = "LARGE_REALISTIC_UAT_PROVIDER_OBSERVE";
export const LARGE_UAT_PROVIDER_OBSERVE_SCHEMA = "uat-provider-observe-v1";

export type LargeUatProviderCallEvent = EnhancementProviderCallObservation & {
  schemaVersion: typeof LARGE_UAT_PROVIDER_OBSERVE_SCHEMA;
  recordedAt: string;
};

export type LargeUatProviderObserveEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type LargeUatProviderObserveInstaller = (
  observer: EnhancementProviderCallObserver | null,
) => void;

export function isLargeRealisticUatProviderObserveEnabled(
  env: LargeUatProviderObserveEnv = process.env,
): boolean {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") return false;
  return env[LARGE_UAT_PROVIDER_OBSERVE_FLAG] === "1";
}

export function largeUatProviderObserveDir(
  env: LargeUatProviderObserveEnv = process.env,
  cwd = process.cwd(),
): string {
  const override = env.LARGE_REALISTIC_UAT_PROVIDER_OBSERVE_DIR?.trim();
  if (override) return override;
  return path.join(cwd, LARGE_UAT_PROVIDER_OBSERVE_REPORT_DIR);
}

export async function recordLargeUatProviderCallEvent(
  event: EnhancementProviderCallObservation & { recordedAt?: string },
  env: LargeUatProviderObserveEnv = process.env,
): Promise<boolean> {
  if (!isLargeRealisticUatProviderObserveEnabled(env)) return false;
  const payload: LargeUatProviderCallEvent = {
    schemaVersion: LARGE_UAT_PROVIDER_OBSERVE_SCHEMA,
    runId: event.runId,
    transcriptId: event.transcriptId,
    chunkIndex: event.chunkIndex,
    requestStartedAt: event.requestStartedAt,
    responseReceivedAt: event.responseReceivedAt,
    httpClass: event.httpClass,
    schemaValid: event.schemaValid,
    checkpointAccepted: event.checkpointAccepted,
    checkpointRejectionReason: event.checkpointRejectionReason,
    recordedAt: event.recordedAt ?? new Date().toISOString(),
  };
  const dir = largeUatProviderObserveDir(env);
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, LARGE_UAT_PROVIDER_CALLS_FILE), `${JSON.stringify(payload)}\n`, "utf8");
  return true;
}

export function installLargeRealisticUatProviderObserver(
  env: LargeUatProviderObserveEnv = process.env,
  setObserver?: LargeUatProviderObserveInstaller,
): boolean {
  if (!isLargeRealisticUatProviderObserveEnabled(env)) {
    return false;
  }
  if (!setObserver) {
    return false;
  }
  setObserver(async (event) => {
    await recordLargeUatProviderCallEvent(event, env);
  });
  return true;
}
