import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveAddParticipantRoleOptionAvailability,
  derivePanelRoleOptionAvailability,
  deriveRoleSlotSummary,
  deriveRoleAssignmentSignature,
  OBSERVER_DRAFT_VALUE,
  type DraftAssignmentValue,
  type SessionRoleParticipantState,
} from "@/lib/session-role-ui-state";

const roles = [
  { id: "role-a", name: "Role A" },
  { id: "role-b", name: "Role B" },
  { id: "role-c", name: "Role C" },
];

test("role assignment signature changes when assignments change", () => {
  const baseParticipants: SessionRoleParticipantState[] = [
    { id: "p1", type: "PARTICIPANT", currentRoleId: "role-a" },
    { id: "p2", type: "PARTICIPANT", currentRoleId: null },
  ];
  const changedParticipants: SessionRoleParticipantState[] = [
    { id: "p1", type: "PARTICIPANT", currentRoleId: null },
    { id: "p2", type: "PARTICIPANT", currentRoleId: "role-a" },
  ];

  const baseSignature = deriveRoleAssignmentSignature(baseParticipants);
  const changedSignature = deriveRoleAssignmentSignature(changedParticipants);

  assert.notEqual(baseSignature, changedSignature);
});

test("current participant keeps own occupied role selectable", () => {
  const participants: SessionRoleParticipantState[] = [
    { id: "p1", type: "PARTICIPANT", currentRoleId: "role-a" },
    { id: "p2", type: "PARTICIPANT", currentRoleId: null },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    p1: "role-a",
    p2: null,
  };

  const optionsForP1 = derivePanelRoleOptionAvailability({
    participantId: "p1",
    participants,
    draft,
    roles,
  });
  const ownRole = optionsForP1.find((option) => option.id === "role-a");

  assert.equal(ownRole?.disabled, false);
  assert.equal(ownRole?.disabledReason, null);
});

test("other participant cannot pick a role occupied by someone else", () => {
  const participants: SessionRoleParticipantState[] = [
    { id: "p1", type: "PARTICIPANT", currentRoleId: "role-a" },
    { id: "p2", type: "PARTICIPANT", currentRoleId: null },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    p1: "role-a",
    p2: null,
  };

  const optionsForP2 = derivePanelRoleOptionAvailability({
    participantId: "p2",
    participants,
    draft,
    roles,
  });
  const occupiedRole = optionsForP2.find((option) => option.id === "role-a");

  assert.equal(occupiedRole?.disabled, true);
  assert.equal(occupiedRole?.disabledReason, "assignedToAnotherParticipant");
});

test("observers and facilitator do not occupy participant role slots", () => {
  const participants: SessionRoleParticipantState[] = [
    { id: "fac", type: "FACILITATOR", currentRoleId: "role-a" },
    { id: "obs", type: "OBSERVER", currentRoleId: "role-b" },
    { id: "p1", type: "PARTICIPANT", currentRoleId: null },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    fac: "role-a",
    obs: OBSERVER_DRAFT_VALUE,
    p1: null,
  };

  const optionsForP1 = derivePanelRoleOptionAvailability({
    participantId: "p1",
    participants,
    draft,
    roles,
  });

  assert.equal(
    optionsForP1.find((option) => option.id === "role-a")?.disabled,
    false,
  );
  assert.equal(
    optionsForP1.find((option) => option.id === "role-b")?.disabled,
    false,
  );
});

test("add participant role options disable already assigned roles", () => {
  const availability = deriveAddParticipantRoleOptionAvailability({
    roles,
    assignedRoleIds: ["role-a", "role-c"],
  });

  assert.equal(
    availability.options.find((option) => option.id === "role-a")?.disabled,
    true,
  );
  assert.equal(
    availability.options.find((option) => option.id === "role-c")?.disabled,
    true,
  );
  assert.equal(
    availability.options.find((option) => option.id === "role-b")?.disabled,
    false,
  );
  assert.equal(availability.allRolesAssigned, false);
});

test("all roles assigned is detected for add participant helper text", () => {
  const availability = deriveAddParticipantRoleOptionAvailability({
    roles,
    assignedRoleIds: ["role-a", "role-b", "role-c"],
  });

  assert.equal(availability.allRolesAssigned, true);
});

test("role slot summary derives assigned participant labels", () => {
  const participants: Array<SessionRoleParticipantState & { displayName: string }> = [
    { id: "p1", displayName: "Dima", type: "PARTICIPANT", currentRoleId: "role-a" },
    { id: "p2", displayName: "Anna", type: "PARTICIPANT", currentRoleId: null },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    p1: "role-a",
    p2: "role-b",
  };

  const summary = deriveRoleSlotSummary({
    roles,
    participants,
    draft,
  });

  assert.deepEqual(summary.slots, [
    {
      roleId: "role-a",
      roleName: "Role A",
      assignedParticipantId: "p1",
      assignedParticipantName: "Dima",
      isAssigned: true,
    },
    {
      roleId: "role-b",
      roleName: "Role B",
      assignedParticipantId: "p2",
      assignedParticipantName: "Anna",
      isAssigned: true,
    },
    {
      roleId: "role-c",
      roleName: "Role C",
      assignedParticipantId: null,
      assignedParticipantName: null,
      isAssigned: false,
    },
  ]);
  assert.equal(summary.allRolesAssigned, false);
});

test("role slot summary ignores facilitator and observer slot occupation", () => {
  const participants: Array<SessionRoleParticipantState & { displayName: string }> = [
    { id: "fac", displayName: "Fac", type: "FACILITATOR", currentRoleId: "role-a" },
    { id: "obs", displayName: "Obs", type: "OBSERVER", currentRoleId: "role-b" },
    { id: "p1", displayName: "P1", type: "PARTICIPANT", currentRoleId: "role-c" },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    fac: "role-a",
    obs: OBSERVER_DRAFT_VALUE,
    p1: "role-c",
  };

  const summary = deriveRoleSlotSummary({
    roles,
    participants,
    draft,
  });

  assert.equal(
    summary.slots.find((slot) => slot.roleId === "role-a")?.assignedParticipantId,
    null,
  );
  assert.equal(
    summary.slots.find((slot) => slot.roleId === "role-b")?.assignedParticipantId,
    null,
  );
  assert.equal(
    summary.slots.find((slot) => slot.roleId === "role-c")?.assignedParticipantId,
    "p1",
  );
});

test("role slot summary marks all roles assigned", () => {
  const participants: Array<SessionRoleParticipantState & { displayName: string }> = [
    { id: "p1", displayName: "P1", type: "PARTICIPANT", currentRoleId: "role-a" },
    { id: "p2", displayName: "P2", type: "PARTICIPANT", currentRoleId: "role-b" },
    { id: "p3", displayName: "P3", type: "PARTICIPANT", currentRoleId: "role-c" },
  ];
  const draft: Record<string, DraftAssignmentValue> = {
    p1: "role-a",
    p2: "role-b",
    p3: "role-c",
  };

  const summary = deriveRoleSlotSummary({
    roles,
    participants,
    draft,
  });

  assert.equal(summary.allRolesAssigned, true);
});
