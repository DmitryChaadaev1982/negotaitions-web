import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseTranscriptEnhancementJob,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";

import { query } from "./db";
import {
  LARGE_REALISTIC_UAT_LATEST_FILE,
  LARGE_REALISTIC_UAT_PROVIDER_CALLS_FILE,
  LARGE_REALISTIC_UAT_REPORT_DIR,
} from "./large-realistic-uat-constants";
import type { ProviderCallObserveRecord } from "./large-realistic-uat-metrics";
import { jobRuntimeSummary, summarizeTextChanges } from "./large-realistic-uat-metrics";
import { listLargeRealisticUatSessions } from "./large-realistic-uat-seed";

export type LargeRealisticUatReport = {
  kind: "provider" | "manual" | "resume" | "recovery";
  sessionId: string;
  transcriptId: string;
  runId: string | null;
  sessionUrl: string | null;
  rawChars: number;
  words: number;
  segments: number;
  estimatedDurationSeconds: number;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  calls: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  retries: number;
  http429: number;
  http5xx: number;
  networkFailures: number;
  schemaFailures: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  firstProviderCall: string | null;
  lastProviderCall: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  totalT2Ms: number | null;
  executionStatus: string;
  terminalQuality: string | null;
  publicationEligible: boolean;
  publicationOutcome: string | null;
  skipTime: string | null;
  segmentsTotal: number;
  segmentsTextChanged: number;
  segmentsTextUnchanged: number;
  failedOrErrorSegments: number;
  realYandex: true;
  realProductProviderPath: string;
  initialCallChunks?: number[];
  resumeCallChunks?: number[];
  completedBeforeResume?: number[];
  completedChunksCalledAgain?: number[];
  recoveryMode?: boolean;
  recoveryStart?: string | null;
  completedBeforeRecovery?: number[];
  pendingBeforeRecovery?: number[];
  retryableBeforeRecovery?: number[];
  recoveryProviderCallChunks?: number[];
  recalledCompletedChunks?: number[];
  createdAt: string;
};

export function reportDir(repoRoot: string): string {
  return path.join(repoRoot, LARGE_REALISTIC_UAT_REPORT_DIR);
}

export async function writeUatReport(
  repoRoot: string,
  report: LargeRealisticUatReport,
): Promise<string> {
  const dir = reportDir(repoRoot);
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(dir, `${report.kind}-${stamp}.json`);
  const latestPath = path.join(dir, LARGE_REALISTIC_UAT_LATEST_FILE);
  const payload = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(filePath, payload, "utf8");
  await writeFile(latestPath, payload, "utf8");
  return filePath;
}

export async function loadProviderCallObservations(
  repoRoot: string,
): Promise<ProviderCallObserveRecord[]> {
  try {
    const raw = await readFile(
      path.join(reportDir(repoRoot), LARGE_REALISTIC_UAT_PROVIDER_CALLS_FILE),
      "utf8",
    );
    const records: ProviderCallObserveRecord[] = [];
    for (const line of raw.split(/\r?\n/u)) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as ProviderCallObserveRecord;
      if (typeof parsed.chunkIndex !== "number") continue;
      records.push({
        runId: parsed.runId ?? null,
        chunkIndex: parsed.chunkIndex,
        requestStartedAt: parsed.requestStartedAt ?? null,
        responseReceivedAt: parsed.responseReceivedAt ?? null,
        checkpointAccepted:
          typeof parsed.checkpointAccepted === "boolean" ? parsed.checkpointAccepted : null,
        checkpointRejectionReason: parsed.checkpointRejectionReason ?? null,
      });
    }
    return records;
  } catch {
    return [];
  }
}

export async function readLatestUatReport(
  repoRoot: string,
): Promise<LargeRealisticUatReport | null> {
  try {
    const raw = await readFile(path.join(reportDir(repoRoot), LARGE_REALISTIC_UAT_LATEST_FILE), "utf8");
    return JSON.parse(raw) as LargeRealisticUatReport;
  } catch {
    return null;
  }
}

export async function loadTranscriptObservation(transcriptId: string): Promise<{
  job: TranscriptEnhancementJob;
  textChange: ReturnType<typeof summarizeTextChanges>;
  rawChars: number;
  summary: ReturnType<typeof jobRuntimeSummary>;
  processingMetadata: unknown;
  segments: Array<{ text: string; qualityText: string | null }>;
}> {
  const transcripts = await query<{
    processingMetadata: unknown;
    text: string;
  }>(`SELECT "processingMetadata", "text" FROM "Transcript" WHERE "id" = $1`, [transcriptId]);
  const transcript = transcripts[0];
  if (!transcript) {
    throw new Error(`Transcript ${transcriptId} was not found in the isolated UAT database.`);
  }
  const segments = await query<{ text: string; qualityText: string | null }>(
    `SELECT "text", "qualityText" FROM "TranscriptSegment" WHERE "transcriptId" = $1 ORDER BY "orderIndex" ASC`,
    [transcriptId],
  );
  const job = parseTranscriptEnhancementJob(transcript.processingMetadata);
  return {
    job,
    textChange: summarizeTextChanges(segments),
    rawChars: transcript.text.length,
    summary: jobRuntimeSummary(job),
    processingMetadata: transcript.processingMetadata,
    segments: segments.map((segment) => ({
      text: segment.text,
      qualityText: segment.qualityText,
    })),
  };
}

export async function loadLatestFixtureObservation(): Promise<{
  sessionId: string;
  transcriptId: string;
  kind: string | null;
  title: string;
  observation: Awaited<ReturnType<typeof loadTranscriptObservation>>;
} | null> {
  const sessions = await listLargeRealisticUatSessions();
  const latest = sessions.find((row) => row.transcriptId);
  if (!latest?.transcriptId) return null;
  return {
    sessionId: latest.sessionId,
    transcriptId: latest.transcriptId,
    kind: latest.kind,
    title: latest.title,
    observation: await loadTranscriptObservation(latest.transcriptId),
  };
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
