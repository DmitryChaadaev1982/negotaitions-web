"use client";

import { useActionState, useState } from "react";

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

type ParticipantNotesPanelProps = {
  initialNotes: string;
  description: string;
  placeholder: string;
} & (
  | { authMode?: "joinToken"; joinToken: string; participantId?: never }
  | { authMode: "account"; participantId: string; joinToken?: never }
);

export function ParticipantNotesPanel({
  initialNotes,
  description,
  placeholder,
  ...authProps
}: ParticipantNotesPanelProps) {
  const { t, tv } = useI18n();

  const saveAction =
    authProps.authMode === "account"
      ? saveAccountParticipantNotes
      : saveParticipantNotes;

  const [state, formAction, isPending] = useActionState<
    SaveParticipantNotesState,
    FormData
  >(saveAction, { notes: initialNotes });

  const savedNotes = state.notes ?? initialNotes;
  const [draftNotes, setDraftNotes] = useState(initialNotes);

  const isDirty = draftNotes !== savedNotes;
  const showSaved =
    !isDirty && (savedNotes.length > 0 || state.success === true);

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
