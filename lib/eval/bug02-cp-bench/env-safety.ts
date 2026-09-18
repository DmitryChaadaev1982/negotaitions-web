import {
  assertIsolatedE2eDatabase,
  getDevelopmentDatabaseDescriptor,
  getSanitizedE2eDatabaseDescriptor,
  isE2eDatabaseConfigured,
} from "../../../tests/e2e/helpers/e2e-database";

export type BenchSafetyReport = {
  yandexKeyPresent: boolean;
  yandexFolderPresent: boolean;
  liveYandexReady: boolean;
  e2eConfigured: boolean;
  e2eIsolated: boolean;
  e2eHostClass: "local" | "remote" | null;
  mainHostClass: "local" | "remote" | null;
  productionLikeRefused: boolean;
  blockReason: string | null;
};

export function inspectBenchSafety(): BenchSafetyReport {
  const yandexKeyPresent = Boolean(process.env.YANDEX_API_KEY?.trim());
  const yandexFolderPresent = Boolean(process.env.YANDEX_FOLDER_ID?.trim());
  const e2eConfigured = isE2eDatabaseConfigured();
  let e2eIsolated = false;
  let e2eHostClass: "local" | "remote" | null = null;
  let mainHostClass: "local" | "remote" | null = null;
  let productionLikeRefused = false;
  let blockReason: string | null = null;

  try {
    if (e2eConfigured) {
      assertIsolatedE2eDatabase();
      e2eIsolated = true;
      e2eHostClass = getSanitizedE2eDatabaseDescriptor().hostClass;
    }
    mainHostClass = getDevelopmentDatabaseDescriptor()?.hostClass ?? null;
    if (e2eHostClass === "remote" || mainHostClass === "remote") {
      productionLikeRefused = true;
      blockReason = "BUG02_CP_BENCH_BLOCKED: REMOTE_OR_PRODUCTION_DB";
    }
  } catch (error) {
    productionLikeRefused = true;
    blockReason =
      error instanceof Error
        ? `BUG02_CP_BENCH_BLOCKED: ${error.message}`
        : "BUG02_CP_BENCH_BLOCKED: DATABASE_SAFETY";
  }

  return {
    yandexKeyPresent,
    yandexFolderPresent,
    liveYandexReady: yandexKeyPresent && yandexFolderPresent && !productionLikeRefused,
    e2eConfigured,
    e2eIsolated,
    e2eHostClass,
    mainHostClass,
    productionLikeRefused,
    blockReason,
  };
}
