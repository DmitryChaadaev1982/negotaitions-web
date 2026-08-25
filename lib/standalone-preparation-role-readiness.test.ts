import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  areStandalonePreparationRolesReady,
  evaluateStandaloneStartPreparationGuard,
  STANDALONE_ROLES_NOT_READY_CODE,
  STANDALONE_ROLES_NOT_READY_ERROR,
} from "@/lib/standalone-preparation-role-readiness";

const assignableRoles = [
  { id: "role-buyer", name: "Buyer" },
  { id: "role-seller", name: "Seller" },
];

test("A01 standalone required slot missing rejects START_PREPARATION", () => {
  const guard = evaluateStandaloneStartPreparationGuard({
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "FACILITATOR", sessionRoleId: null },
    ],
  });

  assert.equal(areStandalonePreparationRolesReady({
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
    ],
  }), false);
  assert.equal(guard.ok, false);
  if (!guard.ok) {
    assert.equal(guard.status, 409);
    assert.equal(guard.body.code, STANDALONE_ROLES_NOT_READY_CODE);
    assert.equal(guard.body.error, STANDALONE_ROLES_NOT_READY_ERROR);
  }
});

test("A02 standalone participant without valid assignable sessionRoleId rejects", () => {
  const incomplete = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: null },
    ],
  };
  const invalidRole = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: "role-observer" },
    ],
  };

  const extraUnassigned = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: "role-seller" },
      { type: "PARTICIPANT", sessionRoleId: null },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(incomplete), false);
  assert.equal(areStandalonePreparationRolesReady(invalidRole), false);
  assert.equal(areStandalonePreparationRolesReady(extraUnassigned), false);
  assert.equal(evaluateStandaloneStartPreparationGuard(incomplete).ok, false);
  assert.equal(evaluateStandaloneStartPreparationGuard(invalidRole).ok, false);
});

test("A03 standalone all required slots and all negotiation participants assigned allows", () => {
  const complete = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: "role-seller" },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(complete), true);
  assert.deepEqual(evaluateStandaloneStartPreparationGuard(complete), { ok: true });
});

test("A04 facilitator and observer without case role do not block", () => {
  const ready = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "FACILITATOR", sessionRoleId: null },
      { type: "OBSERVER", sessionRoleId: null },
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: "role-seller" },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(ready), true);
  assert.equal(evaluateStandaloneStartPreparationGuard(ready).ok, true);
});

test("A05 zero assignable roles allows Preparation to start", () => {
  const zeroRoles = {
    eventId: null,
    roles: [{ id: "role-observer", name: "Observer" }],
    participants: [
      { type: "FACILITATOR", sessionRoleId: null },
      { type: "OBSERVER", sessionRoleId: null },
      { type: "PARTICIPANT", sessionRoleId: null },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(zeroRoles), true);
  assert.equal(evaluateStandaloneStartPreparationGuard({
    eventId: null,
    roles: [],
    participants: [{ type: "PARTICIPANT", sessionRoleId: null }],
  }).ok, true);
});

test("A06 Event-created Session does not apply the standalone guard", () => {
  const eventIncomplete = {
    eventId: "event-1",
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: null },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(eventIncomplete), true);
  assert.deepEqual(evaluateStandaloneStartPreparationGuard(eventIncomplete), {
    ok: true,
  });
});

test("A07 UI readiness is false when incomplete and true when complete", () => {
  const incomplete = {
    eventId: null,
    roles: assignableRoles,
    participants: [{ type: "PARTICIPANT", sessionRoleId: "role-buyer" }],
  };
  const complete = {
    eventId: null,
    roles: assignableRoles,
    participants: [
      { type: "PARTICIPANT", sessionRoleId: "role-buyer" },
      { type: "PARTICIPANT", sessionRoleId: "role-seller" },
    ],
  };

  assert.equal(areStandalonePreparationRolesReady(incomplete), false);
  assert.equal(areStandalonePreparationRolesReady(complete), true);
});

test("control API START_PREPARATION uses the shared standalone role guard", () => {
  const source = readFileSync(
    join(process.cwd(), "app/api/sessions/[sessionId]/control/route.ts"),
    "utf8",
  );
  assert.match(source, /evaluateStandaloneStartPreparationGuard/);
  assert.match(source, /kind: "roles_not_ready"/);
  assert.match(source, /action === "START_PREPARATION"/);
});

test("Start Preparation button uses the shared readiness predicate without a modal", () => {
  const source = readFileSync(
    join(process.cwd(), "components/facilitator-room-controls.tsx"),
    "utf8",
  );
  assert.match(source, /areStandalonePreparationRolesReady/);
  assert.match(source, /room\.assignRolesBeforePreparation/);
  assert.match(source, /start-preparation-roles-hint/);
  assert.match(source, /disabled=\{isSubmitting \|\| !standalonePreparationRolesReady\}/);
  assert.doesNotMatch(source, /window\.alert/);
});
