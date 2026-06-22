/**
 * Session case snapshot contract.
 *
 * A NegotiationCase is a reusable template; a Session is a historical training event.
 * The live case template may be soft-deleted after sessions are created — sessions must
 * still render case context from snapshot fields and SessionRole rows, not from
 * NegotiationCase.
 *
 * Snapshot fields on Session (set once at session creation):
 * - snapshotCaseTitle
 * - snapshotBusinessContext
 * - snapshotPublicInstructions
 * - snapshotCaseLanguage
 * - durationSeconds (negotiation duration for this session)
 *
 * Role briefings are copied to SessionRole at creation time.
 * UI for session detail, join pages, and room sidebar should prefer these fields;
 * fall back to the live case relation only when snapshot data is missing (legacy rows).
 */
export const sessionCaseSnapshotSelect = {
  snapshotCaseTitle: true,
  snapshotBusinessContext: true,
  snapshotPublicInstructions: true,
  snapshotCaseLanguage: true,
  durationSeconds: true,
  negotiationCaseId: true,
} as const;

export type SessionCaseSnapshot = {
  sourceCaseId: string;
  title: string;
  businessContext: string;
  publicInstructions: string;
  caseLanguage: "RU" | "EN";
  durationSeconds: number;
};

type SessionWithSnapshot = {
  negotiationCaseId: string;
  snapshotCaseTitle: string;
  snapshotBusinessContext: string;
  snapshotPublicInstructions: string;
  snapshotCaseLanguage: "RU" | "EN";
  durationSeconds: number;
  negotiationCase?: {
    title: string;
    businessContext: string;
    publicInstructions: string;
    caseLanguage: "RU" | "EN";
    deletedAt: Date | null;
  } | null;
};

/** Prefer session snapshot; fall back to live case only when snapshot title is empty. */
export function resolveSessionCaseSnapshot(
  session: SessionWithSnapshot,
): SessionCaseSnapshot {
  const live = session.negotiationCase;
  const useLiveFallback =
    !session.snapshotCaseTitle.trim() && live != null;

  return {
    sourceCaseId: session.negotiationCaseId,
    title: useLiveFallback ? live.title : session.snapshotCaseTitle,
    businessContext: useLiveFallback
      ? live.businessContext
      : session.snapshotBusinessContext,
    publicInstructions: useLiveFallback
      ? live.publicInstructions
      : session.snapshotPublicInstructions,
    caseLanguage: useLiveFallback
      ? live.caseLanguage
      : session.snapshotCaseLanguage,
    durationSeconds: session.durationSeconds,
  };
}
