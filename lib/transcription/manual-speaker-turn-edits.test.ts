import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildInitialManualTurnsFromPersistedSegments,
  createEmptyManualSpeakerTurn,
  insertManualSpeakerTurnAfter,
  toManualSpeakerTurnFromPersistedSegment,
  toSubmittedManualSpeakerTurns,
  type ManualSpeakerTurnEdit,
} from "@/lib/transcription/manual-speaker-turn-edits";

function turn(
  overrides: Partial<ManualSpeakerTurnEdit> & Pick<ManualSpeakerTurnEdit, "id">,
): ManualSpeakerTurnEdit {
  return {
    sourceSegmentId: null,
    participantId: "",
    text: "",
    startSeconds: 1,
    endSeconds: 2,
    speakerLabel: "spk_0",
    displaySpeakerLabel: "Speaker 1",
    speakerSlot: "1",
    ...overrides,
  };
}

test("B01 transcript editor no longer exposes a global Add turn control", () => {
  const source = readFileSync(
    join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  assert.doesNotMatch(source, /appendManualSpeakerTurn/);
  assert.doesNotMatch(source, /recording\.addManualSpeakerTurn/);
  assert.match(source, /insertManualSpeakerTurnAfter/);
  assert.match(source, /insert-manual-speaker-turn-after/);
});

test("B02 Insert after first places the new turn at index 1", () => {
  const existing = [
    turn({ id: "t1", participantId: "p1", text: "first" }),
    turn({ id: "t2", participantId: "p2", text: "second" }),
  ];

  const next = insertManualSpeakerTurnAfter(existing, 0);

  assert.equal(next.length, 3);
  assert.equal(next[0]?.id, "t1");
  assert.equal(next[1]?.text, "");
  assert.equal(next[1]?.startSeconds, null);
  assert.equal(next[2]?.id, "t2");
});

test("B03 Insert in middle preserves surrounding order", () => {
  const existing = [
    turn({ id: "t1", text: "one" }),
    turn({ id: "t2", text: "two" }),
    turn({ id: "t3", text: "three" }),
  ];

  const next = insertManualSpeakerTurnAfter(existing, 1);

  assert.deepEqual(
    next.map((item) => item.id === next[2]?.id ? "inserted" : item.text),
    ["one", "two", "inserted", "three"],
  );
});

test("B04 Insert after last is a valid end position", () => {
  const existing = [
    turn({ id: "t1", text: "one" }),
    turn({ id: "t2", text: "two" }),
  ];

  const next = insertManualSpeakerTurnAfter(existing, 1);

  assert.equal(next.length, 3);
  assert.equal(next[0]?.id, "t1");
  assert.equal(next[1]?.id, "t2");
  assert.equal(next[2]?.text, "");
  assert.equal(next[2]?.startSeconds, null);
  assert.equal(next[2]?.endSeconds, null);
});

test("B05 neighboring text and speaker data stay unchanged", () => {
  const existing = [
    turn({
      id: "t1",
      participantId: "p1",
      text: "hello",
      speakerLabel: "spk_0",
      displaySpeakerLabel: "Buyer",
      startSeconds: 4,
      endSeconds: 8,
    }),
    turn({
      id: "t2",
      participantId: "p2",
      text: "world",
      speakerLabel: "spk_1",
      displaySpeakerLabel: "Seller",
      startSeconds: 9,
      endSeconds: 12,
    }),
  ];

  const next = insertManualSpeakerTurnAfter(existing, 0);

  assert.deepEqual(next[0], existing[0]);
  assert.deepEqual(next[2], existing[1]);
  assert.equal(next[1]?.participantId, "");
  assert.equal(next[1]?.text, "");
  assert.equal(next[1]?.speakerLabel, null);
  assert.equal(next[1]?.speakerSlot, null);
});

test("B06 submitted turns preserve visual order for server orderIndex rewrite", () => {
  const existing = [
    turn({
      id: "t1",
      sourceSegmentId: "t1",
      participantId: "p1",
      text: "first",
      startSeconds: 0,
      endSeconds: 1,
    }),
    turn({
      id: "t2",
      sourceSegmentId: "t2",
      participantId: "p2",
      text: "third",
      startSeconds: 4,
      endSeconds: 5,
    }),
  ];
  const withInsert = insertManualSpeakerTurnAfter(existing, 0).map((item, index) =>
    index === 1
      ? { ...item, participantId: "p3", text: "second" }
      : item,
  );

  const submitted = toSubmittedManualSpeakerTurns(withInsert);

  assert.deepEqual(
    submitted.map((item) => item.text),
    ["first", "second", "third"],
  );
  assert.deepEqual(
    submitted.map((item) => item.participantId),
    ["p1", "p3", "p2"],
  );
  assert.deepEqual(
    submitted.map((item) => item.id),
    ["t1", undefined, "t2"],
  );
});

test("persisted segments submit stable ids and new inserts omit identity", () => {
  const persisted = toManualSpeakerTurnFromPersistedSegment({
    id: "seg-existing",
    mappedParticipantId: "p1",
    text: "raw A",
    startSeconds: 0,
    endSeconds: 1,
    speakerLabel: "spk_0",
  });
  assert.equal(persisted.id, "seg-existing");
  assert.equal(persisted.sourceSegmentId, "seg-existing");
  const inserted = createEmptyManualSpeakerTurn();
  assert.equal(inserted.sourceSegmentId, null);
  const submitted = toSubmittedManualSpeakerTurns([
    persisted,
    { ...inserted, participantId: "p2", text: "manual insert" },
  ]);
  assert.equal(submitted[0]?.id, "seg-existing");
  assert.equal(submitted[1]?.id, undefined);
});

test("empty manual turn factory matches insert-after semantics", () => {
  const empty = createEmptyManualSpeakerTurn();
  assert.equal(empty.text, "");
  assert.equal(empty.participantId, "");
  assert.equal(empty.startSeconds, null);
  assert.equal(empty.endSeconds, null);
  assert.equal(empty.speakerLabel, null);
  assert.equal(empty.displaySpeakerLabel, null);
  assert.equal(empty.speakerSlot, null);
  assert.equal(empty.sourceSegmentId, null);
});

test("empty or whitespace existing segments still submit their stable ids", () => {
  const turns = buildInitialManualTurnsFromPersistedSegments([
    {
      id: "seg-keep",
      mappedParticipantId: "p1",
      text: "enhanced one",
      startSeconds: 0,
      endSeconds: 1,
      speakerLabel: "spk_0",
      orderIndex: 0,
    },
    {
      id: "seg-ws",
      mappedParticipantId: "p2",
      text: "   \n",
      startSeconds: 1,
      endSeconds: 2,
      speakerLabel: "spk_1",
      orderIndex: 1,
    },
    {
      id: "seg-raw",
      mappedParticipantId: "p1",
      text: "raw three",
      startSeconds: 2,
      endSeconds: 3,
      speakerLabel: "spk_0",
      orderIndex: 2,
    },
  ]);
  assert.equal(turns.length, 3);
  assert.equal(turns[1]?.text, "   \n");
  const submitted = toSubmittedManualSpeakerTurns(turns);
  assert.deepEqual(
    submitted.map((item) => item.id),
    ["seg-keep", "seg-ws", "seg-raw"],
  );
  assert.equal(submitted[1]?.text, "   \n");
});

test("manual speaker editor uses shared insert-after helper for new turns", () => {
  const source = readFileSync(
    join(process.cwd(), "components/recording-transcription-section.tsx"),
    "utf8",
  );
  assert.match(source, /insertManualSpeakerTurnAfter/);
  assert.match(source, /toSubmittedManualSpeakerTurns/);
  assert.match(source, /buildInitialManualTurnsFromPersistedSegments/);
  assert.match(source, /insert-manual-speaker-turn-after/);
});
