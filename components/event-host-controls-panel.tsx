"use client";

import { useCallback, useMemo, useState } from "react";

import { DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { CompleteSessionButton } from "@/components/complete-session-button";
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
import {
  deriveEventFacilitatorOptionAvailability,
  deriveEventObserverOptionAvailability,
  deriveEventRoleOptionAvailability,
  deriveEventRoleSlotSummary,
  deriveUnassignedRoleEligibleParticipantIds,
  normalizeEventAssignmentDraft,
} from "@/lib/event-role-ui-state";
import type { PublicCaseSummary } from "@/lib/event-case-public";
import type { EventStateResponse } from "@/lib/event-state";
import { useI18n } from "@/lib/i18n/useI18n";
import { getRecordingDisplayPresentation } from "@/lib/recording-display-state";

type EventHostControlsPanelProps = {
  state: EventStateResponse;
  draft: EventAssignmentDraft;
  isCreatingSession: boolean;
  onUpdateHost: (payload: Record<string, unknown>) => Promise<void>;
  onCreateSession: (overrides?: {
    roomLabel?: string;
    assignmentDraft?: EventAssignmentDraft;
  }) => void;
  createSessionError: string | null;
  hostToken?: string;
};

type EventSessionBadgeState = "active" | "completed" | "preparation" | "debrief";

function resolveEventSessionBadgeState(
  session: EventStateResponse["sessions"][number],
): EventSessionBadgeState {
  if (session.roomLifecycle === "DEBRIEF_OPEN") {
    return "debrief";
  }

  if (
    session.negotiationState === "FINISHED" ||
    session.status === "COMPLETED" ||
    session.closedByEventAt
  ) {
    return "completed";
  }

  if (
    session.negotiationState === "RUNNING" ||
    session.negotiationState === "PAUSED" ||
    session.negotiationState === "PREPARATION_RUNNING"
  ) {
    return "active";
  }

  return "preparation";
}

function eventSessionBadgeClassName(state: EventSessionBadgeState) {
  if (state === "active") {
    return "border-cyan-500/35 bg-cyan-500/12 text-cyan-200";
  }
  if (state === "completed") {
    return "border-emerald-500/35 bg-emerald-500/12 text-emerald-200";
  }
  if (state === "debrief") {
    return "border-violet-500/35 bg-violet-500/12 text-violet-200";
  }
  return "border-slate-500/35 bg-slate-500/12 text-slate-300";
}

export function EventHostControlsPanel({
  state,
  draft,
  isCreatingSession,
  onUpdateHost,
  onCreateSession,
  createSessionError,
  hostToken,
}: EventHostControlsPanelProps) {
  const { t } = useI18n();
  const selectedCase = state.selectedCase;

  const [libraryMode, setLibraryMode] = useState(!selectedCase);
  const [showSessionSetup, setShowSessionSetup] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [roomLabelDraft, setRoomLabelDraft] = useState("");
  const [isEditingRoomLabel, setIsEditingRoomLabel] = useState(false);
  const showLibrary = !selectedCase || libraryMode;
  const assignmentParticipants = state.participants;
  const normalizedDraft = useMemo(
    () =>
      normalizeEventAssignmentDraft({
        draft,
        roles: selectedCase?.roles ?? [],
        participants: assignmentParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          activeAssignmentLabel: participant.activeAssignmentLabel,
        })),
      }),
    [assignmentParticipants, draft, selectedCase?.roles],
  );
  const [draftState, setDraftState] = useState(normalizedDraft);

  const roleSlotSummary = useMemo(
    () =>
      deriveEventRoleSlotSummary({
        roles: selectedCase?.roles ?? [],
        participants: assignmentParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          activeAssignmentLabel: participant.activeAssignmentLabel,
        })),
        roleAssignments: draftState.roleAssignments,
      }),
    [assignmentParticipants, draftState.roleAssignments, selectedCase?.roles],
  );
  const facilitatorOptions = useMemo(
    () =>
      deriveEventFacilitatorOptionAvailability({
        participants: assignmentParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          activeAssignmentLabel: participant.activeAssignmentLabel,
        })),
        roleAssignments: draftState.roleAssignments,
      }),
    [assignmentParticipants, draftState.roleAssignments],
  );
  const observerOptions = useMemo(
    () =>
      deriveEventObserverOptionAvailability({
        participants: assignmentParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          activeAssignmentLabel: participant.activeAssignmentLabel,
        })),
        facilitatorEventParticipantId: draftState.facilitatorEventParticipantId,
        roleAssignments: draftState.roleAssignments,
      }),
    [
      assignmentParticipants,
      draftState.facilitatorEventParticipantId,
      draftState.roleAssignments,
    ],
  );
  const remainingObserverEligibleIds = useMemo(
    () =>
      deriveUnassignedRoleEligibleParticipantIds({
        participants: assignmentParticipants.map((participant) => ({
          id: participant.id,
          displayName: participant.displayName,
          activeAssignmentLabel: participant.activeAssignmentLabel,
        })),
        facilitatorEventParticipantId: draftState.facilitatorEventParticipantId,
        roleAssignments: draftState.roleAssignments,
      }),
    [
      assignmentParticipants,
      draftState.facilitatorEventParticipantId,
      draftState.roleAssignments,
    ],
  );
  const observerSelectionSet = useMemo(
    () => new Set(draftState.observerEventParticipantIds),
    [draftState.observerEventParticipantIds],
  );

  const saveDraft = useCallback(
    (next: Partial<EventAssignmentDraft>) => {
      const merged: EventAssignmentDraft = {
        ...draftState,
        ...next,
      };
      setDraftState(merged);
      void onUpdateHost({ assignmentDraft: merged });
    },
    [draftState, onUpdateHost],
  );

  const commitRoomLabelDraft = useCallback(() => {
    if (!isEditingRoomLabel) {
      return;
    }
    if (roomLabelDraft !== draftState.roomLabel) {
      saveDraft({ roomLabel: roomLabelDraft });
    }
    setIsEditingRoomLabel(false);
  }, [draftState.roomLabel, isEditingRoomLabel, roomLabelDraft, saveDraft]);

  // Bug 3 fix: create must use the room name currently visible in the input,
  // not the last persisted `draft.roomLabel` (which is saved asynchronously on
  // blur). We resolve the latest local value, commit it to the draft for
  // consistency, and pass it directly into the create request so there is no
  // race against the async draft save.
  const handleCreateSession = useCallback(() => {
    const latestRoomLabel = (
      isEditingRoomLabel ? roomLabelDraft : draftState.roomLabel
    ).trim();
    if (isEditingRoomLabel && roomLabelDraft !== draftState.roomLabel) {
      saveDraft({ roomLabel: roomLabelDraft });
      setIsEditingRoomLabel(false);
    }
    onCreateSession({
      roomLabel: latestRoomLabel || undefined,
      assignmentDraft: {
        ...draftState,
        roomLabel: latestRoomLabel,
      },
    });
  }, [
    draftState,
    isEditingRoomLabel,
    onCreateSession,
    roomLabelDraft,
    saveDraft,
  ]);

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

      if (isDifferentCase) {
        setDraftState(freshDraft);
      }
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

  return (
    <div data-testid="host-controls-panel" className="space-y-4">
      <GlassCard elevated data-testid="event-settings-section">
        <GlassCardHeader>
          <h3 className="text-sm font-semibold text-slate-50">{t("events.eventSettings")}</h3>
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
        </GlassCardContent>
      </GlassCard>

      <GlassCard elevated data-testid="session-board-section">
        <GlassCardHeader>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-50">{t("events.sessionsBoard")}</h3>
            {selectedCase ? (
              <SecondaryButton
                type="button"
                data-testid="create-another-session-button"
                className="px-2 py-1 text-xs"
                onClick={openSessionSetup}
              >
                {t("events.createSession")}
              </SecondaryButton>
            ) : null}
          </div>
        </GlassCardHeader>
        <GlassCardContent className="space-y-4">
          <div className="space-y-3" data-testid="sessions-board">
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
                      {(() => {
                        const badgeState = resolveEventSessionBadgeState(session);
                        const badgeLabel =
                          badgeState === "completed"
                            ? t("events.completedSessionStatus")
                            : badgeState === "debrief"
                              ? t("room.debrief")
                              : t(
                                  `status.${session.negotiationState}` as
                                    | "status.PREPARATION"
                                    | "status.PREPARATION_RUNNING"
                                    | "status.PREPARATION_PAUSED"
                                    | "status.READY_TO_START"
                                    | "status.RUNNING"
                                    | "status.PAUSED"
                                    | "status.FINISHED",
                                );

                        return (
                          <span
                            data-testid="event-session-status-badge"
                            data-session-state={badgeState}
                            data-room-lifecycle={session.roomLifecycle}
                            data-session-negotiation-state={session.negotiationState}
                            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${eventSessionBadgeClassName(
                              badgeState,
                            )}`}
                          >
                            {badgeLabel}
                          </span>
                        );
                      })()}
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
                      {(() => {
                        const recordingPresentation = getRecordingDisplayPresentation(
                          session.recordingDisplayState,
                        );
                        return (
                          <p
                            data-recording-state={recordingPresentation.state}
                            className={recordingPresentation.className}
                          >
                            {t("recording.recordingStatus")}:{" "}
                            {t(recordingPresentation.labelKey)}
                          </p>
                        );
                      })()}
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
                      {session.isActive ? (
                        <CompleteSessionButton
                          sessionId={session.id}
                          variant="button"
                          testId="finish-session-button"
                          className="px-2 py-1 text-xs"
                          requestPayload={hostToken ? { hostToken } : undefined}
                          onCompleted={() => {
                            void onUpdateHost({});
                          }}
                        />
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
                value={isEditingRoomLabel ? roomLabelDraft : draftState.roomLabel}
                onFocus={() => {
                  setRoomLabelDraft(draftState.roomLabel);
                  setIsEditingRoomLabel(true);
                }}
                onBlur={commitRoomLabelDraft}
                onChange={(event) => {
                  if (!isEditingRoomLabel) {
                    setIsEditingRoomLabel(true);
                  }
                  setRoomLabelDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setRoomLabelDraft(draftState.roomLabel);
                    setIsEditingRoomLabel(false);
                    event.currentTarget.blur();
                  }
                }}
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
                value={draftState.preparationDurationMinutes}
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
                value={draftState.negotiationDurationMinutes}
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
                value={draftState.facilitatorEventParticipantId ?? ""}
                onChange={(event) => {
                  const facilitatorEventParticipantId = event.target.value || null;
                  saveDraft({
                    facilitatorEventParticipantId,
                    observerEventParticipantIds:
                      draftState.observerEventParticipantIds.filter(
                        (participantId) => participantId !== facilitatorEventParticipantId,
                      ),
                  });
                }}
              >
                <option value="">{t("common.selectRole")}</option>
                {facilitatorOptions.map((participant) => (
                  <option
                    key={participant.id}
                    value={participant.id}
                    disabled={participant.disabled}
                  >
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
              {selectedCase.roles.length > 0 ? (
                <div
                  className="space-y-2 rounded-lg border border-slate-700/40 bg-slate-900/30 px-3 py-2"
                  data-testid="event-role-slot-summary"
                >
                  {roleSlotSummary.slots.map((slot) => (
                    <p key={slot.roleId} className="text-xs text-slate-300">
                      <span className="font-medium text-slate-200">{slot.roleName}</span>
                      {" — "}
                      {slot.assignedParticipantName ?? t("sessions.roleUnassigned")}
                    </p>
                  ))}
                </div>
              ) : null}
              {selectedCase.roles.map((role) => (
                <div key={role.id}>
                  <label className="mb-1 block text-xs text-slate-400">{role.name}</label>
                  <select
                    data-testid="assign-role-control"
                    className={inputClassName(false)}
                    value={draftState.roleAssignments[role.id] ?? ""}
                    onChange={(event) => {
                      const roleAssignments = {
                        ...draftState.roleAssignments,
                      };
                      if (event.target.value) {
                        roleAssignments[role.id] = event.target.value;
                      } else {
                        delete roleAssignments[role.id];
                      }
                      const assignedRolePlayerIds = new Set(
                        Object.values(roleAssignments),
                      );
                      saveDraft({
                        roleAssignments,
                        observerEventParticipantIds:
                          draftState.observerEventParticipantIds.filter(
                            (participantId) => !assignedRolePlayerIds.has(participantId),
                          ),
                      });
                    }}
                  >
                    <option value="">{t("common.selectRole")}</option>
                    {deriveEventRoleOptionAvailability({
                      roleId: role.id,
                      participants: assignmentParticipants.map((participant) => ({
                        id: participant.id,
                        displayName: participant.displayName,
                        activeAssignmentLabel: participant.activeAssignmentLabel,
                      })),
                      facilitatorEventParticipantId:
                        draftState.facilitatorEventParticipantId,
                      roleAssignments: draftState.roleAssignments,
                    }).map((participant) => (
                      <option
                        key={participant.id}
                        value={participant.id}
                        disabled={participant.disabled}
                      >
                        {participant.displayName}
                        {participant.activeAssignmentLabel
                          ? ` · ${participant.activeAssignmentLabel}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {roleSlotSummary.allRolesAssigned ? (
                <div className="space-y-1" data-testid="event-all-roles-assigned-hint">
                  <p className="text-xs font-medium text-amber-300">
                    {t("sessions.allRolesAssigned")}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t("sessions.newParticipantsObserverOrUnassigned")}
                  </p>
                </div>
              ) : null}
            </div>

            <div>
              <label className={labelClassName}>{t("events.assignObservers")}</label>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-600/30 p-2" data-testid="assign-observer-control">
                {observerOptions.map((participant) => {
                  const checked = observerSelectionSet.has(participant.id);

                  return (
                    <label
                      key={participant.id}
                      className={`flex items-center gap-2 text-sm ${
                        participant.disabled
                          ? "text-slate-500"
                          : "text-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={participant.disabled}
                        checked={checked}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [
                                ...draftState.observerEventParticipantIds,
                                participant.id,
                              ]
                            : draftState.observerEventParticipantIds.filter(
                                (id) => id !== participant.id,
                              );
                          saveDraft({
                            observerEventParticipantIds: Array.from(new Set(ids)),
                          });
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
              {roleSlotSummary.allRolesAssigned &&
              remainingObserverEligibleIds.length > 0 ? (
                <SecondaryButton
                  type="button"
                  className="mt-2 w-full px-2 py-1 text-xs"
                  data-testid="assign-remaining-observers-button"
                  onClick={() =>
                    saveDraft({
                      observerEventParticipantIds: Array.from(
                        new Set([
                          ...draftState.observerEventParticipantIds,
                          ...remainingObserverEligibleIds,
                        ]),
                      ),
                    })
                  }
                >
                  {t("events.assignObservers")}
                </SecondaryButton>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <GradientButton
                type="button"
                data-testid="create-session-button"
                disabled={isCreatingSession}
                onClick={handleCreateSession}
              >
                {t("events.createSession")}
              </GradientButton>
              <SecondaryButton
                type="button"
                data-testid="cancel-session-setup-button"
                onClick={() => {
                  setShowSessionSetup(false);
                  setIsEditingRoomLabel(false);
                  setRoomLabelDraft(draftState.roomLabel);
                }}
              >
                {t("common.cancel")}
              </SecondaryButton>
            </div>
            </div>
          ) : null}
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
