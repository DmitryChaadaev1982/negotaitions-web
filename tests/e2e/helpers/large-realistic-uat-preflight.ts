import { buildTranscriptEnhancementChunks } from "@/lib/services/yandex-transcript-enhancement";
import type { TranscriptEnhancementInputSegment } from "@/lib/services/yandex-transcript-enhancement";

import {
  FROZEN_CHUNK_MAX_CHARS,
  FROZEN_FAIRNESS_POLICY,
  FROZEN_GLOBAL_CONCURRENCY,
  FROZEN_PER_JOB_CONCURRENCY,
  HISTORICAL_PROBLEM_RAW_CHARS,
} from "./large-realistic-uat-constants";
import {
  LARGE_REALISTIC_FIXTURE_STATS,
  LARGE_REALISTIC_SEGMENTS,
  validateLargeRealisticFixture,
} from "./large-realistic-uat-fixture";
import {
  applyFrozenEnhancementEnv,
  assertIsolatedUatDatabase,
  assertNotProductionRuntime,
  assertRealYandexCredentialsPresent,
  readFrozenEnhancementSelection,
} from "./large-realistic-uat-safety";

export function toEnhancementInput(
  segments = LARGE_REALISTIC_SEGMENTS,
): TranscriptEnhancementInputSegment[] {
  return segments.map((segment) => ({
    index: segment.orderIndex,
    speakerLabel: segment.speakerLabel,
    startMs: Math.round(segment.startSeconds * 1000),
    endMs: Math.round(segment.endSeconds * 1000),
    originalText: segment.text,
  }));
}

export type LargeRealisticUatPreflight = {
  ok: boolean;
  verdict: "PASS" | "FAIL";
  issues: string[];
  dataset: typeof LARGE_REALISTIC_FIXTURE_STATS;
  plannedChunks: number;
  frozen: ReturnType<typeof readFrozenEnhancementSelection>;
  database: {
    hostClass: string;
    host: string;
    port: number;
    databaseMasked: string;
  };
  realYandexCredentialsPresent: boolean;
  productionRuntime: false;
  syntheticOnly: true;
  ratioVsHistorical9592: number;
};

export function runLargeRealisticUatPreflight(): LargeRealisticUatPreflight {
  const issues: string[] = [];
  assertNotProductionRuntime();
  const db = assertIsolatedUatDatabase();
  applyFrozenEnhancementEnv();
  const credentials = assertRealYandexCredentialsPresent();
  const frozen = readFrozenEnhancementSelection();
  if (!frozen.matchesFrozen) {
    issues.push(
      `Frozen enhancement selection mismatch: ${frozen.chunkMaxChars}/${frozen.perJobConcurrency}/${frozen.globalConcurrency}/${frozen.fairness}`,
    );
  }
  if (frozen.chunkMaxChars !== FROZEN_CHUNK_MAX_CHARS) {
    issues.push("chunk target is not 1800");
  }
  if (frozen.perJobConcurrency !== FROZEN_PER_JOB_CONCURRENCY) {
    issues.push("per-job concurrency is not 8");
  }
  if (frozen.globalConcurrency !== FROZEN_GLOBAL_CONCURRENCY) {
    issues.push("global concurrency is not 10");
  }
  if (frozen.fairness !== FROZEN_FAIRNESS_POLICY) {
    issues.push("fairness is not reserved_slot");
  }
  const fixture = validateLargeRealisticFixture();
  for (const issue of fixture.issues) {
    issues.push(`${issue.code}: ${issue.message}`);
  }
  const planned = buildTranscriptEnhancementChunks(toEnhancementInput());
  if (planned.length < 2) {
    issues.push(`Planned chunk count ${planned.length} is too small for a realistic large transcript.`);
  }
  if (fixture.stats.ratioVsHistorical9592 < 2) {
    issues.push(
      `Dataset is only ${fixture.stats.ratioVsHistorical9592}x historical ${HISTORICAL_PROBLEM_RAW_CHARS}-char failure.`,
    );
  }
  return {
    ok: issues.length === 0,
    verdict: issues.length === 0 ? "PASS" : "FAIL",
    issues,
    dataset: fixture.stats,
    plannedChunks: planned.length,
    frozen,
    database: {
      hostClass: db.descriptor.hostClass,
      host: db.descriptor.normalizedHost,
      port: db.descriptor.port,
      databaseMasked: db.descriptor.databaseMasked,
    },
    realYandexCredentialsPresent: credentials.apiKeyPresent && credentials.folderIdPresent,
    productionRuntime: false,
    syntheticOnly: true,
    ratioVsHistorical9592: fixture.stats.ratioVsHistorical9592,
  };
}
