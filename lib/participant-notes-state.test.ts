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
