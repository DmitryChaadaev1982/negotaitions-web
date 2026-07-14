import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ParticipantType } from "@/app/generated/prisma/client";
import { aggregateAiPublicationStatus } from "@/lib/ai-publication-aggregate";

describe("aggregateAiPublicationStatus", () => {
  const participant = (id: string, displayName: string, userId: string | null = null) => ({
    id,
    userId,
    displayName,
    type: ParticipantType.PARTICIPANT as const,
  });

  const facilitator = (id: string, displayName: string) => ({
    id,
    userId: null,
    displayName,
    type: ParticipantType.FACILITATOR as const,
  });

  const observer = (id: string, displayName: string) => ({
    id,
    userId: null,
    displayName,
    type: ParticipantType.OBSERVER as const,
  });

  it("returns none when analysis is not completed", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "ANALYZING",
      aiVisibility: "FACILITATOR_ONLY",
      sharedAnalysisJson: null,
      participants: [
        participant("sp-1", "Player One"),
      ],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 0,
      publishedRecipientCount: 0,
    });
  });

  it("returns none when completed but not shared", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "FACILITATOR_ONLY",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ sessionParticipantId: "sp-1" }],
      },
      participants: [
        participant("sp-1", "Player One"),
      ],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 1,
      publishedRecipientCount: 0,
    });
  });

  it("returns none when shared payload is malformed", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: "bad-payload",
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 1,
      publishedRecipientCount: 0,
    });
  });

  it("returns none when there are zero required recipients", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ sessionParticipantId: "fac-1" }],
      },
      participants: [facilitator("fac-1", "Facilitator"), observer("obs-1", "Observer")],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 0,
      publishedRecipientCount: 0,
    });
  });

  it("returns none for one required recipient when unpublished", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [],
      },
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 1,
      publishedRecipientCount: 0,
    });
  });

  it("returns full for one required recipient when published", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ sessionParticipantId: "sp-1" }],
      },
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 1,
      publishedRecipientCount: 1,
    });
  });

  it("returns partial when shared feedback covers subset of recipients", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ sessionParticipantId: "sp-1" }],
      },
      participants: [
        participant("sp-1", "Player One"),
        participant("sp-2", "Player Two"),
        observer("obs-1", "Observer One"),
      ],
    });

    assert.deepEqual(result, {
      status: "partial",
      requiredRecipientCount: 2,
      publishedRecipientCount: 1,
    });
  });

  it("returns full when all required recipients are published", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [
          { sessionParticipantId: "sp-1" },
          { sessionParticipantId: "sp-2" },
        ],
      },
      participants: [
        participant("sp-1", "Player One"),
        participant("sp-2", "Player Two"),
      ],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 2,
      publishedRecipientCount: 2,
    });
  });

  it("deduplicates duplicate publication rows and never over-counts", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [
          { sessionParticipantId: "sp-1" },
          { sessionParticipantId: "sp-1" },
          { sessionParticipantId: "sp-1" },
        ],
      },
      participants: [
        participant("sp-1", "Player One"),
        participant("sp-2", "Player Two"),
      ],
    });

    assert.deepEqual(result, {
      status: "partial",
      requiredRecipientCount: 2,
      publishedRecipientCount: 1,
    });
  });

  it("ignores removed historical recipients by using current membership", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [
          { sessionParticipantId: "removed-sp" },
          { sessionParticipantId: "sp-1" },
        ],
      },
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 1,
      publishedRecipientCount: 1,
    });
  });

  it("ignores publication rows for unknown recipients", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ sessionParticipantId: "unknown-sp" }],
      },
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 1,
      publishedRecipientCount: 0,
    });
  });

  it("uses stable session participant id when names differ", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [
          {
            sessionParticipantId: "sp-1",
            participantName: "Old Name",
          },
        ],
      },
      participants: [participant("sp-1", "New Name")],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 1,
      publishedRecipientCount: 1,
    });
  });

  it("supports userId scoped matching when sessionParticipantId is absent", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ userId: "user-1", participantName: "Alias" }],
      },
      participants: [participant("sp-1", "Player One", "user-1")],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 1,
      publishedRecipientCount: 1,
    });
  });

  it("keeps legacy name-only matching when name is unique", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ participantName: "player one" }],
      },
      participants: [participant("sp-1", "Player One")],
    });

    assert.deepEqual(result, {
      status: "full",
      requiredRecipientCount: 1,
      publishedRecipientCount: 1,
    });
  });

  it("does not count ambiguous legacy name-only matches", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ participantName: "Player One" }],
      },
      participants: [
        participant("sp-1", "Player One"),
        participant("sp-2", "Player One"),
      ],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 2,
      publishedRecipientCount: 0,
    });
  });

  it("does not count ambiguous userId matches", () => {
    const result = aggregateAiPublicationStatus({
      aiStatus: "COMPLETED",
      aiVisibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: {
        participantPersonalFeedback: [{ userId: "shared-user" }],
      },
      participants: [
        participant("sp-1", "Player One", "shared-user"),
        participant("sp-2", "Player Two", "shared-user"),
      ],
    });

    assert.deepEqual(result, {
      status: "none",
      requiredRecipientCount: 2,
      publishedRecipientCount: 0,
    });
  });
});
