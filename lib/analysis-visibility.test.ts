import assert from "node:assert/strict";
import test from "node:test";

import {
  getAnalysisForObserver,
  getAnalysisForParticipant,
} from "@/lib/analysis-visibility";
import {
  bindParticipantPersonalFeedback,
  createMockAnalysisOutput,
  NegotiationAnalysisOutputSchema,
} from "@/lib/ai/negotiation-analysis";

const roster = [
  { id: "participant-a", displayName: "Alex Kim", type: "PARTICIPANT" },
  { id: "participant-b", displayName: "Alex Kim", type: "PARTICIPANT" },
  { id: "observer", displayName: "Observer", type: "OBSERVER" },
];

test("real provider-shaped stable IDs bind duplicate names without cross-participant feedback", () => {
  const providerOutput = createMockAnalysisOutput("en");
  providerOutput.participantPersonalFeedback = [
    {
      ...providerOutput.participantPersonalFeedback[0]!,
      sessionParticipantId: "participant-a",
      participantName: "Alex Kim",
      achievements: ["A-only achievement"],
    },
    {
      ...providerOutput.participantPersonalFeedback[1]!,
      sessionParticipantId: "participant-b",
      participantName: "Alex Kim",
      achievements: ["B-only achievement"],
    },
  ];
  assert.equal(NegotiationAnalysisOutputSchema.safeParse(providerOutput).success, true);

  const stored = bindParticipantPersonalFeedback(providerOutput, roster);
  const participantA = getAnalysisForParticipant(
    stored,
    { participantId: "participant-a", displayName: "Alex Kim" },
    roster,
  );
  const rendered = JSON.stringify(participantA);
  assert.match(rendered, /A-only achievement/);
  assert.doesNotMatch(rendered, /B-only achievement/);
});

test("ambiguous legacy name-only feedback is omitted and observers receive none", () => {
  const providerOutput = createMockAnalysisOutput("en");
  const legacyShared = {
    ...providerOutput,
    participantPersonalFeedback: [
      {
        ...providerOutput.participantPersonalFeedback[0]!,
        sessionParticipantId: undefined,
        participantName: "  alex   kim ",
        achievements: ["ambiguous legacy feedback"],
      },
    ],
  };
  const participantA = getAnalysisForParticipant(
    legacyShared,
    { participantId: "participant-a", displayName: "Alex Kim" },
    roster,
  );
  assert.equal(participantA?.participantPersonalFeedback.length, 0);

  const observer = getAnalysisForObserver(legacyShared);
  assert.equal("participantPersonalFeedback" in (observer ?? {}), false);
});

test("unknown provider stable IDs are discarded before persistence", () => {
  const providerOutput = createMockAnalysisOutput("en");
  providerOutput.participantPersonalFeedback[0]!.sessionParticipantId =
    "unknown-participant";
  providerOutput.participantPersonalFeedback[1]!.sessionParticipantId =
    "participant-b";
  const stored = bindParticipantPersonalFeedback(providerOutput, roster);
  assert.equal(stored.participantPersonalFeedback.length, 1);
  assert.equal(
    stored.participantPersonalFeedback[0]?.sessionParticipantId,
    "participant-b",
  );
});

test("persistence-time roster drops removed or reclassified feedback recipients", () => {
  const providerOutput = createMockAnalysisOutput("en");
  providerOutput.participantPersonalFeedback = [
    {
      ...providerOutput.participantPersonalFeedback[0]!,
      sessionParticipantId: "participant-a",
      participantName: "Original name",
    },
  ];

  assert.equal(
    bindParticipantPersonalFeedback(providerOutput, []).participantPersonalFeedback
      .length,
    0,
  );
  assert.equal(
    bindParticipantPersonalFeedback(providerOutput, [
      { id: "participant-a", displayName: "Original name", type: "OBSERVER" },
    ]).participantPersonalFeedback.length,
    0,
  );
  const unchanged = bindParticipantPersonalFeedback(providerOutput, [
    { id: "participant-a", displayName: "Canonical name", type: "PARTICIPANT" },
  ]);
  assert.equal(unchanged.participantPersonalFeedback.length, 1);
  assert.equal(
    unchanged.participantPersonalFeedback[0]?.participantName,
    "Canonical name",
  );
});
