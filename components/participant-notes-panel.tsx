"use client";

import { useActionState, useState } from "react";

import {
  saveParticipantNotes,
  type SaveParticipantNotesState,
} from "@/app/actions/sessions";

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
        <p className="mb-2 text-xs text-slate-500">{description}</p>
        <textarea
          id="notes"
          name="notes"
          rows={6}
          value={draftNotes}
          onChange={(event) => setDraftNotes(event.target.value)}
          className={`block w-full rounded-md border px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 ${
            state.errors?.notes
              ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/20"
              : "border-slate-300 focus:border-slate-500 focus:ring-slate-500/20"
          }`}
          placeholder={placeholder}
        />
        {state.errors?.notes ? (
          <p className="mt-1.5 text-sm text-rose-600">
            {state.errors.notes.join(", ")}
          </p>
        ) : null}
        {state.errors?.form ? (
          <p className="mt-1.5 text-sm text-rose-600">
            {state.errors.form.join(", ")}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save notes"}
        </button>
        {isDirty ? (
          <span className="text-sm text-amber-600">Unsaved notes</span>
        ) : showSaved ? (
          <span className="text-sm text-emerald-600">Notes saved.</span>
        ) : null}
      </div>
    </form>
  );
}
