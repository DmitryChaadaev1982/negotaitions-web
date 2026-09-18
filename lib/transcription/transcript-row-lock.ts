import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

/**
 * Canonical D1 / mapping / Skip / publication / enhancement / AI-admission
 * lock order:
 *
 * 1. Session — transcription/retranscription admission only
 * 2. Transcript — all Transcript-authority mutations
 * 3. AiAnalysis — only after the Transcript lock is held
 * 4. Provider-slot rows — never held together with 1–3 (Slice B)
 *
 * Never hold the Transcript lock across Yandex HTTP, SpeechKit, provider I/O,
 * long waits, or other external network calls.
 */

export type TranscriptLockClient = {
  $queryRaw?: (
    query: TemplateStringsArray,
    ...values: unknown[]
  ) => Promise<unknown>;
};

type TranscriptLockHold = () => Promise<void> | void;
let transcriptLockHoldForTests: TranscriptLockHold | null = null;

function assertTranscriptLockTestHooksAllowed(): void {
  if (parseServerRuntimeSetting("NODE_ENV") === "production") {
    throw new Error("Transcript lock test hooks are unavailable in production.");
  }
}

/** Test-only barrier after FOR UPDATE. Never call from production. */
export function setTranscriptLockHoldForTests(hold: TranscriptLockHold | null): void {
  assertTranscriptLockTestHooksAllowed();
  transcriptLockHoldForTests = hold;
}

export function clearTranscriptLockHoldForTests(): void {
  transcriptLockHoldForTests = null;
}

export async function awaitTranscriptLockHoldForTests(): Promise<void> {
  if (transcriptLockHoldForTests) {
    await transcriptLockHoldForTests();
  }
}

/**
 * Acquire `SELECT id FROM "Transcript" WHERE id = $id FOR UPDATE`.
 * Must run inside an open Prisma transaction. Business decisions stay at the
 * call site: lock, reread, then mutate.
 *
 * Mock clients without `$queryRaw` skip the SQL lock so in-memory unit tests
 * can still exercise the mutation helpers.
 */
export async function lockTranscriptRowForUpdate(
  tx: TranscriptLockClient,
  transcriptId: string,
): Promise<boolean> {
  if (typeof tx.$queryRaw !== "function") {
    return true;
  }
  const rows = (await tx.$queryRaw`
    SELECT "id" FROM "Transcript" WHERE "id" = ${transcriptId} FOR UPDATE
  `) as Array<{ id: string }>;
  await awaitTranscriptLockHoldForTests();
  return rows.length === 1;
}

/**
 * Acquire `SELECT id FROM "AiAnalysis" WHERE sessionId = $id FOR UPDATE`.
 * Call only after the Transcript row lock is already held.
 */
export async function lockAiAnalysisRowForUpdate(
  tx: TranscriptLockClient,
  sessionId: string,
): Promise<boolean> {
  if (typeof tx.$queryRaw !== "function") {
    return true;
  }
  const rows = (await tx.$queryRaw`
    SELECT "id" FROM "AiAnalysis" WHERE "sessionId" = ${sessionId} FOR UPDATE
  `) as Array<{ id: string }>;
  return rows.length === 1;
}
