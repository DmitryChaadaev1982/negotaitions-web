export type NotesSaveResult = {
  success?: boolean;
  notes?: string;
};

/**
 * Advances a caller-owned persisted baseline only after a successful action.
 * The caller keeps its current draft independent so edits made while a save is
 * pending remain visible and dirty when they differ from this baseline.
 */
export function reconcileSavedNotes(
  savedBaseline: string,
  result: NotesSaveResult,
): string {
  return result.success === true && typeof result.notes === "string"
    ? result.notes
    : savedBaseline;
}

/**
 * Canonicalize line endings for Notes semantic equality only.
 * Persistence and live-draft bytes stay unchanged.
 */
function canonicalizeNotes(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function areNotesDirty(currentDraft: string, savedBaseline: string): boolean {
  return canonicalizeNotes(currentDraft) !== canonicalizeNotes(savedBaseline);
}
