import {
  assertIsolatedE2eDatabase,
  getSanitizedE2eDatabaseDescriptor,
  parsePostgresConnectionTuple,
} from "./e2e-database";
import { isProductionApplicationHost } from "./post-transcription-lab-safety";
import {
  FROZEN_CHUNK_MAX_CHARS,
  FROZEN_CHUNK_MAX_SEGMENTS,
  FROZEN_FAIRNESS_POLICY,
  FROZEN_GLOBAL_CONCURRENCY,
  FROZEN_PER_JOB_CONCURRENCY,
} from "./large-realistic-uat-constants";

export class LargeRealisticUatSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LargeRealisticUatSafetyError";
  }
}

export type LargeRealisticUatSafetyEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

function read(env: LargeRealisticUatSafetyEnv, key: string): string {
  return env[key]?.trim() ?? "";
}

function hostnameFromUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw.includes("://") ? raw : `http://${raw}`);
    return parsed.hostname.trim().toLowerCase();
  } catch {
    return null;
  }
}

export { isProductionApplicationHost };

export function collectApplicationHosts(env: LargeRealisticUatSafetyEnv): string[] {
  return [
    read(env, "APP_URL"),
    read(env, "BASE_URL"),
    read(env, "PLAYWRIGHT_BASE_URL"),
    read(env, "NEXT_PUBLIC_APP_URL"),
  ]
    .map(hostnameFromUrl)
    .filter((host): host is string => Boolean(host));
}

export function assertNotProductionRuntime(env: LargeRealisticUatSafetyEnv = process.env): void {
  if (read(env, "NODE_ENV").toLowerCase() === "production") {
    throw new LargeRealisticUatSafetyError(
      "Large realistic UAT refuses NODE_ENV=production.",
    );
  }
  const productionHost = collectApplicationHosts(env).find((host) =>
    isProductionApplicationHost(host),
  );
  if (productionHost) {
    throw new LargeRealisticUatSafetyError(
      `Large realistic UAT refuses production application host ${productionHost}.`,
    );
  }
}

export function assertIsolatedUatDatabase(env: LargeRealisticUatSafetyEnv = process.env): {
  e2eUrl: string;
  descriptor: ReturnType<typeof getSanitizedE2eDatabaseDescriptor>;
} {
  const e2eUrl = read(env, "E2E_DATABASE_URL");
  if (!e2eUrl) {
    throw new LargeRealisticUatSafetyError(
      "Large realistic UAT requires E2E_DATABASE_URL (isolated test DB).",
    );
  }
  const previousE2e = process.env.E2E_DATABASE_URL;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.E2E_DATABASE_URL = e2eUrl;
  if (read(env, "DATABASE_URL")) {
    process.env.DATABASE_URL = read(env, "DATABASE_URL");
  }
  try {
    assertIsolatedE2eDatabase();
    parsePostgresConnectionTuple(e2eUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LargeRealisticUatSafetyError(
      `Large realistic UAT refused the E2E database target: ${message}`,
    );
  } finally {
    if (previousE2e === undefined) delete process.env.E2E_DATABASE_URL;
    else process.env.E2E_DATABASE_URL = previousE2e;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
  return {
    e2eUrl,
    descriptor: getSanitizedE2eDatabaseDescriptor(e2eUrl),
  };
}

export function assertRealYandexCredentialsPresent(
  env: LargeRealisticUatSafetyEnv = process.env,
): { apiKeyPresent: boolean; folderIdPresent: boolean } {
  const apiKeyPresent = Boolean(read(env, "YANDEX_API_KEY"));
  const folderIdPresent = Boolean(read(env, "YANDEX_FOLDER_ID"));
  if (!apiKeyPresent || !folderIdPresent) {
    throw new LargeRealisticUatSafetyError(
      "Large realistic UAT requires YANDEX_API_KEY and YANDEX_FOLDER_ID (values are not printed).",
    );
  }
  return { apiKeyPresent, folderIdPresent };
}

export function frozenEnhancementEnv(): Record<string, string> {
  return {
    YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED: "true",
    TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: String(FROZEN_CHUNK_MAX_CHARS),
    TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: String(FROZEN_CHUNK_MAX_SEGMENTS),
    TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: String(FROZEN_PER_JOB_CONCURRENCY),
    TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY: String(FROZEN_GLOBAL_CONCURRENCY),
    TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY: FROZEN_FAIRNESS_POLICY,
    TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
    TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE: "json_schema",
  };
}

let boundIsolatedUat: {
  e2eUrl: string;
  descriptor: ReturnType<typeof getSanitizedE2eDatabaseDescriptor>;
} | null = null;

export function bindProcessToIsolatedUatDatabase(
  env: NodeJS.ProcessEnv = process.env,
): {
  e2eUrl: string;
  descriptor: ReturnType<typeof getSanitizedE2eDatabaseDescriptor>;
} {
  if (
    boundIsolatedUat &&
    env.DATABASE_URL === boundIsolatedUat.e2eUrl &&
    env.E2E_DATABASE_URL === boundIsolatedUat.e2eUrl
  ) {
    return boundIsolatedUat;
  }
  const result = assertIsolatedUatDatabase(env);
  env.E2E_DATABASE_URL = result.e2eUrl;
  env.DATABASE_URL = result.e2eUrl;
  boundIsolatedUat = result;
  return result;
}

export function applyFrozenEnhancementEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const frozen = frozenEnhancementEnv();
  Object.assign(env, frozen);
  return frozen;
}

export function readFrozenEnhancementSelection(env: LargeRealisticUatSafetyEnv = process.env): {
  chunkMaxChars: number;
  chunkMaxSegments: number;
  perJobConcurrency: number;
  globalConcurrency: number;
  fairness: string;
  matchesFrozen: boolean;
} {
  const chunkMaxChars = Number(
    read(env, "TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS") || FROZEN_CHUNK_MAX_CHARS,
  );
  const chunkMaxSegments = Number(
    read(env, "TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS") || FROZEN_CHUNK_MAX_SEGMENTS,
  );
  const perJobConcurrency = Number(
    read(env, "TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY") || FROZEN_PER_JOB_CONCURRENCY,
  );
  const globalConcurrency = Number(
    read(env, "TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY") || FROZEN_GLOBAL_CONCURRENCY,
  );
  const fairness =
    read(env, "TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY") || FROZEN_FAIRNESS_POLICY;
  return {
    chunkMaxChars,
    chunkMaxSegments,
    perJobConcurrency,
    globalConcurrency,
    fairness,
    matchesFrozen:
      chunkMaxChars === FROZEN_CHUNK_MAX_CHARS &&
      chunkMaxSegments === FROZEN_CHUNK_MAX_SEGMENTS &&
      perJobConcurrency === FROZEN_PER_JOB_CONCURRENCY &&
      globalConcurrency === FROZEN_GLOBAL_CONCURRENCY &&
      fairness === FROZEN_FAIRNESS_POLICY,
  };
}
