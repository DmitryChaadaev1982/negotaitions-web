/**
 * Authoritative predicate for whether SessionParticipant.notes are material
 * to the CURRENT negotiation AI analysis.
 *
 * Only actual negotiation PARTICIPANT preparation/position notes are AI input.
 * Facilitator and observer notes are never material to this analysis contract.
 * Future debrief-feedback distribution is out of scope.
 */
export function areNotesMaterialToNegotiationAnalysis(
  participantType: string | null | undefined,
): boolean {
  return participantType === "PARTICIPANT";
}

/**
 * Authoritative lock for material preparation/position notes after the
 * negotiation has ended. Uses Session.negotiationState === FINISHED, the
 * same lifecycle used by N05 / debrief post-negotiation materials.
 *
 * Facilitator and observer notes stay writable. This is not a blanket
 * SessionParticipant.notes lock.
 */
export function areMaterialNegotiationNotesLockedAfterNegotiation(input: {
  participantType: string | null | undefined;
  negotiationState: string | null | undefined;
}): boolean {
  return (
    areNotesMaterialToNegotiationAnalysis(input.participantType) &&
    input.negotiationState === "FINISHED"
  );
}
