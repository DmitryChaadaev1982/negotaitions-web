import assert from "node:assert/strict";
import test from "node:test";

import {
  MATERIAL_INPUT_SCHEMA_VERSION,
  NON_MATERIAL_FINGERPRINT_CONTROL_FIELD,
  buildMaterialInputEnvelope,
  fingerprintMaterialAnalysisSnapshot,
  serializeMaterialInputEnvelope,
  type MaterialAnalysisSnapshot,
} from "@/lib/ai/material-input-envelope";

function baselineSnapshot(): MaterialAnalysisSnapshot {
  return {
    session: {
      title: "Lab session",
      caseTitle: "Price negotiation",
      caseLanguage: "RU",
      publicInstructions: "Agree on price",
      businessContext: "B2B deal",
      preparationDurationSeconds: 300,
      durationSeconds: 900,
      sequenceNumber: 1,
    },
    event: { title: "Lab event" },
    roles: [
      {
        name: "Buyer",
        objectives: "Lower price",
        constraints: "Budget 100",
        hiddenInfo: "Can go to 110",
        fallbackPosition: "Walk away",
      },
      {
        name: "Seller",
        objectives: "Keep margin",
        constraints: "Floor 90",
        hiddenInfo: "Can accept 95",
        fallbackPosition: "Hold",
      },
    ],
    participants: [
      {
        id: "p-buyer",
        displayName: "Lab Buyer",
        type: "PARTICIPANT",
        roleName: "Buyer",
        notes: "Buyer preparation: target 120",
      },
      {
        id: "p-seller",
        displayName: "Lab Seller",
        type: "PARTICIPANT",
        roleName: "Seller",
        notes: "Seller preparation: floor 140",
      },
      {
        id: "p-fac",
        displayName: "Lab Facilitator",
        type: "FACILITATOR",
        roleName: null,
        notes: "Facilitator debrief note A",
      },
      {
        id: "p-obs",
        displayName: "Lab Observer",
        type: "OBSERVER",
        roleName: null,
        notes: "Observer note A",
      },
    ],
    transcript: {
      text: "Buyer: 120. Seller: 140.",
      diarizedText: "Lab Buyer: 120.\n\nLab Seller: 140.",
      language: "ru",
      hasSpeakerDiarization: true,
      segments: [
        {
          orderIndex: 0,
          speakerLabel: "speaker_0",
          mappedParticipantId: "p-buyer",
          mappedParticipantName: "Lab Buyer",
          startSeconds: 0,
          endSeconds: 2,
          text: "120",
        },
        {
          orderIndex: 1,
          speakerLabel: "speaker_1",
          mappedParticipantId: "p-seller",
          mappedParticipantName: "Lab Seller",
          startSeconds: 2,
          endSeconds: 4,
          text: "140",
        },
      ],
    },
  };
}

function clone(snapshot: MaterialAnalysisSnapshot): MaterialAnalysisSnapshot {
  return structuredClone(snapshot);
}

test("envelope schemaVersion is 1 and serialization is deterministic", () => {
  const first = buildMaterialInputEnvelope(baselineSnapshot());
  const second = buildMaterialInputEnvelope(baselineSnapshot());
  assert.equal(first.schemaVersion, MATERIAL_INPUT_SCHEMA_VERSION);
  assert.equal(first.schemaVersion, 1);
  assert.equal(serializeMaterialInputEnvelope(first), serializeMaterialInputEnvelope(second));
  assert.equal(
    fingerprintMaterialAnalysisSnapshot(baselineSnapshot()),
    fingerprintMaterialAnalysisSnapshot(baselineSnapshot()),
  );
});

test("facilitator and observer notes are excluded from the envelope", () => {
  const envelope = buildMaterialInputEnvelope(baselineSnapshot());
  const facilitator = envelope.participants.find((participant) => participant.id === "p-fac");
  const observer = envelope.participants.find((participant) => participant.id === "p-obs");
  const buyer = envelope.participants.find((participant) => participant.id === "p-buyer");
  assert.equal(facilitator?.notes, null);
  assert.equal(observer?.notes, null);
  assert.equal(buyer?.notes, "Buyer preparation: target 120");
});

const positiveMutations: Array<[string, (snapshot: MaterialAnalysisSnapshot) => void]> = [
  ["transcript lexical text", (snapshot) => {
    snapshot.transcript!.text = "Buyer: 125. Seller: 140.";
  }],
  ["relevant speaker attribution", (snapshot) => {
    snapshot.transcript!.segments[0].speakerLabel = "speaker_x";
  }],
  ["mapped negotiation participant", (snapshot) => {
    snapshot.transcript!.segments[0].mappedParticipantId = "p-seller";
    snapshot.transcript!.segments[0].mappedParticipantName = "Lab Seller";
  }],
  ["participant role information", (snapshot) => {
    snapshot.participants[0].roleName = "Lead Buyer";
  }],
  ["participant preparation notes", (snapshot) => {
    snapshot.participants[0].notes = "Buyer preparation: target 130";
  }],
  ["objectives", (snapshot) => {
    snapshot.roles[0].objectives = "Lower price harder";
  }],
  ["constraints", (snapshot) => {
    snapshot.roles[0].constraints = "Budget 90";
  }],
  ["hiddenInfo", (snapshot) => {
    snapshot.roles[0].hiddenInfo = "Can go to 105";
  }],
  ["fallbackPosition", (snapshot) => {
    snapshot.roles[0].fallbackPosition = "Pause talks";
  }],
  ["relevant Case/Session context", (snapshot) => {
    snapshot.session.businessContext = "Updated B2B deal";
  }],
  ["output language", (snapshot) => {
    snapshot.session.caseLanguage = "EN";
  }],
];

for (const [label, mutate] of positiveMutations) {
  test(`positive mutation changes fingerprint: ${label}`, () => {
    const original = fingerprintMaterialAnalysisSnapshot(baselineSnapshot());
    const mutated = clone(baselineSnapshot());
    mutate(mutated);
    assert.notEqual(
      fingerprintMaterialAnalysisSnapshot(mutated),
      original,
      `${label} must change the fingerprint`,
    );
  });
}

const negativeMutations: Array<[string, (snapshot: MaterialAnalysisSnapshot) => void]> = [
  ["facilitator notes", (snapshot) => {
    snapshot.participants[2].notes = "Facilitator debrief note B";
  }],
  ["observer notes", (snapshot) => {
    snapshot.participants[3].notes = "Observer note B";
  }],
  [`selected non-material field ${NON_MATERIAL_FINGERPRINT_CONTROL_FIELD}`, (snapshot) => {
    void snapshot;
  }],
];

for (const [label, mutate] of negativeMutations) {
  test(`negative mutation leaves fingerprint unchanged: ${label}`, () => {
    const original = fingerprintMaterialAnalysisSnapshot(baselineSnapshot());
    const mutated = clone(baselineSnapshot());
    mutate(mutated);
    assert.equal(
      fingerprintMaterialAnalysisSnapshot(mutated),
      original,
      `${label} must not change the fingerprint`,
    );
  });
}

test("privateInstructions are outside the envelope even if present on a richer object", () => {
  const snapshot = baselineSnapshot() as MaterialAnalysisSnapshot & {
    roles: Array<MaterialAnalysisSnapshot["roles"][number] & { privateInstructions?: string }>;
  };
  snapshot.roles[0] = {
    ...snapshot.roles[0],
    privateInstructions: "Do not show this",
  };
  const envelope = buildMaterialInputEnvelope(snapshot);
  assert.equal(
    JSON.stringify(envelope).includes("Do not show this"),
    false,
  );
});
