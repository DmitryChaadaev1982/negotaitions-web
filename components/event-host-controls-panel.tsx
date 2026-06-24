"use client";

import { useCallback, useState } from "react";

import { DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { EventCaseLibrary } from "@/components/event-case-library";
import {
  GradientButton,
  SecondaryButton,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import {
  inputClassName,
  labelClassName,
} from "@/components/ui/form-styles";
import {
  createFreshAssignmentDraft,
  type EventAssignmentDraft,
} from "@/lib/event-assignment";
import type { PublicCaseSummary } from "@/lib/event-case-public";
import type { EventStateResponse } from "@/lib/event-state";
import { useI18n } from "@/lib/i18n/useI18n";

type EventHostControlsPanelProps = {
  state: EventStateResponse;
  draft: EventAssignmentDraft;
  isCreatingSession: boolean;
  showCompleteDialog: boolean;
  isCompletingEvent: boolean;
  onShowCompleteDialog: (open: boolean) => void;
  onCompleteEvent: () => void;
  onUpdateHost: (payload: Record<string, unknown>) => Promise<void>;
  onCreateSession: () => void;
  createSessionError: string | null;
};

export function EventHostControlsPanel({
  state,
  draft,
  isCreatingSession,
  showCompleteDialog,
  isCompletingEvent,
  onShowCompleteDialog,
  onCompleteEvent,
  onUpdateHost,
  onCreateSession,
  createSessionError,
}: EventHostControlsPanelProps) {
  const { t } = useI18n();
  const selectedCase = state.selectedCase;

  const [libraryMode, setLibraryMode] = useState(!selectedCase);
  const [showSessionSetup, setShowSessionSetup] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const showLibrary = !selectedCase || libraryMode;

  const saveDraft = useCallback(
    (next: Partial<EventAssignmentDraft>) => {
      const merged: EventAssignmentDraft = {
        ...draft,
        ...next,
      };
      void onUpdateHost({ assignmentDraft: merged });
    },
    [draft, onUpdateHost],
  );

  const handleUseCase = useCallback(
    async (negotiationCase: PublicCaseSummary) => {
      const isDifferentCase = state.selectedCase?.id !== negotiationCase.id;
      const freshDraft = createFreshAssignmentDraft({
        preparationDurationMinutes: negotiationCase.defaultPreparationDurationMinutes,
        negotiationDurationMinutes: negotiationCase.defaultDurationMinutes,
      });

      await onUpdateHost({
        selectedCaseId: negotiationCase.id,
        ...(isDifferentCase ? { assignmentDraft: freshDraft } : {}),
      });

      setLibraryMode(false);
      setShowSessionSetup(false);
    },
    [onUpdateHost, state.selectedCase?.id],
  );

  const openSessionSetup = useCallback(() => {
    if (!selectedCase) return;
    setShowSessionSetup(true);
    setLibraryMode(false);
  }, [selectedCase]);

  const copyRoomLinks = useCallback(
    async (sessionId: string) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      if (!session) return;

      const links = session.participants
        .filter((participant) => participant.materialsUrl || participant.roomUrl)
        .map((participant) => {
          const url = participant.roomUrl ?? participant.materialsUrl;
          return `${participant.displayName}: ${window.location.origin}${url}`;
        })
        .join("\n");

      await navigator.clipboard.writeText(links);
      setCopyMessage(t("events.linkCopied"));
      window.setTimeout(() => setCopyMessage(null), 2000);
    },
    [state.sessions, t],
  );

  const finishSession = useCallback(
    async (sessionId: string) => {
      const session = state.sessions.find((item) => item.id === sessionId);
      const roomUrl = session?.roomUrl;
      if (!roomUrl) return;

      const params = new URLSearchParams(roomUrl.split("?")[1] ?? "");
      const joinToken = params.get("joinToken");
      if (!joinToken) return;

      await fetch(`/api/sessions/${sessionId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, action: "FINISH" }),
      });
      await onUpdateHost({});
    },
    [onUpdateHost, state.sessions],
  );

  return (
    <div data-testid="host-controls-panel">
    <GlassCard elevated>
      <GlassCardHeader>
        <h3 className="text-sm font-semibold text-slate-50">{t("events.hostControls")}</h3>
      </GlassCardHeader>
      <GlassCardContent className="space-y-4">
        {showLibrary ? (
          <EventCaseLibrary
            cases={state.availableCases}
            selectedCaseId={selectedCase?.id ?? null}
            onUseCase={(negotiationCase) => void handleUseCase(negotiationCase)}
          />
        ) : null}

        {selectedCase && !showLibrary ? (
          <div className="space-y-3" data-testid="selected-case-section">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("events.selectedCase")}
            </p>
            <div className="rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-slate-100">{selectedCase.title}</p>
                <CaseLanguageBadge caseLanguage={selectedCase.caseLanguage} />
              </div>
              <div className="mt-2">
                <DifficultyBadge difficulty={selectedCase.difficulty} />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {t("common.preparationDurationValue", {
                  minutes: selectedCase.defaultPreparationDurationMinutes,
                })}
              </p>
              <p className="text-xs text-slate-400">
                {t("common.negotiationDurationValue", {
                  minutes: selectedCase.defaultDurationMinutes,
                })}
              </p>
              <div className="mt-2">
                <p className="text-xs font-medium text-slate-400">{t("cases.roles")}</p>
                <p className="mt-1 text-xs text-slate-300">
                  {selectedCase.roleNames.join(", ")}
                </p>
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-400">
                {selectedCase.businessContext}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <SecondaryButton
                  type="button"
                  data-testid="change-case-button"
                  className="px-2 py-1 text-xs"
                  onClick={() => {
                    setLibraryMode(true);
                    setShowSessionSetup(false);
                  }}
                >
                  {t("events.changeCase")}
                </SecondaryButton>
                <SecondaryButton
                  type="button"
                  data-testid="configure-session-button"
                  className="px-2 py-1 text-xs"
                  onClick={openSessionSetup}
                >
                  {t("events.configureSession")}
                </SecondaryButton>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3" data-testid="sessions-board">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("events.sessionsBoard")}
            </p>
            {selectedCase ? (
              <SecondaryButton
                type="button"
                data-testid="create-another-session-button"
                className="px-2 py-1 text-xs"
                onClick={openSessionSetup}
              >
                {state.sessions.length > 0
                  ? t("events.createAnotherSession")
                  : t("events.createFirstSession")}
              </SecondaryButton>
            ) : null}
          </div>
          {copyMessage ? (
            <p className="text-xs text-emerald-400">{copyMessage}</p>
          ) : null}
          {state.sessions.length === 0 ? (
            <p className="text-sm text-slate-400">{t("events.noSessionsCreatedYet")}</p>
          ) : (
            <div className="space-y-2">
              {state.sessions.map((session) => (
                <div
                  key={session.id}
                  data-testid="event-session-card"
                  className="space-y-3 rounded-xl border border-slate-600/30 bg-slate-900/50 px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-50">
                        {session.roomLabel ?? session.title}
                      </p>
                      <p className="text-xs text-slate-400">{session.caseTitle}</p>
                    </div>
                    <span className="rounded-full border border-slate-600/40 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                      {session.isActive
                        ? t("events.activeSession")
                        : t("events.finishedSession")}
                    </span>
                  </div>
                  <div className="grid gap-1 text-xs text-slate-400">
                    <p>
                      {t("events.assignFacilitator")}:{" "}
                      <span className="text-slate-200">
                        {session.facilitatorName ?? t("common.notYet")}
                      </span>
                    </p>
                    <p>
                      {t("sessions.participants")}: {session.participantCount} ·{" "}
                      {t("sessions.observers")}: {session.observerCount}
                    </p>
                    <p>
                      {t("common.preparationDurationValue", {
                        minutes: Math.round(session.preparationDuration / 60),
                      })}
                      {" · "}
                      {t("common.negotiationDurationValue", {
                        minutes: Math.round(session.negotiationDuration / 60),
                      })}
                    </p>
                    {session.recordingStatus === "RECORDING" ? (
                      <p className="text-rose-300">{t("recording.recordingInProgress")}</p>
                    ) : session.recordingStatus ? (
                      <p>{t("recording.recordingStatus")}: {session.recordingStatus}</p>
                    ) : null}
                    <div className="mt-1 space-y-1">
                      {session.participants.map((participant) => (
                        <p key={participant.id}>
                          {participant.displayName} ·{" "}
                          {t(`participantType.${participant.participantType}`)}
                          {participant.roleName ? ` · ${participant.roleName}` : ""}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {session.roomUrl && session.isActive ? (
                      <SecondaryButton
                        type="button"
                        data-testid="open-session-room-button"
                        className="px-2 py-1 text-xs"
                        onClick={() => {
                          window.location.href = session.roomUrl!;
                        }}
                      >
                        {t("events.openRoom")}
                      </SecondaryButton>
                    ) : null}
                    {session.materialsUrl ? (
                      <SecondaryButton
                        type="button"
                        data-testid="open-session-materials-button"
                        className="px-2 py-1 text-xs"
                        onClick={() => {
                          window.location.href = session.materialsUrl!;
                        }}
                      >
                        {t("events.openMaterials")}
                      </SecondaryButton>
                    ) : null}
                    <SecondaryButton
                      type="button"
                      data-testid="copy-room-links-button"
                      className="px-2 py-1 text-xs"
                      onClick={() => void copyRoomLinks(session.id)}
                    >
                      {t("events.copyRoomLinks")}
                    </SecondaryButton>
                    {session.isActive && session.roomUrl ? (
                      <button
                        type="button"
                        data-testid="finish-session-button"
                        className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/20"
                        onClick={() => void finishSession(session.id)}
                      >
                        {t("room.finishEarly")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedCase && showSessionSetup ? (
          <div className="space-y-4 border-t border-slate-600/30 pt-4" data-testid="session-setup-section">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("events.newSession")}
            </p>

            {createSessionError ? (
              <div
                data-testid="active-assignment-warning"
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
              >
                {createSessionError}
              </div>
            ) : null}

            <div>
              <label className={labelClassName}>{t("events.roomName")}</label>
              <input
                data-testid="room-label-input"
                type="text"
                className={inputClassName(false)}
                placeholder={t("events.roomNamePlaceholder")}
                value={draft.roomLabel}
                onChange={(event) => saveDraft({ roomLabel: event.target.value })}
              />
            </div>

            <div>
              <label className={labelClassName}>{t("common.preparationTime")}</label>
              <input
                data-testid="preparation-time-input"
                type="number"
                min={0}
                max={60}
                className={inputClassName(false)}
                value={draft.preparationDurationMinutes}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  if (!Number.isFinite(minutes)) return;
                  saveDraft({ preparationDurationMinutes: minutes });
                }}
              />
            </div>

            <div>
              <label className={labelClassName}>{t("common.negotiationTime")}</label>
              <input
                data-testid="negotiation-time-input"
                type="number"
                min={1}
                max={180}
                className={inputClassName(false)}
                value={draft.negotiationDurationMinutes}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  if (!Number.isFinite(minutes)) return;
                  saveDraft({ negotiationDurationMinutes: minutes });
                }}
              />
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignFacilitator")}</label>
              <select
                data-testid="assign-facilitator-control"
                className={inputClassName(false)}
                value={draft.facilitatorEventParticipantId ?? ""}
                onChange={(event) => {
                  saveDraft({
                    facilitatorEventParticipantId: event.target.value || null,
                  });
                }}
              >
                <option value="">{t("common.selectRole")}</option>
                {state.participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.displayName}
                    {participant.activeAssignmentLabel
                      ? ` · ${participant.activeAssignmentLabel}`
                      : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <p className={labelClassName}>{t("events.assignRoles")}</p>
              {selectedCase.roles.map((role) => (
                <div key={role.id}>
                  <label className="mb-1 block text-xs text-slate-400">{role.name}</label>
                  <select
                    data-testid="assign-role-control"
                    className={inputClassName(false)}
                    value={draft.roleAssignments[role.id] ?? ""}
                    onChange={(event) => {
                      saveDraft({
                        roleAssignments: {
                          ...draft.roleAssignments,
                          [role.id]: event.target.value,
                        },
                      });
                    }}
                  >
                    <option value="">{t("common.selectRole")}</option>
                    {state.participants.map((participant) => (
                      <option key={participant.id} value={participant.id}>
                        {participant.displayName}
                        {participant.activeAssignmentLabel
                          ? ` · ${participant.activeAssignmentLabel}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignObservers")}</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-600/30 p-2" data-testid="assign-observer-control">
                {state.participants.map((participant) => {
                  const isRolePlayer = Object.values(draft.roleAssignments).includes(
                    participant.id,
                  );
                  const isFacilitator =
                    draft.facilitatorEventParticipantId === participant.id;
                  const checked = draft.observerEventParticipantIds.includes(participant.id);

                  return (
                    <label
                      key={participant.id}
                      className={`flex items-center gap-2 text-sm ${
                        isRolePlayer || isFacilitator
                          ? "text-slate-500"
                          : "text-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={isRolePlayer || isFacilitator}
                        checked={checked}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [...draft.observerEventParticipantIds, participant.id]
                            : draft.observerEventParticipantIds.filter(
                                (id) => id !== participant.id,
                              );
                          saveDraft({ observerEventParticipantIds: ids });
                        }}
                      />
                      {participant.displayName}
                      {participant.activeAssignmentLabel
                        ? ` · ${participant.activeAssignmentLabel}`
                        : ""}
                    </label>
                  );
                })}
              </div>
            </div>

            <GradientButton
              type="button"
              data-testid="create-session-button"
              disabled={isCreatingSession}
              onClick={onCreateSession}
            >
              {state.sessions.length > 0
                ? t("events.createAnotherSession")
                : t("events.createSession")}
            </GradientButton>
          </div>
        ) : null}

        <div className="border-t border-slate-600/30 pt-4">
          <button
            type="button"
            data-testid="complete-event-button"
            className="w-full rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
            onClick={() => onShowCompleteDialog(true)}
          >
            {t("events.completeEvent")}
          </button>
        </div>
      </GlassCardContent>

      {showCompleteDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-600/40 bg-slate-900 p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-50">
              {t("events.completeEventTitle")}
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              {t("events.completeEventWarning")}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <SecondaryButton
                type="button"
                onClick={() => onShowCompleteDialog(false)}
                disabled={isCompletingEvent}
              >
                {t("common.cancel")}
              </SecondaryButton>
              <button
                type="button"
                data-testid="confirm-complete-event-button"
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                disabled={isCompletingEvent}
                onClick={onCompleteEvent}
              >
                {isCompletingEvent
                  ? t("common.loading")
                  : t("events.completeEventConfirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </GlassCard>
    </div>
  );
}
