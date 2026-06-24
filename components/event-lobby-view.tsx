"use client";

import "@livekit/components-styles";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge, DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { ConnectionStatusBadge } from "@/components/connection-status-badge";
import { EventLobbyPresence } from "@/components/event-lobby-presence";
import { EventLobbyVideoRoom } from "@/components/event-lobby-video-room";
import { LanguageSwitcher } from "@/components/language-switcher";
import { RejoinNavLink } from "@/components/rejoin-page-view";
import { EventHostControlsPanel } from "@/components/event-host-controls-panel";
import {
  GradientButtonLink,
  SecondaryButton,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  alertErrorClassName,
} from "@/components/ui/form-styles";
import {
  buildSessionMaterialsPath,
  buildSessionRoomPath,
} from "@/lib/config";
import type { EventStateResponse } from "@/lib/event-state";
import { isSessionActiveForRoom } from "@/lib/session-overview-shared";
import { saveRecoveryContext, touchRecoveryContext } from "@/lib/rejoin/recovery-storage";
import { useI18n } from "@/lib/i18n/useI18n";

type EventLobbyViewProps = {
  eventId: string;
  hostToken?: string;
  participantToken?: string;
};

type LiveKitTokenResponse = {
  token: string;
  serverUrl: string;
  roomName: string;
  displayName: string;
  isHost: boolean;
};

function deviceWarningLabel(
  warning: string | null,
  t: (key: "events.cameraUnavailable" | "events.microphoneUnavailable") => string,
) {
  if (warning === "cameraUnavailable") {
    return t("events.cameraUnavailable");
  }
  if (warning === "microphoneUnavailable") {
    return t("events.microphoneUnavailable");
  }
  return null;
}

export function EventLobbyView({
  eventId,
  hostToken,
  participantToken,
}: EventLobbyViewProps) {
  const { t } = useI18n();
  const [state, setState] = useState<EventStateResponse | null>(null);
  const [liveKit, setLiveKit] = useState<LiveKitTokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [createSessionError, setCreateSessionError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [deviceWarning, setDeviceWarning] = useState<string | null>(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);
  const [isCompletingEvent, setIsCompletingEvent] = useState(false);
  const [completeMessage, setCompleteMessage] = useState<string | null>(null);
  const [completeWarnings, setCompleteWarnings] = useState<string[]>([]);

  const accessQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (hostToken) params.set("hostToken", hostToken);
    if (participantToken) params.set("participantToken", participantToken);
    return params.toString();
  }, [hostToken, participantToken]);

  const fetchState = useCallback(async () => {
    const response = await fetch(
      `/api/events/${eventId}/state?${accessQuery}`,
      { cache: "no-store" },
    );

    if (response.status === 410) {
      setError("eventUnavailable");
      return null;
    }

    if (!response.ok) {
      setError("invalidAccess");
      return null;
    }

    const data = (await response.json()) as EventStateResponse;
    setState(data);
    setError(null);
    return data;
  }, [accessQuery, eventId]);

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        const stateResponse = await fetch(`/api/events/${eventId}/state?${accessQuery}`, {
          cache: "no-store",
        });

        if (!active) return;

        if (stateResponse.status === 410) {
          setError("eventUnavailable");
          return;
        }

        if (!stateResponse.ok) {
          setError("invalidAccess");
          return;
        }

        const stateData = (await stateResponse.json()) as EventStateResponse;
        setState(stateData);
        setError(null);

        if (active) {
          setIsBootstrapping(false);
        }

        if (stateData.event.status === "COMPLETED") {
          return;
        }

        void (async () => {
          const tokenResponse = await fetch(`/api/events/${eventId}/livekit-token`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hostToken: hostToken || undefined,
              participantToken: participantToken || undefined,
            }),
          });

          if (!active) return;

          if (tokenResponse.ok) {
            setLiveKit((await tokenResponse.json()) as LiveKitTokenResponse);
          } else if (tokenResponse.status === 410) {
            setError("eventUnavailable");
          } else {
            setLiveKit(null);
          }
        })();
      } catch {
        if (active) {
          setError("invalidAccess");
        }
      } finally {
        if (active) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [accessQuery, eventId, hostToken, participantToken]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchState();
      touchRecoveryContext();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [fetchState]);

  useEffect(() => {
    if (!state) {
      return;
    }

    const displayName =
      state.currentParticipant?.displayName ?? liveKit?.displayName;

    saveRecoveryContext({
      type: "EVENT_LOBBY",
      eventId,
      hostToken,
      participantToken,
      displayName,
    });

    const assignment = state.currentParticipant
      ? state.participants.find((participant) => participant.id === state.currentParticipant?.id)
      : null;

    if (assignment?.joinToken) {
      saveRecoveryContext({
        type: "SESSION_JOIN",
        eventId,
        sessionId: assignment.assignedSessionId ?? undefined,
        hostToken,
        participantToken,
        joinToken: assignment.joinToken,
        displayName,
      });
    }
  }, [eventId, hostToken, liveKit?.displayName, participantToken, state]);

  const updateHost = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!hostToken) return;

      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken, ...payload }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        setState(data);
      }
    },
    [eventId, hostToken],
  );

  const updatePreference = useCallback(
    async (preference: string) => {
      if (!participantToken) return;

      const response = await fetch(`/api/events/${eventId}/participant`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantToken, preference }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        setState(data);
      }
    },
    [eventId, participantToken],
  );

  const createSession = useCallback(async () => {
    if (!hostToken || !state) return;

    setIsCreatingSession(true);
    setCreateSessionError(null);

    try {
      const selectedCase = state.selectedCase;
      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostToken,
          caseId: selectedCase?.id,
          roomLabel: state.assignmentDraft.roomLabel || undefined,
          preparationDurationSeconds:
            state.assignmentDraft.preparationDurationMinutes * 60,
          negotiationDurationSeconds:
            state.assignmentDraft.negotiationDurationMinutes * 60,
          facilitatorEventParticipantId:
            state.assignmentDraft.facilitatorEventParticipantId ?? undefined,
          roleAssignments: Object.entries(
            state.assignmentDraft.roleAssignments,
          ).map(([caseRoleId, eventParticipantId]) => ({
            caseRoleId,
            eventParticipantId,
          })),
          observerEventParticipantIds:
            state.assignmentDraft.observerEventParticipantIds,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setState(data.state as EventStateResponse);
      } else {
        const data = (await response.json()) as {
          error?: string;
          participantName?: string;
        };
        setCreateSessionError(
          data.error === "participantAlreadyAssigned" && data.participantName
            ? t("events.participantAlreadyAssignedName", {
                name: data.participantName,
              })
            : t("validation.createSessionFailed"),
        );
      }
    } finally {
      setIsCreatingSession(false);
    }
  }, [eventId, hostToken, state, t]);

  const copyJoinLink = useCallback(async () => {
    if (!state) return;
    const url = `${window.location.origin}/events/join/${state.event.publicJoinCode}`;
    await navigator.clipboard.writeText(url);
    setCopyMessage(t("events.linkCopied"));
    window.setTimeout(() => setCopyMessage(null), 2000);
  }, [state, t]);

  const completeEvent = useCallback(async () => {
    if (!hostToken) return;

    setIsCompletingEvent(true);
    setCompleteMessage(null);
    setCompleteWarnings([]);

    try {
      const response = await fetch(`/api/events/${eventId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken }),
      });

      if (response.ok) {
        const result = (await response.json()) as {
          warnings?: string[];
        };
        setCompleteMessage(t("events.trainingEventCompleted"));
        setCompleteWarnings(result.warnings ?? []);
        setShowCompleteDialog(false);
        await fetchState();
        setIsBootstrapping(false);
      }
    } finally {
      setIsCompletingEvent(false);
    }
  }, [eventId, fetchState, hostToken, t]);

  const isEventCompleted = state?.event.status === "COMPLETED";

  if (error === "eventUnavailable") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4 text-center">
        <BrandLogo size="lg" href={undefined} />
        <h1 className="text-xl font-bold text-slate-50">{t("events.eventUnavailableTitle")}</h1>
        <p className="max-w-md text-slate-400">{t("events.eventUnavailable")}</p>
        <GradientButtonLink href="/">{t("common.goToHome")}</GradientButtonLink>
      </div>
    );
  }

  if (isBootstrapping && !error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#020617] px-4">
        <p className="text-sm text-slate-400">{t("common.loading")}…</p>
        {hostToken ? (
          <button
            type="button"
            data-testid="complete-event-button"
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20"
            onClick={() => setShowCompleteDialog(true)}
          >
            {t("events.completeEvent")}
          </button>
        ) : null}
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
                  onClick={() => setShowCompleteDialog(false)}
                  disabled={isCompletingEvent}
                >
                  {t("common.cancel")}
                </SecondaryButton>
                <button
                  type="button"
                  data-testid="confirm-complete-event-button"
                  className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:opacity-50"
                  disabled={isCompletingEvent}
                  onClick={() => void completeEvent()}
                >
                  {isCompletingEvent
                    ? t("common.loading")
                    : t("events.completeEventConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (error || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617] px-4">
        <div className={alertErrorClassName}>
          {t("common.error")}: {error ?? t("common.loading")}
        </div>
      </div>
    );
  }

  const draft = state.assignmentDraft;
  const isHost = state.isHost || Boolean(hostToken);
  const currentAssignment = state.currentParticipant
    ? state.participants.find((p) => p.id === state.currentParticipant?.id)
    : null;
  const assignedSession = currentAssignment?.assignedSessionId
    ? state.sessions.find(
        (session) => session.id === currentAssignment.assignedSessionId,
      )
    : null;
  const sessionRoomActive =
    currentAssignment?.joinToken && currentAssignment.assignedSessionId
      ? Boolean(assignedSession?.isActive) ||
        isSessionActiveForRoom({
          negotiationState: assignedSession?.negotiationState ?? "PREPARATION",
          closedByEventAt: assignedSession?.closedByEventAt ?? null,
        })
      : false;
  const participantHistoricalSessions = state.currentParticipant
    ? state.sessions.filter((session) =>
        session.participants.some(
          (participant) =>
            participant.eventParticipantId === state.currentParticipant?.id,
        ),
      )
    : [];

  if (isEventCompleted) {
    return (
      <EventCompletedOverlay
        state={state}
        hostToken={hostToken}
        completeMessage={completeMessage}
        completeWarnings={completeWarnings}
      />
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#020617]" data-testid="event-lobby-page">
      {participantToken || hostToken ? (
        <EventLobbyPresence
          eventId={eventId}
          participantToken={participantToken}
          hostToken={hostToken}
        />
      ) : null}
      <header className="glass-header border-b border-slate-700/40 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <BrandLogo size="sm" href={isHost ? "/events" : undefined} />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/80">
                {t("events.eventLobby")}
              </p>
              <h1 className="text-lg font-bold text-slate-50">{state.event.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isHost ? (
              <SecondaryButton type="button" onClick={() => void copyJoinLink()}>
                {t("events.copyEventJoinLink")}
              </SecondaryButton>
            ) : null}
            <LanguageSwitcher />
            <RejoinNavLink />
          </div>
        </div>
        {copyMessage ? (
          <p className="mx-auto mt-2 max-w-[1600px] text-sm text-emerald-400">{copyMessage}</p>
        ) : null}
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-4 lg:flex-row lg:overflow-hidden">
        <section
          className="glass-panel flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-2xl border border-slate-600/25 lg:min-h-0"
          data-testid="event-lobby-video-area"
        >
          <div className="shrink-0 border-b border-slate-600/25 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-50">{t("events.commonLobby")}</h2>
            <p className="text-xs text-slate-400">
              {liveKit?.displayName ?? state.currentParticipant?.displayName ?? "Host"}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t("events.singleDeviceHint")}</p>
          </div>
          <div className="relative min-h-[360px] flex-1 bg-black/40">
            {deviceWarning ? (
              <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                {deviceWarningLabel(deviceWarning, t)}
              </p>
            ) : null}
            {liveKit ? (
              <EventLobbyVideoRoom
                token={liveKit.token}
                serverUrl={liveKit.serverUrl}
                onDeviceWarning={setDeviceWarning}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {t("common.loading")}…
              </div>
            )}
          </div>
        </section>

        <aside className="glass-panel flex w-full flex-col gap-4 overflow-y-auto rounded-2xl border border-slate-600/25 p-4 lg:w-[380px] lg:shrink-0 xl:w-[420px]">
          {state.currentParticipant ? (
            <GlassCard elevated>
              <GlassCardHeader>
                <h3 className="text-sm font-semibold text-slate-50">
                  {state.currentParticipant.displayName}
                  {isHost ? (
                    <span className="ml-2 text-xs font-normal text-cyan-400">
                      ({t("events.hostLabel")})
                    </span>
                  ) : null}
                </h3>
              </GlassCardHeader>
              <GlassCardContent className="space-y-3">
                <p className="text-xs font-medium text-slate-400">{t("events.yourPreference")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      ["UNDECIDED", t("events.undecided")],
                      ["PLAY", t("events.wantToPlay")],
                      ["OBSERVE", t("events.wantToObserve")],
                      ["FACILITATE", t("events.canFacilitate")],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void updatePreference(value)}
                      className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                        state.currentParticipant?.preference === value
                          ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                          : "border-slate-600/40 bg-slate-900/50 text-slate-300 hover:border-slate-500/50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          <GlassCard elevated data-testid="participant-list">
            <GlassCardHeader>
              <h3 className="text-sm font-semibold text-slate-50">
                {t("events.participantsInLobby")}
              </h3>
            </GlassCardHeader>
            <GlassCardContent className="space-y-2">
              {state.participants.length === 0 ? (
                <p className="text-sm text-slate-400">{t("events.noParticipantsYet")}</p>
              ) : (
                state.participants.map((participant) => (
                  <div
                    key={participant.id}
                    data-testid="participant-card"
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-slate-100">
                      {participant.displayName}
                      {participant.isHost ? (
                        <span className="ml-1.5 text-xs font-normal text-cyan-400">
                          ({t("events.hostLabel")})
                        </span>
                      ) : null}
                      {participant.activeAssignmentLabel ? (
                        <span className="mt-1 block text-xs font-normal text-cyan-300">
                          {t("events.activeSession")}: {participant.activeAssignmentLabel}
                        </span>
                      ) : null}
                    </span>
                    <div className="flex flex-col items-end gap-1">
                      <ConnectionStatusBadge
                        lastSeenAt={participant.lastSeenAt}
                        showLastSeen={isHost}
                      />
                      <Badge variant="default" className="text-[10px]">
                        {participant.preference === "PLAY"
                          ? t("events.wantToPlay")
                          : participant.preference === "OBSERVE"
                            ? t("events.wantToObserve")
                            : participant.preference === "FACILITATE"
                              ? t("events.canFacilitate")
                              : t("events.undecided")}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </GlassCardContent>
          </GlassCard>

          {state.selectedCase && !isHost ? (
            <GlassCard elevated>
              <GlassCardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-50">
                    {t("events.selectedCase")}
                  </h3>
                  <CaseLanguageBadge caseLanguage={state.selectedCase.caseLanguage} />
                </div>
              </GlassCardHeader>
              <GlassCardContent className="space-y-3 text-sm">
                <p className="font-medium text-slate-100">{state.selectedCase.title}</p>
                <DifficultyBadge difficulty={state.selectedCase.difficulty} />
                <p className="text-xs text-slate-400">
                  {t("common.preparationDurationValue", {
                    minutes: state.selectedCase.defaultPreparationDurationMinutes,
                  })}
                </p>
                <p className="text-xs text-slate-400">
                  {t("common.negotiationDurationValue", {
                    minutes: state.selectedCase.defaultDurationMinutes,
                  })}
                </p>
                <div>
                  <p className="text-xs font-medium text-slate-400">{t("cases.roles")}</p>
                  <p className="mt-1 text-slate-300">
                    {state.selectedCase.roleNames.join(", ")}
                  </p>
                </div>
                <p className="whitespace-pre-wrap text-xs leading-5 text-slate-400">
                  {state.selectedCase.businessContext}
                </p>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {isHost ? (
            <EventHostControlsPanel
              state={state}
              draft={draft}
              isCreatingSession={isCreatingSession}
              showCompleteDialog={showCompleteDialog}
              isCompletingEvent={isCompletingEvent}
              onShowCompleteDialog={setShowCompleteDialog}
              onCompleteEvent={() => void completeEvent()}
              onUpdateHost={updateHost}
              onCreateSession={() => void createSession()}
              createSessionError={createSessionError}
            />
          ) : null}

          {currentAssignment?.joinToken ? (
            <GlassCard elevated className="border-emerald-500/30" data-testid="assigned-session-card">
              <GlassCardContent className="space-y-3">
                <p className="text-sm text-emerald-200">{t("events.assignedToRoom")}</p>
                <p className="text-base font-semibold text-slate-50">
                  {assignedSession?.roomLabel ?? assignedSession?.title}
                </p>
                <p className="text-xs text-slate-400">
                  {currentAssignment.assignedType === "FACILITATOR"
                    ? t("participantType.FACILITATOR")
                    : currentAssignment.assignedType === "OBSERVER"
                      ? t("participantType.OBSERVER")
                      : t("participantType.PARTICIPANT")}
                  {currentAssignment.assignedRoleName
                    ? ` · ${currentAssignment.assignedRoleName}`
                    : ""}
                </p>
                {sessionRoomActive && currentAssignment.assignedSessionId ? (
                  <>
                    <GradientButtonLink
                      href={buildSessionRoomPath(
                        currentAssignment.assignedSessionId,
                        currentAssignment.joinToken,
                      )}
                      data-testid="go-to-session-room-button"
                    >
                      {t("events.goToNegotiationRoom")}
                    </GradientButtonLink>
                    <SecondaryButtonLink
                      href={buildSessionMaterialsPath(currentAssignment.joinToken)}
                      className="w-full text-center"
                      data-testid="open-session-materials-button"
                    >
                      {t("events.sessionMaterials")}
                    </SecondaryButtonLink>
                  </>
                ) : (
                  <GradientButtonLink
                    href={buildSessionMaterialsPath(currentAssignment.joinToken)}
                    data-testid="open-session-materials-button"
                  >
                    {t("events.openSessionMaterials")}
                  </GradientButtonLink>
                )}
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {participantHistoricalSessions.length > 0 ? (
            <GlassCard data-testid="my-sessions-in-event-section">
              <GlassCardContent className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">
                  {isHost ? t("events.sessionsInThisEvent") : t("events.mySessionsInThisEvent")}
                </p>
                <div className="space-y-2">
                  {participantHistoricalSessions.map((session) => {
                    const participantLink = session.participants.find(
                      (participant) =>
                        participant.eventParticipantId ===
                        state.currentParticipant?.id,
                    );

                    return (
                      <div
                        key={session.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-100">
                            {session.roomLabel ?? session.title}
                          </p>
                          <p className="text-xs text-slate-500">
                            {session.isActive
                              ? t("events.activeSession")
                              : t("events.finishedSession")}
                          </p>
                        </div>
                        {participantLink?.roomUrl ? (
                          <SecondaryButtonLink
                            href={participantLink.roomUrl}
                            data-testid="go-to-session-room-button"
                          >
                            {t("events.openRoom")}
                          </SecondaryButtonLink>
                        ) : null}
                        {participantLink?.materialsUrl ? (
                          <SecondaryButtonLink
                            href={participantLink.materialsUrl}
                            data-testid="open-session-materials-button"
                          >
                            {t("events.openSessionMaterials")}
                          </SecondaryButtonLink>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {state.sessions.length > 0 &&
          !currentAssignment?.joinToken &&
          participantHistoricalSessions.length === 0 ? (
            <GlassCard>
              <GlassCardContent>
                <p className="text-sm text-slate-400">{t("events.waitingForAssignment")}</p>
              </GlassCardContent>
            </GlassCard>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function EventCompletedOverlay({
  state,
  hostToken,
  completeMessage,
  completeWarnings,
}: {
  state: EventStateResponse;
  hostToken?: string;
  completeMessage: string | null;
  completeWarnings: string[];
}) {
  const { t } = useI18n();

  const currentAssignment = state.currentParticipant
    ? state.participants.find((participant) => participant.id === state.currentParticipant?.id)
    : null;
  const latestParticipantSession = state.currentParticipant
    ? state.sessions
        .filter((session) =>
          session.participants.some(
            (participant) =>
              participant.eventParticipantId === state.currentParticipant?.id,
          ),
        )
        .at(-1)
    : hostToken
      ? state.sessions.at(-1)
      : null;
  const latestParticipantMaterialsUrl = latestParticipantSession?.participants.find(
    (participant) =>
      participant.eventParticipantId === state.currentParticipant?.id,
  )?.materialsUrl;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#020617] px-4 py-12 text-center">
      <BrandLogo size="lg" href={hostToken ? "/events" : undefined} />
      <div className="max-w-lg space-y-3">
        <h1 className="text-2xl font-bold text-slate-50">
          {t("events.eventCompletedTitle")}
        </h1>
        {state.event.completionReason ? (
          <p className="text-sm text-slate-400">{state.event.completionReason}</p>
        ) : null}
        {completeMessage ? (
          <p className="text-sm text-emerald-400">{completeMessage}</p>
        ) : null}
        {completeWarnings.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-200">
            <p className="font-medium">{t("events.eventCompletionWarning")}</p>
            <p className="mt-1">{t("events.recordingStopWarning")}</p>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {hostToken ? (
          <GradientButtonLink href="/events">{t("events.backToEvents")}</GradientButtonLink>
        ) : null}
        {currentAssignment?.joinToken ? (
          <GradientButtonLink
            href={buildSessionMaterialsPath(currentAssignment.joinToken)}
          >
            {t("events.openSessionMaterials")}
          </GradientButtonLink>
        ) : latestParticipantMaterialsUrl ? (
          <GradientButtonLink href={latestParticipantMaterialsUrl}>
            {t("events.openSessionMaterials")}
          </GradientButtonLink>
        ) : null}
        {hostToken && latestParticipantSession ? (
          <SecondaryButtonLink href={`/sessions/${latestParticipantSession.id}`}>
            {t("events.materials")}
          </SecondaryButtonLink>
        ) : state.createdSession && !currentAssignment?.joinToken ? (
          <SecondaryButton
            type="button"
            onClick={() => {
              window.location.href = `/sessions/${state.createdSession!.id}`;
            }}
          >
            {state.createdSession.title}
          </SecondaryButton>
        ) : null}
        <GradientButtonLink href="/">{t("common.goToHome")}</GradientButtonLink>
      </div>
      <LanguageSwitcher />
    </div>
  );
}
