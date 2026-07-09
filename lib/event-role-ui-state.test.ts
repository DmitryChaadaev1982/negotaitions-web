import assert from "node:assert/strict";
import test from "node:test";

import type { EventAssignmentDraft } from "@/lib/event-assignment";
import {
  deriveEventFacilitatorOptionAvailability,
  deriveEventObserverOptionAvailability,
  deriveEventRoleOptionAvailability,
  deriveEventRoleSlotSummary,
  deriveUnassignedRoleEligibleParticipantIds,
  normalizeEventAssignmentDraft,
} from "@/lib/event-role-ui-state";

const roles = [
  { id: "role-a", name: "Buyer" },
  { id: "role-b", name: "Seller" },
];

const participants = [
  { id: "p1", displayName: "One", activeAssignmentLabel: null },
  { id: "p2", displayName: "Two", activeAssignmentLabel: null },
  { id: "p3", displayName: "Three", activeAssignmentLabel: null },
  { id: "busy", displayName: "Busy", activeAssignmentLabel: "Room 7" },
];

test("normalizeEventAssignmentDraft removes conflicting and busy assignments", () => {
  const draft: EventAssignmentDraft = {
    roomLabel: "Room A",
    facilitatorEventParticipantId: "busy",
    roleAssignments: {
      "role-a": "p1",
      "role-b": "p1",
      "unknown-role": "p2",
    },
    observerEventParticipantIds: ["p1", "p2", "busy", "p2"],
    preparationDurationMinutes: 5,
    negotiationDurationMinutes: 15,
  };

  const normalized = normalizeEventAssignmentDraft({
    draft,
    roles,
    participants,
  });

  assert.equal(normalized.facilitatorEventParticipantId, null);
  assert.deepEqual(normalized.roleAssignments, {
    "role-a": "p1",
  });
  assert.deepEqual(normalized.observerEventParticipantIds, ["p2"]);
});

test("deriveEventRoleOptionAvailability disables occupied choices with reason", () => {
  const options = deriveEventRoleOptionAvailability({
    roleId: "role-a",
    participants,
    facilitatorEventParticipantId: "p3",
    roleAssignments: {
      "role-a": "p1",
      "role-b": "p2",
    },
  });

  const p2 = options.find((option) => option.id === "p2");
  const p3 = options.find((option) => option.id === "p3");
  const busy = options.find((option) => option.id === "busy");
  assert.equal(p2?.disabled, true);
  assert.equal(p2?.disabledReason, "assignedToAnotherRole");
  assert.equal(p3?.disabled, true);
  assert.equal(p3?.disabledReason, "selectedAsFacilitator");
  assert.equal(busy?.disabled, true);
  assert.equal(busy?.disabledReason, "alreadyInActiveSession");
});

test("deriveEventFacilitatorOptionAvailability blocks role players and busy", () => {
  const options = deriveEventFacilitatorOptionAvailability({
    participants,
    roleAssignments: {
      "role-a": "p1",
    },
  });

  const p1 = options.find((option) => option.id === "p1");
  const busy = options.find((option) => option.id === "busy");
  assert.equal(p1?.disabledReason, "selectedAsRolePlayer");
  assert.equal(busy?.disabledReason, "alreadyInActiveSession");
});

test("deriveEventObserverOptionAvailability blocks facilitator and role players", () => {
  const options = deriveEventObserverOptionAvailability({
    participants,
    facilitatorEventParticipantId: "p3",
    roleAssignments: {
      "role-a": "p1",
    },
  });

  const p1 = options.find((option) => option.id === "p1");
  const p3 = options.find((option) => option.id === "p3");
  assert.equal(p1?.disabledReason, "selectedAsRolePlayer");
  assert.equal(p3?.disabledReason, "selectedAsFacilitator");
});

test("deriveEventRoleSlotSummary reuses shared slot semantics", () => {
  const summary = deriveEventRoleSlotSummary({
    roles,
    participants,
    roleAssignments: {
      "role-a": "p1",
      "role-b": "p2",
    },
  });

  assert.equal(summary.allRolesAssigned, true);
  assert.equal(summary.slots[0]?.assignedParticipantName, "One");
  assert.equal(summary.slots[1]?.assignedParticipantName, "Two");
});

test("deriveUnassignedRoleEligibleParticipantIds returns observer candidates", () => {
  const ids = deriveUnassignedRoleEligibleParticipantIds({
    participants,
    facilitatorEventParticipantId: "p3",
    roleAssignments: {
      "role-a": "p1",
      "role-b": "p2",
    },
  });

  assert.deepEqual(ids, []);
});
