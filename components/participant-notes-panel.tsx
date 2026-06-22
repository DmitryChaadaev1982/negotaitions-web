"use client";

import { useActionState, useState } from "react";

import {
  saveParticipantNotes,
  type SaveParticipantNotesState,
} from "@/app/actions/sessions";
import { GradientButton } from "@/components/ui/buttons";
import {
  alertErrorClassName,
  errorClassName,
  inputClassName,
} from "@/components/ui/form-styles";
import { useI18n } from "@/lib/i18n/useI18n";

type ParticipantNotesPanelProps = {
  joinToken: string;
  initialNotes: string;
  description: string;
  placeholder: string;
};

export function ParticipantNotesPanel({
  joinToken,
  initialNotes,
  description,
  placeholder,
}: ParticipantNotesPanelProps) {
  const { t, tv } = useI18n();
  const [state, formAction, isPending] = useActionState<
    SaveParticipantNotesState,
    FormData
  >(saveParticipantNotes, { notes: initialNotes });

  const savedNotes = state.notes ?? initialNotes;
  const [draftNotes, setDraftNotes] = useState(initialNotes);

  const isDirty = draftNotes !== savedNotes;
  const showSaved =
    !isDirty && (savedNotes.length > 0 || state.success === true);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="joinToken" value={joinToken} />
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
        <GradientButton type="submit" disabled={isPending}>
          {isPending ? t("common.saving") : t("common.saveNotes")}
        </GradientButton>
        {isDirty ? (
          <span className="text-sm text-amber-300">{t("common.unsavedNotes")}</span>
        ) : showSaved ? (
          <span className="text-sm text-emerald-300">{t("common.notesSaved")}</span>
        ) : null}
      </div>
    </form>
  );
}
