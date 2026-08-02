import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  resolveSpeakerMappingCandidates,
  resolveSpeakerMappingEvidenceInterval,
  type SpeakerMappingConnectionRow,
  type SpeakerMappingParticipantRow,
} from "@/lib/transcription/speaker-mapping-candidates";

const recordingStart = new Date("2026-08-02T10:00:00.000Z");
const recordingEnd = new Date("2026-08-02T10:20:00.000Z");
const interval = { start: recordingStart, end: recordingEnd };

function participant(
  id: string,
  userId: string | null,
  type = ParticipantType.PARTICIPANT,
): SpeakerMappingParticipantRow {
  return {
    id,
    userId,
    displayName: id,
    type,
    createdAt: new Date("2026-08-02T09:00:00.000Z"),
    sessionRole:
      type === ParticipantType.PARTICIPANT
        ? { name: id.includes("a") ? "Buyer" : "Seller", sortOrder: id.includes("a") ? 0 : 1 }
        : null,
  };
}

function connection(
  userId: string,
  overrides: Partial<SpeakerMappingConnectionRow> = {},
): SpeakerMappingConnectionRow {
  return {
    userId,
    createdAt: overrides.createdAt ?? new Date("2026-08-02T09:55:00.000Z"),
    expiresAt: overrides.expiresAt ?? new Date("2026-08-02T10:25:00.000Z"),
    disconnectedAt: overrides.disconnectedAt ?? null,
    supersededAt: overrides.supersededAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
  };
}

test("filters invited-never-connected users and includes roles that overlapped recording", () => {
  const candidates = resolveSpeakerMappingCandidates({
    interval,
    participants: [
      participant("participant-a", "user-a"),
      participant("participant-b", "user-b"),
      participant("observer", "user-observer", ParticipantType.OBSERVER),
      participant("facilitator", "user-facilitator", ParticipantType.FACILITATOR),
      participant("invited", "user-invited"),
    ],
    connections: [
      connection("user-a"),
      connection("user-b", { disconnectedAt: new Date("2026-08-02T10:05:00.000Z") }),
      connection("user-observer"),
      connection("user-facilitator"),
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.displayName), [
    "participant-a",
    "participant-b",
    "facilitator",
    "observer",
  ]);
});

test("deduplicates reconnect rows by user", () => {
  const candidates = resolveSpeakerMappingCandidates({
    interval,
    participants: [participant("participant-a", "user-a")],
    connections: [
      connection("user-a", { disconnectedAt: new Date("2026-08-02T10:02:00.000Z") }),
      connection("user-a", { createdAt: new Date("2026-08-02T10:03:00.000Z") }),
    ],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.sessionParticipantId, "participant-a");
});

test("excludes connections outside the recording interval", () => {
  const candidates = resolveSpeakerMappingCandidates({
    interval,
    participants: [
      participant("before", "user-before"),
      participant("after", "user-after"),
      participant("during", "user-during"),
    ],
    connections: [
      connection("user-before", {
        createdAt: new Date("2026-08-02T09:00:00.000Z"),
        disconnectedAt: new Date("2026-08-02T09:59:00.000Z"),
      }),
      connection("user-after", {
        createdAt: new Date("2026-08-02T10:21:00.000Z"),
        expiresAt: new Date("2026-08-02T10:30:00.000Z"),
      }),
      connection("user-during", {
        createdAt: new Date("2026-08-02T10:19:00.000Z"),
        expiresAt: new Date("2026-08-02T10:30:00.000Z"),
      }),
    ],
  });

  assert.deepEqual(candidates.map((candidate) => candidate.displayName), ["during"]);
});

test("uses recording interval before session or transcript fallback", () => {
  const resolved = resolveSpeakerMappingEvidenceInterval({
    recordingStartedAt: recordingStart,
    recordingEndedAt: recordingEnd,
    negotiationStartedAt: new Date("2026-08-02T09:00:00.000Z"),
    negotiationEndedAt: new Date("2026-08-02T11:00:00.000Z"),
  });

  assert.deepEqual(resolved, interval);
});
