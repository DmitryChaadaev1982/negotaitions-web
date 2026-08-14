import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisPublicationProjection,
  ParticipantType,
} from "@/app/generated/prisma/client";
import {
  isGrantProjectionCompatibleWithParticipant,
  selectPublicationRecipients,
} from "@/lib/ai-publication";

test("publication recipient selector grants only active participant and observer membership", () => {
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
