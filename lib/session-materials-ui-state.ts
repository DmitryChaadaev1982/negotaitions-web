/**
 * Materials screen UI state for account-authorized /sessions/[id]/materials.
 *
 * Event-linked sessions (Session.eventId → TrainingEvent) keep the pre-fix
 * status semantics from closedByEvent = buildSessionCloseState().isClosed.
 * Standalone sessions use explicit organizer-close detection and a local-leave banner.
 */

export type MaterialsScreenUiInput = {
  /** True when Session is linked to a TrainingEvent (eventId is set). */
  isEventSession: boolean;
  /** Pre-fix event path: buildSessionCloseState().isClosed */
  closedByEventLegacy: boolean;
  /** Standalone path: closeReason EVENT_COMPLETED or closedByEventAt set */
  closedByOrganizer: boolean;
  closedBeforeNegotiation: boolean;
  negotiationState: string;
  canReturnToRoom: boolean;
  participantHasLeftRoom: boolean;
};

export type MaterialsScreenUiState = {
  showParticipantLeftBanner: boolean;
  showOpenRoomButton: boolean;
  openRoomUsesRejoinLabel: boolean;
  showOrganizerClosedBadge: boolean;
  showFinishedBadge: boolean;
  organizerClosedBeforeNegotiation: boolean;
};

export function resolveMaterialsScreenUiState(
  input: MaterialsScreenUiInput,
): MaterialsScreenUiState {
  if (input.isEventSession) {
    // Event sessions: preserve pre-fix materials status (closedByEvent = isClosed).
    const isActive =
      input.negotiationState !== "FINISHED" && !input.closedByEventLegacy;

    return {
      showParticipantLeftBanner: false,
      showOpenRoomButton: isActive,
      openRoomUsesRejoinLabel: false,
      showOrganizerClosedBadge: input.closedByEventLegacy,
      // Pre-fix UI never reached the FINISHED success branch when isClosed was true.
      showFinishedBadge: false,
      organizerClosedBeforeNegotiation: input.closedBeforeNegotiation,
    };
  }

  const showParticipantLeftBanner =
    input.participantHasLeftRoom &&
    input.canReturnToRoom &&
    !input.closedByOrganizer;
  const negotiationFinished =
    input.negotiationState === "FINISHED" && !input.closedByOrganizer;

  return {
    showParticipantLeftBanner,
    showOpenRoomButton: input.canReturnToRoom,
    openRoomUsesRejoinLabel: showParticipantLeftBanner,
    showOrganizerClosedBadge: input.closedByOrganizer,
    showFinishedBadge: negotiationFinished,
    organizerClosedBeforeNegotiation: input.closedBeforeNegotiation,
  };
}
