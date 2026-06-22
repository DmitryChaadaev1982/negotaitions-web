"use client";

import { useEffect, useId } from "react";

import type { ParticipantNoteEntry } from "@/lib/participant-notes-types";
import { formatDateFromIso } from "@/lib/format-date";
import { useI18n } from "@/lib/i18n/useI18n";
import { SecondaryButton } from "@/components/ui/buttons";
import { cn } from "@/lib/cn";

export type ParticipantNotesModalParticipant = {
  id: string;
  displayName: string;
  type: string;
  caseRoleName: string | null;
};

type ParticipantNotesModalProps = {
  open: boolean;
  participant: ParticipantNotesModalParticipant | null;
  notes: ParticipantNoteEntry[];
  onClose: () => void;
  className?: string;
};

function NoteCard({ note }: { note: ParticipantNoteEntry }) {
  const { t, locale } = useI18n();

  return (
    <article className="rounded-lg border border-slate-700/50 bg-slate-900/70 p-4">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          {t("sessions.noteCreatedAt")}:{" "}
          {formatDateFromIso(note.updatedAt, t("common.notYet"), locale)}
        </span>
        {note.timestampSeconds != null ? (
          <span>
            {t("sessions.noteTimestamp")}: {note.timestampSeconds}s
          </span>
        ) : null}
        {note.category ? (
          <span>
            {t("sessions.noteCategory")}: {note.category}
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
        {note.text}
      </p>
    </article>
  );
}

export function ParticipantNotesModal({
  open,
  participant,
  notes,
  onClose,
  className,
}: ParticipantNotesModalProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || !participant) {
    return null;
  }

  const typeLabel = t(
    `participantType.${participant.type}` as `participantType.PARTICIPANT`,
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm"
        aria-label={t("common.cancel")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          "relative flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700/60 bg-slate-900/95 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30",
          className,
        )}
      >
        <div className="border-b border-slate-700/50 px-6 py-5">
          <h2 id={titleId} className="text-lg font-semibold text-slate-50">
            {t("sessions.participantNotes")}
          </h2>
          <div id={descriptionId} className="mt-2 space-y-1 text-sm text-slate-400">
            <p>
              <span className="font-medium text-slate-200">
                {participant.displayName}
              </span>
              {" · "}
              {typeLabel}
              {participant.caseRoleName ? (
                <>
                  {" · "}
                  {participant.caseRoleName}
                </>
              ) : null}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-5">
          {notes.length === 0 ? (
            <p className="text-sm text-slate-400">
              {t("sessions.participantNoNotesYet")}
            </p>
          ) : (
            notes.map((note) => (
              <NoteCard key={`${note.updatedAt}-${note.text}`} note={note} />
            ))
          )}
        </div>

        <div className="border-t border-slate-700/50 px-6 py-4">
          <div className="flex justify-end">
            <SecondaryButton type="button" onClick={onClose}>
              {t("common.cancel")}
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
