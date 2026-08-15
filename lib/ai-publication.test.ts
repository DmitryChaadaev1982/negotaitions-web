import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisPublicationProjection,
  ParticipantType,
} from "@/app/generated/prisma/client";
import {
  historicalSessionRoomEntryWhere,
  isGrantProjectionCompatibleWithParticipant,
  selectPublicationRecipients,
} from "@/lib/ai-publication";

test("publication recipient selector matches Participant/Observer identities from the supplied connection set", () => {
  const recipients = selectPublicationRecipients(
    [{ userId: "participant-user" }, { userId: "observer-user" }, { userId: "facilitator-user" }],
    [
      { id: "participant", userId: "participant-user", type: ParticipantType.PARTICIPANT },
      { id: "observer", userId: "observer-user", type: ParticipantType.OBSERVER },
      { id: "facilitator", userId: "facilitator-user", type: ParticipantType.FACILITATOR },
      { id: "absent", userId: "absent-user", type: ParticipantType.PARTICIPANT },
    ],
  );

  assert.deepEqual(recipients, [
    {
      sessionParticipantId: "participant",
      userId: "participant-user",
      projection: AiAnalysisPublicationProjection.PARTICIPANT,
    },
    {
      sessionParticipantId: "observer",
      userId: "observer-user",
      projection: AiAnalysisPublicationProjection.OBSERVER,
    },
  ]);
});

test("publication recipient selector treats historical terminal connections as room-entry evidence", () => {
  const recipients = selectPublicationRecipients(
    [{ userId: "left-before-publish" }],
    [
      { id: "left", userId: "left-before-publish", type: ParticipantType.PARTICIPANT },
      { id: "lobby-only", userId: "never-entered", type: ParticipantType.OBSERVER },
    ],
  );

  assert.deepEqual(recipients, [
    {
      sessionParticipantId: "left",
      userId: "left-before-publish",
      projection: AiAnalysisPublicationProjection.PARTICIPANT,
    },
  ]);
});

test("publication grant projection cannot be upgraded by a later role change", () => {
  assert.equal(
    isGrantProjectionCompatibleWithParticipant(
      AiAnalysisPublicationProjection.OBSERVER,
      ParticipantType.OBSERVER,
    ),
    true,
  );
  assert.equal(
    isGrantProjectionCompatibleWithParticipant(
      AiAnalysisPublicationProjection.OBSERVER,
      ParticipantType.PARTICIPANT,
    ),
    false,
  );
  assert.equal(
    isGrantProjectionCompatibleWithParticipant(
      AiAnalysisPublicationProjection.PARTICIPANT,
      ParticipantType.OBSERVER,
    ),
    false,
  );
});

test("historical room-entry where is distinct from an active-lease predicate", () => {
  const where = historicalSessionRoomEntryWhere({ sessionId: "session-1", userId: "user-1" });
  assert.deepEqual(where, {
    sessionId: "session-1",
    userId: "user-1",
    user: { status: "ACTIVE" },
  });
  assert.equal("disconnectedAt" in where, false);
  assert.equal("expiresAt" in where, false);
});
