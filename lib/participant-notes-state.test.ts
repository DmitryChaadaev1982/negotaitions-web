import assert from "node:assert/strict";
import test from "node:test";

import {
  areNotesDirty,
  reconcileSavedNotes,
} from "@/lib/participant-notes-state";

test("notes become clean only when the current draft matches a successful saved baseline", () => {
  let savedBaseline = "";
  const currentDraft = "Prepared opening position";

  assert.equal(areNotesDirty(currentDraft, savedBaseline), true);

  savedBaseline = reconcileSavedNotes(savedBaseline, {
    success: true,
    notes: currentDraft,
  });

  assert.equal(savedBaseline, currentDraft);
  assert.equal(areNotesDirty(currentDraft, savedBaseline), false);
  assert.equal(areNotesDirty("Updated opening position", savedBaseline), true);
});

test("failed saves do not advance the saved baseline", () => {
  const savedBaseline = "Saved notes";

  assert.equal(
    reconcileSavedNotes(savedBaseline, { success: false, notes: "Unsaved changed draft" }),
    savedBaseline,
  );
  assert.equal(areNotesDirty("New draft", savedBaseline), true);
});

test("a successful in-flight save preserves a newer draft as dirty", () => {
  const savedBaseline = "Original";
  const draftSubmittedForSave = "First edit";
  const newerCurrentDraft = "Second edit";

  const updatedBaseline = reconcileSavedNotes(savedBaseline, {
    success: true,
    notes: draftSubmittedForSave,
  });

  assert.equal(updatedBaseline, draftSubmittedForSave);
  assert.equal(areNotesDirty(newerCurrentDraft, updatedBaseline), true);
});

test("LF draft is not dirty against a CRLF saved baseline", () => {
  assert.equal(areNotesDirty("line1\nline2", "line1\r\nline2"), false);
});

test("LF draft is not dirty against a CR-only saved baseline", () => {
  assert.equal(areNotesDirty("line1\nline2", "line1\rline2"), false);
});

test("equal single-line notes are not dirty", () => {
  assert.equal(areNotesDirty("same line", "same line"), false);
});

test("genuinely different notes remain dirty", () => {
  assert.equal(areNotesDirty("line1\nline2", "line1\nline2 changed"), true);
});

test("newline canonicalization does not hide a newer in-flight edit", () => {
  const savedBaseline = reconcileSavedNotes("", {
    success: true,
    notes: "line1\r\nline2",
  });

  assert.equal(savedBaseline, "line1\r\nline2");
  assert.equal(areNotesDirty("line1\nline2", savedBaseline), false);
  assert.equal(areNotesDirty("line1\nline2X", savedBaseline), true);
});
