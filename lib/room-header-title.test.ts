import assert from "node:assert/strict";
import test from "node:test";

import { formatRoomHeaderTitle } from "@/lib/room-header-title";

test("formats room label with session title", () => {
  assert.equal(
    formatRoomHeaderTitle({
      roomLabel: "Room A",
      sessionTitle: "Internal resource conflict",
    }),
    "Room A — Internal resource conflict",
  );
});

test("falls back to session title when room label is missing", () => {
  assert.equal(
    formatRoomHeaderTitle({
      roomLabel: null,
      sessionTitle: "Internal resource conflict",
    }),
    "Internal resource conflict",
  );
});

test("falls back to room label when session title is blank", () => {
  assert.equal(
    formatRoomHeaderTitle({
      roomLabel: "Room A",
      sessionTitle: "   ",
    }),
    "Room A",
  );
});

test("avoids duplicate prefix when title already contains label", () => {
  assert.equal(
    formatRoomHeaderTitle({
      roomLabel: "room a",
      sessionTitle: "Room A — Internal resource conflict",
    }),
    "Room A — Internal resource conflict",
  );
});

test("normalizes whitespace before duplicate detection", () => {
  assert.equal(
    formatRoomHeaderTitle({
      roomLabel: "  Room   A ",
      sessionTitle: "Negotiation / room a / final",
    }),
    "Negotiation / room a / final",
  );
});
