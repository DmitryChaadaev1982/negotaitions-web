/**
 * Materials screen UI state for account-authorized /sessions/[id]/materials.
 *
 * Event-linked and standalone sessions share terminal badge semantics:
 * - organizer/event-closed badge only for true organizer/event closure
 * - finished badge for ordinary FINISHED sessions
 *
 * Event sessions still keep the pre-existing UX choice of hiding the
 * participant-left-room banner.
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
  const organizerClosed = input.closedByOrganizer;
  const negotiationFinished =
    input.negotiationState === "FINISHED" && !organizerClosed;

  if (input.isEventSession) {
    const isActive = input.canReturnToRoom;
    return {
      showParticipantLeftBanner: false,
      showOpenRoomButton: isActive,
      openRoomUsesRejoinLabel: false,
      showOrganizerClosedBadge: organizerClosed,
      showFinishedBadge: negotiationFinished,
      organizerClosedBeforeNegotiation: input.closedBeforeNegotiation,
    };
  }

  const showParticipantLeftBanner =
    input.participantHasLeftRoom &&
    input.canReturnToRoom &&
    !organizerClosed;

  return {
    showParticipantLeftBanner,
    showOpenRoomButton: input.canReturnToRoom,
    openRoomUsesRejoinLabel: showParticipantLeftBanner,
    showOrganizerClosedBadge: organizerClosed,
    showFinishedBadge: negotiationFinished,
    organizerClosedBeforeNegotiation: input.closedBeforeNegotiation,
  };
}
