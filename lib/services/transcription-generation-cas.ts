import { Prisma, TranscriptStatus } from "@/app/generated/prisma/client";

import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
import {
  isOwnedTranscriptionGeneration,
  type TranscriptionGenerationRef,
} from "@/lib/services/transcription-ownership";

type PersistHold = () => Promise<void> | void;
let persistHoldForTests: PersistHold | null = null;

function assertTranscriptionTestHooksAllowed(): void {
  if (parseServerRuntimeSetting("NODE_ENV") === "production") {
    throw new Error("Transcription test hooks are unavailable in production.");
  }
}

/** Test-only barrier before generation-fenced persist. Never call from production. */
export function setTranscriptionPersistHoldForTests(hold: PersistHold | null): void {
  assertTranscriptionTestHooksAllowed();
  persistHoldForTests = hold;
}

export function clearTranscriptionPersistHoldForTests(): void {
  persistHoldForTests = null;
}

export async function awaitTranscriptionPersistHoldForTests(): Promise<void> {
  if (persistHoldForTests) {
    await persistHoldForTests();
  }
}

export async function applyOwnedTranscriptionUpdate(input: {
  tx: Prisma.TransactionClient;
  generation: TranscriptionGenerationRef;
  data: Prisma.TranscriptUpdateInput;
}): Promise<"applied" | "stale"> {
  await awaitTranscriptionPersistHoldForTests();

  const current = await input.tx.transcript.findUnique({
    where: { id: input.generation.transcriptId },
    select: {
      id: true,
      startedAt: true,
      retranscribeCount: true,
      status: true,
    },
  });

  if (!current || !isOwnedTranscriptionGeneration(current, input.generation)) {
    return "stale";
  }

  const mutation = await input.tx.transcript.updateMany({
    where: {
      id: input.generation.transcriptId,
      startedAt: input.generation.startedAt,
      retranscribeCount: input.generation.retranscribeCount,
      status: {
        in: [
          TranscriptStatus.QUEUED,
          TranscriptStatus.DOWNLOADING_RECORDING,
          TranscriptStatus.COMPRESSING_AUDIO,
          TranscriptStatus.TRANSCRIBING,
        ],
      },
    },
    data: input.data as Prisma.TranscriptUpdateManyMutationInput,
  });

  return mutation.count === 1 ? "applied" : "stale";
}

/**
 * Restore a failed retranscription onto the same generation only.
 * A later claim (new startedAt / retranscribeCount) must not be overwritten.
 */
export async function applyOwnedFailedRetranscriptionRestore(input: {
  tx: Prisma.TransactionClient;
  generation: TranscriptionGenerationRef;
  data: Prisma.TranscriptUpdateManyMutationInput;
}): Promise<"applied" | "stale"> {
  const mutation = await input.tx.transcript.updateMany({
    where: {
      id: input.generation.transcriptId,
      startedAt: input.generation.startedAt,
      retranscribeCount: input.generation.retranscribeCount,
      status: TranscriptStatus.FAILED,
    },
    data: input.data,
  });
  return mutation.count === 1 ? "applied" : "stale";
}
