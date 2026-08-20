import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  projectPostNegotiationParticipantPreparationNotes,
  resolveDebriefVisibleNotes,
  type DebriefVisibleNotesParticipant,
} from "@/lib/debrief-visible-notes";

const baseDate = new Date("2026-08-02T10:00:00.000Z");

function participant(
  overrides: Partial<DebriefVisibleNotesParticipant> & { id: string },
): DebriefVisibleNotesParticipant {
  return {
    id: overrides.id,
    userId: overrides.userId ?? `user-${overrides.id}`,
    displayName: overrides.displayName ?? overrides.id,
    type: overrides.type ?? ParticipantType.PARTICIPANT,
    notes: overrides.notes ?? `${overrides.id} notes`,
    updatedAt: overrides.updatedAt ?? baseDate,
    sessionRole: overrides.sessionRole ?? null,
  };
}

const participantA = participant({
  id: "participant-a",
  displayName: "Participant A",
  sessionRole: { name: "Buyer", sortOrder: 0 },
});
const participantB = participant({
  id: "participant-b",
  displayName: "Participant B",
  sessionRole: { name: "Seller", sortOrder: 1 },
});
const observer = participant({
  id: "observer",
  displayName: "Observer",
  type: ParticipantType.OBSERVER,
  notes: "observer notes",
});
const otherObserver = participant({
  id: "other-observer",
  displayName: "Other Observer",
  type: ParticipantType.OBSERVER,
  notes: "other observer notes",
});
const invitedParticipant = participant({
  id: "participant-c",
  displayName: "Invited Participant",
  notes: "invited participant note",
  sessionRole: null,
});
const facilitator = participant({
  id: "facilitator",
  displayName: "Facilitator",
  type: ParticipantType.FACILITATOR,
  notes: "facilitator notes",
});

test("participant sees only own debrief notes", () => {
  const notes = resolveDebriefVisibleNotes({
    roomLifecycle: "DEBRIEF_OPEN",
    viewerParticipantId: participantA.id,
    viewerType: ParticipantType.PARTICIPANT,
    participants: [participantA, participantB, observer, facilitator],
  });

  assert.deepEqual(notes.map((note) => note.displayName), ["Participant A"]);
});

test("observer sees all negotiation-participant notes plus own notes only", () => {
  const notes = resolveDebriefVisibleNotes({
    roomLifecycle: "DEBRIEF_OPEN",
    viewerParticipantId: observer.id,
    viewerType: ParticipantType.OBSERVER,
    participants: [
      participantB,
      observer,
      otherObserver,
      participantA,
      invitedParticipant,
      facilitator,
    ],
  });

  assert.deepEqual(notes.map((note) => note.displayName), [
    "Participant A",
    "Participant B",
    "Invited Participant",
    "Observer",
  ]);
});

test("facilitator sees participant A, participant B, and own notes only", () => {
  const notes = resolveDebriefVisibleNotes({
    roomLifecycle: "DEBRIEF_OPEN",
    viewerParticipantId: facilitator.id,
    viewerType: ParticipantType.FACILITATOR,
    participants: [participantA, participantB, observer, facilitator],
  });

  assert.deepEqual(notes.map((note) => note.displayName), [
    "Participant A",
    "Participant B",
    "Facilitator",
  ]);
});

test("post-meeting participant projection is own-notes-only for a participant viewer", () => {
  const notes = projectPostNegotiationParticipantPreparationNotes(
    resolveDebriefVisibleNotes({
      roomLifecycle: "OPEN",
      negotiationState: "FINISHED",
      viewerParticipantId: participantA.id,
      viewerType: ParticipantType.PARTICIPANT,
      participants: [participantA, participantB, observer, facilitator],
    }),
  );
  assert.deepEqual(notes.map((note) => note.notes), [participantA.notes]);
});

test("post-meeting participant projection includes all participant notes for facilitator and observer", () => {
  const facilitatorNotes = projectPostNegotiationParticipantPreparationNotes(
    resolveDebriefVisibleNotes({
      roomLifecycle: "OPEN",
      negotiationState: "FINISHED",
      viewerParticipantId: facilitator.id,
      viewerType: ParticipantType.FACILITATOR,
      participants: [participantA, participantB, invitedParticipant, observer, facilitator],
    }),
  );
  const observerNotes = projectPostNegotiationParticipantPreparationNotes(
    resolveDebriefVisibleNotes({
      roomLifecycle: "OPEN",
      negotiationState: "FINISHED",
      viewerParticipantId: observer.id,
      viewerType: ParticipantType.OBSERVER,
      participants: [participantA, participantB, invitedParticipant, observer, facilitator],
    }),
  );
  assert.deepEqual(
    facilitatorNotes.map((note) => note.notes),
    [participantA.notes, participantB.notes, invitedParticipant.notes],
  );
  assert.deepEqual(
    observerNotes.map((note) => note.notes),
    [participantA.notes, participantB.notes, invitedParticipant.notes],
  );
});

test("FINISHED negotiation reveals notes even without DEBRIEF_OPEN", () => {
  const notes = resolveDebriefVisibleNotes({
    roomLifecycle: "OPEN",
    negotiationState: "FINISHED",
    viewerParticipantId: facilitator.id,
    viewerType: ParticipantType.FACILITATOR,
    participants: [participantA, participantB, facilitator],
  });
  assert.deepEqual(notes.map((note) => note.displayName), [
    "Participant A",
    "Participant B",
    "Facilitator",
  ]);
});

test("empty notes and non-debrief state return no visible notes", () => {
  assert.deepEqual(
    resolveDebriefVisibleNotes({
      roomLifecycle: "DEBRIEF_OPEN",
      viewerParticipantId: "empty",
      viewerType: ParticipantType.PARTICIPANT,
      participants: [participant({ id: "empty", notes: "   " })],
    }),
    [],
  );
  assert.deepEqual(
    resolveDebriefVisibleNotes({
      roomLifecycle: "OPEN",
      viewerParticipantId: participantA.id,
      viewerType: ParticipantType.PARTICIPANT,
      participants: [participantA],
    }),
    [],
  );
});

test("role overlap deduplicates by user owner", () => {
  const duplicateObserver = participant({
    id: "observer-overlap",
    userId: participantA.userId,
    displayName: "Participant A as Observer",
    type: ParticipantType.OBSERVER,
    notes: "duplicate note",
  });

  const notes = resolveDebriefVisibleNotes({
    roomLifecycle: "DEBRIEF_OPEN",
    viewerParticipantId: duplicateObserver.id,
    viewerType: ParticipantType.OBSERVER,
    participants: [participantA, participantB, duplicateObserver],
  });

  assert.deepEqual(notes.map((note) => note.displayName), [
    "Participant A",
    "Participant B",
  ]);
});
