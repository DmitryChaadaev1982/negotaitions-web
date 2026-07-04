import test from "node:test";
import assert from "node:assert/strict";

import { resolveMaterialsScreenUiState } from "@/lib/session-materials-ui-state";

const base = {
  closedBeforeNegotiation: false,
  negotiationState: "RUNNING",
  canReturnToRoom: true,
  participantHasLeftRoom: false,
};

test("standalone: participant left open room shows neutral banner, not organizer closed", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: false,
    closedByEventLegacy: false,
    closedByOrganizer: false,
    participantHasLeftRoom: true,
  });

  assert.equal(ui.showParticipantLeftBanner, true);
  assert.equal(ui.showOrganizerClosedBadge, false);
  assert.equal(ui.showOpenRoomButton, true);
  assert.equal(ui.openRoomUsesRejoinLabel, true);
});

test("standalone: organizer actually closed shows red badge, no return banner", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: false,
    closedByEventLegacy: true,
    closedByOrganizer: true,
    canReturnToRoom: false,
    participantHasLeftRoom: true,
  });

  assert.equal(ui.showParticipantLeftBanner, false);
  assert.equal(ui.showOrganizerClosedBadge, true);
  assert.equal(ui.showOpenRoomButton, false);
});

test("standalone: negotiation finished without organizer close shows finished badge", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: false,
    closedByEventLegacy: true,
    closedByOrganizer: false,
    negotiationState: "FINISHED",
    canReturnToRoom: false,
  });

  assert.equal(ui.showOrganizerClosedBadge, false);
  assert.equal(ui.showFinishedBadge, true);
});

test("event session: participant leave keeps pre-fix behavior without standalone banner", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: true,
    closedByEventLegacy: false,
    closedByOrganizer: false,
    participantHasLeftRoom: true,
  });

  assert.equal(ui.showParticipantLeftBanner, false);
  assert.equal(ui.showOpenRoomButton, true);
  assert.equal(ui.openRoomUsesRejoinLabel, false);
  assert.equal(ui.showOrganizerClosedBadge, false);
});

test("event session: FINISHED keeps pre-fix closed badge (isClosed legacy)", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: true,
    closedByEventLegacy: true,
    closedByOrganizer: false,
    negotiationState: "FINISHED",
    canReturnToRoom: false,
  });

  assert.equal(ui.showOrganizerClosedBadge, true);
  assert.equal(ui.showFinishedBadge, false);
  assert.equal(ui.showOpenRoomButton, false);
});

test("event session: organizer closed by event completion preserves closed badge", () => {
  const ui = resolveMaterialsScreenUiState({
    ...base,
    isEventSession: true,
    closedByEventLegacy: true,
    closedByOrganizer: true,
    canReturnToRoom: false,
    closedBeforeNegotiation: true,
  });

  assert.equal(ui.showOrganizerClosedBadge, true);
  assert.equal(ui.organizerClosedBeforeNegotiation, true);
  assert.equal(ui.showParticipantLeftBanner, false);
});
