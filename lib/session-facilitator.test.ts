import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/enums";
import {
  resolveCanonicalFacilitatorParticipantId,
  resolveSessionParticipantType,
} from "@/lib/session-facilitator";

test("canonical facilitator prefers session.facilitatorId with FACILITATOR role", () => {
  const participants = [
    {
      id: "p-owner",
      type: ParticipantType.FACILITATOR,
      userId: "u-owner",
      createdAt: new Date("2026-07-21T10:00:00.000Z"),
    },
    {
      id: "p-other",
      type: ParticipantType.FACILITATOR,
      userId: "u-other",
      createdAt: new Date("2026-07-21T09:00:00.000Z"),
    },
  ];
  const canonical = resolveCanonicalFacilitatorParticipantId(participants, "u-owner");
  assert.equal(canonical, "p-owner");
});

test("participant type resolver does not silently demote facilitator", () => {
  const participants = [
    {
      id: "p-owner",
      type: ParticipantType.FACILITATOR,
      userId: "u-owner",
      createdAt: new Date("2026-07-21T10:00:00.000Z"),
    },
    {
      id: "p-other",
      type: ParticipantType.FACILITATOR,
      userId: "u-other",
      createdAt: new Date("2026-07-21T09:00:00.000Z"),
    },
  ];
  const resolvedType = resolveSessionParticipantType(
    { id: "p-other", type: ParticipantType.FACILITATOR },
    participants,
    "u-owner",
  );
  assert.equal(resolvedType, ParticipantType.FACILITATOR);
});
