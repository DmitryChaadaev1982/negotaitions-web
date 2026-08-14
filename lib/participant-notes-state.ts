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

export function areNotesDirty(currentDraft: string, savedBaseline: string): boolean {
  return currentDraft !== savedBaseline;
}
