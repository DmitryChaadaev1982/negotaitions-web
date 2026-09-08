"use client";

import { useActionState, useCallback, useState } from "react";

import {
  saveParticipantNotes,
  saveAccountParticipantNotes,
  type SaveParticipantNotesState,
} from "@/app/actions/sessions";
import { GradientButton } from "@/components/ui/buttons";
import {
  alertErrorClassName,
  errorClassName,
  inputClassName,
} from "@/components/ui/form-styles";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  areNotesDirty,
  reconcileSavedNotes,
} from "@/lib/participant-notes-state";

type ParticipantNotesPanelProps = {
  initialNotes: string;
  description: string;
  placeholder: string;
  readOnly?: boolean;
} & (
  | { authMode?: "joinToken"; joinToken: string; participantId?: never }
  | { authMode: "account"; participantId: string; joinToken?: never }
);

export function ParticipantNotesPanel({
  initialNotes,
  description,
  placeholder,
  readOnly = false,
  ...authProps
}: ParticipantNotesPanelProps) {
  const { t, tv } = useI18n();

  const saveAction =
    authProps.authMode === "account"
      ? saveAccountParticipantNotes
      : saveParticipantNotes;

  const [draftNotes, setDraftNotes] = useState(initialNotes);
  const [savedNotes, setSavedNotes] = useState(initialNotes);
  const saveNotes = useCallback(
    async (previousState: SaveParticipantNotesState, formData: FormData) => {
      const result = await saveAction(previousState, formData);
      setSavedNotes((currentBaseline) => reconcileSavedNotes(currentBaseline, result));
      return result;
    },
    [saveAction],
  );
  const [state, formAction, isPending] = useActionState<
    SaveParticipantNotesState,
    FormData
  >(saveNotes, {});

  const isDirty = areNotesDirty(draftNotes, savedNotes);
  const showSaved = !isDirty && state.success === true;

  if (readOnly) {
    return (
      <div className="space-y-3">
        <div>
          <p className="mb-2 text-xs text-slate-400">{description}</p>
          <textarea
            id="notes"
            name="notes"
            rows={6}
            value={initialNotes}
            readOnly
            className={inputClassName(false)}
          />
        </div>
        <p className="text-sm text-amber-300">{t("sessions.preparationLockedAfterNegotiation")}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {authProps.authMode === "account" ? (
        <input type="hidden" name="participantId" value={authProps.participantId} />
      ) : (
        <input type="hidden" name="joinToken" value={authProps.joinToken ?? ""} />
      )}
      <div>
        <p className="mb-2 text-xs text-slate-400">{description}</p>
        <textarea
          id="notes"
          name="notes"
          rows={6}
          value={draftNotes}
          onChange={(event) => setDraftNotes(event.target.value)}
          className={inputClassName(!!state.errors?.notes)}
          placeholder={placeholder}
          data-testid="participant-notes-textarea"
        />
        {state.errors?.notes ? (
          <p className={errorClassName}>
            {state.errors.notes.map((message) => tv(message)).join(", ")}
          </p>
        ) : null}
        {state.errors?.form ? (
          <p className={alertErrorClassName}>
            {state.errors.form.map((message) => tv(message)).join(", ")}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <GradientButton type="submit" disabled={isPending} data-testid="participant-notes-save-button">
          {isPending ? t("common.saving") : t("common.saveNotes")}
        </GradientButton>
        {isDirty ? (
          <span className="text-sm text-amber-300" data-testid="participant-notes-unsaved">
            {t("common.unsavedNotes")}
          </span>
        ) : showSaved ? (
          <span className="text-sm text-emerald-300" data-testid="participant-notes-saved">
            {t("common.notesSaved")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
