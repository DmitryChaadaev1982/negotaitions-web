"use client";

import Link from "next/link";
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
}: EventHostControlsPanelProps) {
  const { t } = useI18n();
  const selectedCase = state.selectedCase;
  const hasSession = Boolean(state.createdSession);

  const [libraryMode, setLibraryMode] = useState(!selectedCase);
  const [showSessionSetup, setShowSessionSetup] = useState(false);
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

        {state.linkedSessions.length > 0 ? (
          <div className="space-y-2" data-testid="existing-sessions-section">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("events.existingSessions")}
            </p>
            <ul className="space-y-1">
              {state.linkedSessions.map((session) => (
                <li key={session.id}>
                  <Link
                    href={`/sessions/${session.id}`}
                    className="block rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2 text-sm text-cyan-400 transition hover:border-cyan-500/30 hover:text-cyan-300"
                  >
                    {session.title}
                  </Link>
                </li>
              ))}
            </ul>
            {hasSession ? (
              <p className="text-xs text-slate-500">{t("events.sessionAlreadyCreated")}</p>
            ) : null}
          </div>
        ) : null}

        {selectedCase && showSessionSetup ? (
          <div className="space-y-4 border-t border-slate-600/30 pt-4" data-testid="session-setup-section">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("events.sessionSetup")}
            </p>

            <div>
              <label className={labelClassName}>{t("common.preparationTime")}</label>
              <input
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
                    data-testid={`assign-role-control-${role.id}`}
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
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignObservers")}</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-600/30 p-2">
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
                    </label>
                  );
                })}
              </div>
            </div>

            <GradientButton
              type="button"
              data-testid="create-session-button"
              disabled={isCreatingSession || hasSession}
              onClick={onCreateSession}
            >
              {hasSession
                ? t("events.negotiationSessionCreated")
                : state.linkedSessions.length > 0
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
