"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Badge } from "@/components/badge";
import { PageHeader } from "@/components/page-header";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { GradientButtonLink, SecondaryButtonLink } from "@/components/ui/buttons";
import {
  saveAccountParticipantNotes,
  type SaveParticipantNotesState,
} from "@/app/actions/sessions";
import { useI18n } from "@/lib/i18n/useI18n";
import type { AccountMaterialsData, AccountMaterialsRole } from "@/lib/account-session-materials";

type Props = AccountMaterialsData;

function participantTypeBadgeVariant(
  type: "FACILITATOR" | "PARTICIPANT" | "OBSERVER",
): "info" | "default" | "success" {
  if (type === "FACILITATOR") return "info";
  if (type === "OBSERVER") return "success";
  return "default";
}

function RecordingSection({
  recording,
}: {
  recording: AccountMaterialsData["recording"];
}) {
  const { t } = useI18n();

  if (!recording) {
    return (
      <p className="text-sm text-slate-500">{t("recording.noRecordingYet")}</p>
    );
  }

  const isReady = recording.status === "COMPLETED";
  const isFailed = recording.status === "FAILED";
  const isProcessing =
    recording.status === "PROCESSING" || recording.status === "STOPPED";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className={
            isReady
              ? "text-sm font-medium text-emerald-400"
              : isFailed
                ? "text-sm font-medium text-rose-400"
                : isProcessing
                  ? "text-sm font-medium text-amber-400"
                  : "text-sm text-slate-400"
          }
        >
          {isReady
            ? t("sessionMaterials.recordingReady")
            : isFailed
              ? t("sessionMaterials.recordingFailed")
              : isProcessing
                ? t("sessionMaterials.recordingProcessing")
                : recording.status}
        </span>
      </div>
      {isReady && recording.fileUrl ? (
        <a
          href={recording.fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-cyan-400 hover:text-cyan-300 underline"
          data-testid="materials-recording-download"
        >
          {t("sessionMaterials.downloadRecording")}
        </a>
      ) : null}
      {isFailed && recording.errorMessage ? (
        <p className="text-xs text-rose-400">{recording.errorMessage}</p>
      ) : null}
    </div>
  );
}

function TranscriptSection({
  transcript,
}: {
  transcript: AccountMaterialsData["transcript"];
}) {
  const { t } = useI18n();

  if (!transcript) {
    return (
      <p className="text-sm text-slate-500">{t("recording.noTranscriptYet")}</p>
    );
  }

  const text = transcript.diarizedText ?? transcript.text;

  return (
    <div className="space-y-2">
      {text ? (
        <pre
          className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-900/60 p-4 text-xs text-slate-300 ring-1 ring-inset ring-slate-700/40"
          data-testid="materials-transcript-text"
        >
          {text}
        </pre>
      ) : (
        <p className="text-sm text-slate-500">{t("recording.noTranscriptYet")}</p>
      )}
    </div>
  );
}

function RoleBriefingSection({ role }: { role: AccountMaterialsRole }) {
  const { t } = useI18n();

  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold text-slate-200">{role.name}</p>
      {role.privateInstructions ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("cases.privateInstructions")}
          </p>
          <p className="text-slate-300">{role.privateInstructions}</p>
        </div>
      ) : null}
      {role.objectives ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("cases.objectives")}
          </p>
          <p className="text-slate-300">{role.objectives}</p>
        </div>
      ) : null}
      {role.constraints ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("cases.constraints")}
          </p>
          <p className="text-slate-300">{role.constraints}</p>
        </div>
      ) : null}
      {role.hiddenInfo ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("cases.hiddenInfo")}
          </p>
          <p className="text-slate-300">{role.hiddenInfo}</p>
        </div>
      ) : null}
      {role.fallbackPosition ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("cases.fallbackPosition")}
          </p>
          <p className="text-slate-300">{role.fallbackPosition}</p>
        </div>
      ) : null}
    </div>
  );
}

function NotesForm({
  participantId,
  initialNotes,
  variant,
}: {
  participantId: string;
  initialNotes: string;
  variant: "preparation" | "observer" | "facilitator";
}) {
  const { t } = useI18n();
  const [state, formAction, isPending] = useActionState<
    SaveParticipantNotesState,
    FormData
  >(saveAccountParticipantNotes, {});

  const placeholder =
    variant === "facilitator"
      ? t("join.facilitatorNotesPlaceholder")
      : variant === "observer"
        ? t("join.observerNotesPlaceholder")
        : t("join.preparationPlaceholder");

  return (
    <form action={formAction} className="space-y-3">
      {/* participantId is a non-secret DB record id — safe as a form field */}
      <input type="hidden" name="participantId" value={participantId} />
      <textarea
        name="notes"
        rows={6}
        className="w-full rounded-lg bg-slate-900/60 px-3 py-2 text-sm text-slate-200 ring-1 ring-inset ring-slate-700/40 placeholder:text-slate-600 focus:outline-none focus:ring-cyan-500/60"
        placeholder={placeholder}
        defaultValue={state.notes ?? initialNotes}
        data-testid="materials-notes-textarea"
      />
      {state.errors?.form ? (
        <p className="text-xs text-rose-400">{state.errors.form[0]}</p>
      ) : null}
      {state.success ? (
        <p className="text-xs text-emerald-400">{t("common.notesSaved")}</p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-300 ring-1 ring-inset ring-cyan-500/25 hover:bg-cyan-500/25 disabled:opacity-50"
        data-testid="materials-notes-save-button"
      >
        {isPending ? t("common.loading") : t("common.saveNotes")}
      </button>
    </form>
  );
}

/**
 * Account-authorized materials view — rendered without joinToken in any props.
 * Access was validated server-side by userId relation before this component is
 * mounted. participantId (a non-secret DB id) is used for notes persistence.
 */
export function AccountSessionMaterialsView({
  participantId,
  participantType,
  displayName,
  notes,
  caseRole,
  session,
  event,
  assignedParticipants,
  recording,
  transcript,
  roomUrl,
  notesVariant,
}: Props) {
  const { t } = useI18n();

  const isActive =
    session.negotiationState !== "FINISHED" && !session.closedByEvent;

  const notesSectionTitle =
    notesVariant === "facilitator"
      ? t("join.facilitatorNotes")
      : notesVariant === "observer"
        ? t("join.observerNotes")
        : t("join.preparation");

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8" data-testid="account-materials-page">
      <PageHeader
        title={session.title}
        description={session.caseTitle}
        action={
          <div className="flex flex-wrap gap-2">
            {isActive ? (
              <GradientButtonLink href={roomUrl} data-testid="materials-open-room-button">
                {t("dashboard.openRoom")}
              </GradientButtonLink>
            ) : null}
            {event ? (
              <SecondaryButtonLink href={event.lobbyUrl}>
                {t("events.openLobby")}
              </SecondaryButtonLink>
            ) : null}
            <SecondaryButtonLink href="/sessions">
              {t("nav.sessions")}
            </SecondaryButtonLink>
          </div>
        }
      />

      {/* Session status bar */}
      <GlassCard>
        <GlassCardContent className="flex flex-wrap items-center gap-4 py-4">
          <div className="flex items-center gap-2">
            <Badge variant={participantTypeBadgeVariant(participantType)}>
              {t(`participantType.${participantType}`)}
            </Badge>
            <span className="text-sm text-slate-400">{displayName}</span>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>
              {t("common.preparationTime")}: {session.preparationDurationMinutes} {t("common.minutes")}
            </span>
            <span>
              {t("common.negotiationTime")}: {session.negotiationDurationMinutes} {t("common.minutes")}
            </span>
            {session.caseLanguage ? (
              <span className="uppercase">{session.caseLanguage}</span>
            ) : null}
          </div>
          {session.closedByEvent ? (
            <Badge variant="danger">
              {session.closedBeforeNegotiation
                ? t("events.sessionClosedBeforeNegotiation")
                : t("events.sessionClosedByEvent")}
            </Badge>
          ) : session.negotiationState === "FINISHED" ? (
            <Badge variant="success">{t("join.sessionFinishedMessage")}</Badge>
          ) : null}
        </GlassCardContent>
      </GlassCard>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column — recording + transcript + notes */}
        <div className="space-y-6 lg:col-span-2">
          {/* Recording */}
          <GlassCard>
            <GlassCardHeader>
              <p className="font-semibold text-slate-100">{t("sessionMaterials.recording")}</p>
            </GlassCardHeader>
            <GlassCardContent className="py-4">
              <RecordingSection recording={recording} />
            </GlassCardContent>
          </GlassCard>

          {/* Transcript */}
          <GlassCard>
            <GlassCardHeader>
              <p className="font-semibold text-slate-100">{t("recording.transcript")}</p>
            </GlassCardHeader>
            <GlassCardContent className="py-4">
              <TranscriptSection transcript={transcript} />
            </GlassCardContent>
          </GlassCard>

          {/* Notes */}
          <GlassCard>
            <GlassCardHeader>
              <p className="font-semibold text-slate-100">{notesSectionTitle}</p>
            </GlassCardHeader>
            <GlassCardContent className="py-4">
              <NotesForm
                participantId={participantId}
                initialNotes={notes}
                variant={notesVariant}
              />
            </GlassCardContent>
          </GlassCard>
        </div>

        {/* Right column — role briefing + roster + event */}
        <div className="space-y-6">
          {/* Role briefing for participants */}
          {caseRole ? (
            <GlassCard>
              <GlassCardHeader>
                <p className="font-semibold text-slate-100">{t("join.yourRole")}</p>
              </GlassCardHeader>
              <GlassCardContent className="py-4">
                <RoleBriefingSection role={caseRole} />
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {/* Public case context */}
          {session.businessContext || session.publicInstructions ? (
            <GlassCard>
              <GlassCardHeader>
                <p className="font-semibold text-slate-100">{t("join.publicContext")}</p>
              </GlassCardHeader>
              <GlassCardContent className="space-y-3 py-4 text-sm text-slate-300">
                {session.businessContext ? (
                  <p>{session.businessContext}</p>
                ) : null}
                {session.publicInstructions ? (
                  <p className="text-slate-400">{session.publicInstructions}</p>
                ) : null}
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {/* Roster */}
          {assignedParticipants.length > 0 ? (
            <GlassCard>
              <GlassCardHeader>
                <p className="font-semibold text-slate-100">{t("sessions.participants")}</p>
              </GlassCardHeader>
              <GlassCardContent className="py-4">
                <ul className="space-y-2">
                  {assignedParticipants.map((ap) => (
                    <li key={ap.id} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-slate-200">
                        {ap.displayName}
                      </span>
                      <span className="text-xs text-slate-500">{ap.role.name}</span>
                    </li>
                  ))}
                </ul>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {/* Event navigation */}
          {event ? (
            <GlassCard>
              <GlassCardContent className="py-4">
                <p className="mb-2 text-xs text-slate-500">{t("events.eventColumn")}</p>
                <p className="mb-3 font-medium text-slate-200">{event.title}</p>
                <Link
                  href={event.lobbyUrl}
                  className="text-sm font-semibold text-cyan-400 hover:text-cyan-300"
                  data-testid="materials-event-lobby-link"
                >
                  {t("events.openLobby")}
                </Link>
              </GlassCardContent>
            </GlassCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
