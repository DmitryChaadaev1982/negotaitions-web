/**
 * Pre-POST start authority for one enhancement provider invocation.
 *
 * A provider HTTP POST may begin only after ACCEPTED. Rejected starts consume
 * no attempt budget and must not emit a provider request-start observation.
 */
export type EnhancementChunkStartRejectionReason =
  | "JOB_TERMINAL"
  | "CANCELLED"
  | "OWNER_STALE"
  | "GENERATION_STALE"
  | "ALREADY_COMPLETE"
  | "ATTEMPT_BUDGET_EXHAUSTED";

export type EnhancementChunkStartAccepted = {
  status: "ACCEPTED";
};

export type EnhancementChunkStartRejected = {
  status: "REJECTED";
  reason: EnhancementChunkStartRejectionReason;
};

export type EnhancementChunkStartDecision =
  | EnhancementChunkStartAccepted
  | EnhancementChunkStartRejected;

export function isAbortingChunkStartRejection(
  reason: EnhancementChunkStartRejectionReason,
): boolean {
  return (
    reason === "JOB_TERMINAL" ||
    reason === "CANCELLED" ||
    reason === "OWNER_STALE" ||
    reason === "GENERATION_STALE"
  );
}

export class ChunkStartRejectedError extends Error {
  readonly reason: EnhancementChunkStartRejectionReason;

  constructor(reason: EnhancementChunkStartRejectionReason) {
    super(`Enhancement chunk start rejected: ${reason}`);
    this.name = "ChunkStartRejectedError";
    this.reason = reason;
  }
}
