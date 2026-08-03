"use client";

import "@livekit/components-styles";
import "@/styles/livekit-overrides.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DifficultyBadge } from "@/components/badge";
import { CaseLanguageBadge } from "@/components/case-language-badge";
import { CompactPersonStatus } from "@/components/compact-person-status";
import { EventLobbyPresence } from "@/components/event-lobby-presence";
import { EventLobbyVideoRoom } from "@/components/event-lobby-video-room";
import { EventLobbyVoximplantRoom } from "@/components/event-lobby-voximplant-room";
import { EventCompletionDangerZone } from "@/components/event-completion-danger-zone";
import { EventSessionRoomButton } from "@/components/event-session-room-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { EventHostControlsPanel } from "@/components/event-host-controls-panel";
import { SemanticActionButton, SemanticActionLink } from "@/components/semantic-action";
import {
  GradientButtonLink,
  SecondaryButton,
  SecondaryButtonLink,
} from "@/components/ui/buttons";
import { GlassCard, GlassCardContent, GlassCardHeader } from "@/components/ui/glass-card";
import { BrandLogo } from "@/components/ui/brand-logo";
import { VisibilityBadge } from "@/components/visibility-badge";
import {
  alertErrorClassName,
} from "@/components/ui/form-styles";
import { buildAccountSessionMaterialsPath, buildAccountSessionRoomPath } from "@/lib/config";
import { resolveLobbyMediaControlPermission } from "@/lib/event-lobby-media-control-permission";
import type { EventStateResponse } from "@/lib/event-state";
import type {
  EventMediaControlAction,
  EventMediaControlCommand,
  EventMediaControlDevice,
} from "@/lib/voximplant/event-media-control-store";
import type { VoxProviderFaultMode } from "@/lib/voximplant/provider-fault-simulation";
import { resolveEventSessionPrimaryAction } from "@/lib/event-session-primary-action";
import { saveRecoveryContext, touchRecoveryContext } from "@/lib/rejoin/recovery-storage";
import { useI18n, type TranslationKey } from "@/lib/i18n/useI18n";
import { useClientConnectionId } from "@/lib/client/connection-id";
import type { EventAssignmentDraft } from "@/lib/event-assignment";
import {
  EVENT_LOBBY_POLL_INTERVAL_MS,
  getEventLobbyPollDelayMs,
  shouldApplyEventStateResponse,
} from "@/lib/event-state-polling";

const LOBBY_BOOTSTRAP_RETRY_DELAYS_MS = [250, 500, 1000] as const;

type LocalLobbyMediaController = {
  micEnabled: boolean;
  cameraEnabled: boolean;
  micBusy: boolean;
  cameraBusy: boolean;
  toggleMic: () => Promise<void> | void;
  toggleCamera: () => Promise<void> | void;
};

type EventLobbyViewProps = {
  eventId: string;
  videoProvider: "livekit" | "voximplant";
  /** E2E-only scripted transport outcome; `"off"` in every real deployment. */
  providerFaultSimulation?: VoxProviderFaultMode;
  tokenAccess?: {
    h?: string;
    p?: string;
  };
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
  t: (
    key:
      | "events.cameraUnavailable"
      | "events.cameraBusyOrUnavailable"
      | "events.microphoneUnavailable",
  ) => string,
) {
  if (warning === "cameraUnavailable" || warning === "cameraBusyOrUnavailable") {
    return t("events.cameraBusyOrUnavailable");
  }
  if (warning === "microphoneUnavailable") {
    return t("events.microphoneUnavailable");
  }
  return null;
}

function participantLocationLabel(
  participant: EventStateResponse["participants"][number],
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  if (participant.currentLocation.kind === "session") {
    return t("events.participantLocationSession", {
      title: participant.currentLocation.sessionTitle,
    });
  }
  if (participant.currentLocation.kind === "lobby") {
    return t("events.participantLocationLobby");
  }
  return t("rejoin.offline");
}

function preferenceLabel(
  preference: string,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
) {
  if (preference === "PLAY") return t("events.wantToPlay");
  if (preference === "OBSERVE") return t("events.wantToObserve");
  if (preference === "FACILITATE") return t("events.canFacilitate");
  return t("events.undecided");
}

export function EventLobbyView({
  eventId,
  videoProvider,
  providerFaultSimulation = "off",
  tokenAccess,
}: EventLobbyViewProps) {
  const hostAccessToken = tokenAccess?.h;
  const participantAccessToken = tokenAccess?.p;
  const { t } = useI18n();
  const [state, setState] = useState<EventStateResponse | null>(null);
  const [liveKit, setLiveKit] = useState<LiveKitTokenResponse | null>(null);
  const [voxReady, setVoxReady] = useState(false);
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
  const [staleConnection, setStaleConnection] = useState(false);
  const [isEditingPreference, setIsEditingPreference] = useState(false);
  const [localMediaController, setLocalMediaController] =
    useState<LocalLobbyMediaController | null>(null);
  const [pendingRemoteControlKey, setPendingRemoteControlKey] = useState<string | null>(null);
  const stateRequestSequenceRef = useRef(0);
  const latestAppliedStateRequestRef = useRef(0);
  const statePollInFlightRef = useRef(false);
  const handledMediaControlCommandsRef = useRef(new Set<string>());
  const lobbyConnectionId = useClientConnectionId(`event-lobby-${eventId}`);
  const activateStaleConnection = useCallback(() => {
    setStaleConnection(true);
  }, []);

  const applyEventState = useCallback(
    (data: EventStateResponse, requestId = ++stateRequestSequenceRef.current) => {
      if (
        !shouldApplyEventStateResponse({
          requestId,
          latestAppliedRequestId: latestAppliedStateRequestRef.current,
        })
      ) {
        return false;
      }
      latestAppliedStateRequestRef.current = requestId;
      setState(data);
      setError(null);
      return true;
    },
    [],
  );

  const accessQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (hostAccessToken) params.set("hostToken", hostAccessToken);
    if (participantAccessToken) params.set("participantToken", participantAccessToken);
    return params.toString();
  }, [hostAccessToken, participantAccessToken]);

  const fetchLiveKitToken = useCallback(async () => {
    if (!lobbyConnectionId) {
      return "retryableError" as const;
    }

    const tokenResponse = await fetch(`/api/events/${eventId}/livekit-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
        ...(participantAccessToken
          ? { participantToken: participantAccessToken }
          : {}),
        connectionId: lobbyConnectionId,
        claimLease: true,
      }),
    });

    if (tokenResponse.ok) {
      setLiveKit((await tokenResponse.json()) as LiveKitTokenResponse);
      return "ok" as const;
    }

    if (tokenResponse.status === 410) {
      setError("eventUnavailable");
      return "eventUnavailable" as const;
    }
    if (tokenResponse.status === 409) {
      const payload = (await tokenResponse.json().catch(() => ({}))) as {
        code?: string;
      };
      if (payload.code === "STALE_CONNECTION") {
        activateStaleConnection();
        return "staleConnection" as const;
      }
    }

    setLiveKit(null);
    return "retryableError" as const;
  }, [activateStaleConnection, eventId, hostAccessToken, lobbyConnectionId, participantAccessToken]);

  const fetchVoxAccess = useCallback(async () => {
    if (!lobbyConnectionId) {
      return "retryableError" as const;
    }

    const response = await fetch(`/api/events/${eventId}/voximplant-access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
        ...(participantAccessToken
          ? { participantToken: participantAccessToken }
          : {}),
        connectionId: lobbyConnectionId,
        claimLease: true,
      }),
    });
    if (response.ok) {
      setVoxReady(true);
      return "ok" as const;
    }
    if (response.status === 410) {
      setError("eventUnavailable");
      return "eventUnavailable" as const;
    }
    if (response.status === 409) {
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      if (payload.code === "STALE_CONNECTION") {
        activateStaleConnection();
        return "staleConnection" as const;
      }
    }
    setVoxReady(false);
    return "retryableError" as const;
  }, [activateStaleConnection, eventId, hostAccessToken, lobbyConnectionId, participantAccessToken]);

  const fetchState = useCallback(async (claimLease = false) => {
    if (!lobbyConnectionId) {
      return null;
    }
    const requestId = ++stateRequestSequenceRef.current;

    const params = new URLSearchParams(accessQuery);
    params.set("connectionId", lobbyConnectionId);
    if (claimLease) {
      params.set("claimLease", "1");
    }
    const response = await fetch(
      `/api/events/${eventId}/state?${params.toString()}`,
      { cache: "no-store" },
    );

    if (response.status === 410) {
      setError("eventUnavailable");
      return null;
    }
    if (response.status === 409) {
      const payload = (await response.json().catch(() => ({}))) as { code?: string };
      if (payload.code === "STALE_CONNECTION") {
        activateStaleConnection();
        return null;
      }
    }

    if (!response.ok) {
      setError("invalidAccess");
      return null;
    }

    const data = (await response.json()) as EventStateResponse;
    applyEventState(data, requestId);
    return data;
  }, [accessQuery, activateStaleConnection, applyEventState, eventId, lobbyConnectionId]);

  useEffect(() => {
    if (!lobbyConnectionId) {
      return;
    }
    const activeConnectionId = lobbyConnectionId;

    let active = true;

    async function bootstrap() {
      try {
        let stateData: EventStateResponse | null = null;
        let stateRequestId = 0;
        for (const retryDelayMs of LOBBY_BOOTSTRAP_RETRY_DELAYS_MS) {
          stateRequestId = ++stateRequestSequenceRef.current;
          const params = new URLSearchParams(accessQuery);
          params.set("connectionId", activeConnectionId);
          params.set("claimLease", "1");
          const stateResponse = await fetch(
            `/api/events/${eventId}/state?${params.toString()}`,
            {
              cache: "no-store",
            },
          );

          if (!active) return;

          if (stateResponse.status === 410) {
            setError("eventUnavailable");
            return;
          }
          if (stateResponse.status === 409) {
            const payload = (await stateResponse.json().catch(() => ({}))) as {
              code?: string;
            };
            if (payload.code === "STALE_CONNECTION") {
              activateStaleConnection();
              return;
            }
          }

          if (stateResponse.ok) {
            stateData = (await stateResponse.json()) as EventStateResponse;
            break;
          }

          await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
        }

        if (!stateData) {
          setError("invalidAccess");
          return;
        }

        applyEventState(stateData, stateRequestId);

        if (active) {
          setIsBootstrapping(false);
        }

        if (stateData.event.status === "COMPLETED") {
          return;
        }

        for (const retryDelayMs of LOBBY_BOOTSTRAP_RETRY_DELAYS_MS) {
          const providerFetchResult =
            videoProvider === "voximplant"
              ? await fetchVoxAccess()
              : await fetchLiveKitToken();
          if (!active) {
            return;
          }
          if (
            providerFetchResult === "ok" ||
            providerFetchResult === "eventUnavailable" ||
            providerFetchResult === "staleConnection"
          ) {
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, retryDelayMs));
        }
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
  }, [
    accessQuery,
    activateStaleConnection,
    applyEventState,
    eventId,
    fetchLiveKitToken,
    fetchVoxAccess,
    lobbyConnectionId,
    videoProvider,
  ]);

  useEffect(() => {
    if (staleConnection) {
      return;
    }
    let cancelled = false;
    let timeoutId: number | null = null;

    const clearScheduledPoll = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const scheduleNextPoll = (delayMs: number) => {
      clearScheduledPoll();
      timeoutId = window.setTimeout(() => {
        void runPollCycle();
      }, delayMs);
    };

    const runPollTick = async () => {
      if (cancelled || statePollInFlightRef.current) {
        return;
      }
      statePollInFlightRef.current = true;
      try {
        const latestState = await fetchState();
        if (
          latestState &&
          latestState.event.status !== "COMPLETED" &&
          videoProvider === "livekit" &&
          !liveKit
        ) {
          await fetchLiveKitToken();
        }
        if (
          latestState &&
          latestState.event.status !== "COMPLETED" &&
          videoProvider === "voximplant" &&
          !voxReady
        ) {
          await fetchVoxAccess();
        }
        touchRecoveryContext();
      } finally {
        statePollInFlightRef.current = false;
      }
    };

    const runPollCycle = async () => {
      if (cancelled) {
        return;
      }
      await runPollTick();
      if (cancelled) {
        return;
      }
      scheduleNextPoll(
        getEventLobbyPollDelayMs(document.visibilityState === "visible"),
      );
    };

    const triggerImmediatePoll = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }
      clearScheduledPoll();
      void (async () => {
        await runPollTick();
        if (!cancelled) {
          scheduleNextPoll(EVENT_LOBBY_POLL_INTERVAL_MS);
        }
      })();
    };

    scheduleNextPoll(EVENT_LOBBY_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", triggerImmediatePoll);
    window.addEventListener("focus", triggerImmediatePoll);

    return () => {
      cancelled = true;
      clearScheduledPoll();
      document.removeEventListener("visibilitychange", triggerImmediatePoll);
      window.removeEventListener("focus", triggerImmediatePoll);
    };
  }, [
    fetchLiveKitToken,
    fetchState,
    fetchVoxAccess,
    liveKit,
    staleConnection,
    videoProvider,
    voxReady,
  ]);

  useEffect(() => {
    if (!state) {
      return;
    }

    // Store only the non-secret event/session hints. No hostToken,
    // participantToken, or joinToken is ever persisted in localStorage.
    saveRecoveryContext({
      type: "EVENT_LOBBY",
      eventId,
    });

    const assignment = state.currentParticipant
      ? state.participants.find((participant) => participant.id === state.currentParticipant?.id)
      : null;

    if (assignment?.assignedSessionId) {
      saveRecoveryContext({
        type: "SESSION_JOIN",
        eventId,
        sessionId: assignment.assignedSessionId,
      });
    }
  }, [eventId, state]);

  const updateHost = useCallback(
    async (payload: Record<string, unknown>) => {
      if (staleConnection || !lobbyConnectionId) {
        return;
      }
      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
          connectionId: lobbyConnectionId,
          ...payload,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        applyEventState(data);
      } else if (response.status === 409) {
        const stalePayload = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        if (stalePayload.code === "STALE_CONNECTION") {
          activateStaleConnection();
        }
      }
    },
    [activateStaleConnection, applyEventState, eventId, hostAccessToken, lobbyConnectionId, staleConnection],
  );

  const updatePreference = useCallback(
    async (preference: string) => {
      if (staleConnection || !lobbyConnectionId) {
        return;
      }
      setState((current) =>
        current?.currentParticipant
          ? {
              ...current,
              currentParticipant: {
                ...current.currentParticipant,
                preference,
              },
              participants: current.participants.map((participant) =>
                participant.id === current.currentParticipant?.id
                  ? { ...participant, preference }
                  : participant,
              ),
            }
          : current,
      );

      const response = await fetch(`/api/events/${eventId}/participant`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(participantAccessToken
            ? { participantToken: participantAccessToken }
            : {}),
          connectionId: lobbyConnectionId,
          preference,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as EventStateResponse;
        applyEventState(data);
      } else if (response.status === 409) {
        const stalePayload = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        if (stalePayload.code === "STALE_CONNECTION") {
          activateStaleConnection();
        }
      } else {
        await fetchState();
      }
    },
    [activateStaleConnection, applyEventState, eventId, fetchState, lobbyConnectionId, participantAccessToken, staleConnection],
  );

  const createSession = useCallback(async (overrides?: {
    roomLabel?: string;
    assignmentDraft?: EventAssignmentDraft;
  }) => {
    if (staleConnection || !lobbyConnectionId) return;
    if (!state) return;
    // Guard against duplicate create from double-click / re-render.
    if (isCreatingSession) return;

    setIsCreatingSession(true);
    setCreateSessionError(null);

    try {
      const selectedCase = state.selectedCase;
      const assignmentDraft = overrides?.assignmentDraft ?? state.assignmentDraft;
      // Bug 3 fix: prefer the room label passed directly from the input (latest
      // local value) over the possibly-stale persisted draft. Fall back to the
      // persisted draft, and only to the server default when truly empty.
      const resolvedRoomLabel =
        overrides?.roomLabel?.trim() ||
        assignmentDraft.roomLabel?.trim() ||
        undefined;
      const response = await fetch(`/api/events/${eventId}/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
          connectionId: lobbyConnectionId,
          caseId: selectedCase?.id,
          roomLabel: resolvedRoomLabel,
          preparationDurationSeconds:
            assignmentDraft.preparationDurationMinutes * 60,
          negotiationDurationSeconds:
            assignmentDraft.negotiationDurationMinutes * 60,
          facilitatorEventParticipantId:
            assignmentDraft.facilitatorEventParticipantId ?? undefined,
          roleAssignments: Object.entries(
            assignmentDraft.roleAssignments,
          ).map(([caseRoleId, eventParticipantId]) => ({
            caseRoleId,
            eventParticipantId,
          })),
          observerEventParticipantIds:
            assignmentDraft.observerEventParticipantIds,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        applyEventState(data.state as EventStateResponse);
      } else if (response.status === 409) {
        const stalePayload = (await response.json().catch(() => ({}))) as {
          code?: string;
        };
        if (stalePayload.code === "STALE_CONNECTION") {
          activateStaleConnection();
          return;
        }
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
            : data.error === "facilitatorPlayerConflict" && data.participantName
              ? t("validation.facilitatorPlayerConflict")
              : t("validation.createSessionFailed"),
        );
      }
    } finally {
      setIsCreatingSession(false);
    }
  }, [activateStaleConnection, applyEventState, eventId, hostAccessToken, isCreatingSession, lobbyConnectionId, staleConnection, state, t]);

  const copyJoinLink = useCallback(async () => {
    if (!state) return;
    const url =
      state.event.visibility === "PUBLIC"
        ? `${window.location.origin}/events/join/${state.event.publicJoinCode}`
        : `${window.location.origin}/events/${eventId}/join`;
    await navigator.clipboard.writeText(url);
    setCopyMessage(t("events.linkCopied"));
    window.setTimeout(() => setCopyMessage(null), 2000);
  }, [eventId, state, t]);

  const completeEvent = useCallback(async () => {
    setIsCompletingEvent(true);
    setCompleteMessage(null);
    setCompleteWarnings([]);

    try {
      const response = await fetch(`/api/events/${eventId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hostAccessToken ? { hostToken: hostAccessToken } : {},
        ),
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
  }, [eventId, fetchState, hostAccessToken, t]);

  const acknowledgeMediaCommand = useCallback(
    async (
      command: EventMediaControlCommand,
      status: "applied" | "accepted" | "declined" | "expired" | "failed",
      resultMessage?: string,
    ) => {
      const response = await fetch(`/api/events/${eventId}/media-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
          ...(participantAccessToken ? { participantToken: participantAccessToken } : {}),
          commandId: command.id,
          status,
          ...(resultMessage ? { resultMessage } : {}),
        }),
      });
      if (response.ok) {
        await fetchState();
      }
    },
    [eventId, fetchState, hostAccessToken, participantAccessToken],
  );

  const requestParticipantMediaControl = useCallback(
    async (
      targetParticipantId: string,
      device: EventMediaControlDevice,
      action: EventMediaControlAction,
    ) => {
      if (pendingRemoteControlKey) return;
      const operationKey = `${targetParticipantId}:${device}:${action}`;
      setPendingRemoteControlKey(operationKey);
      try {
        const response = await fetch(`/api/events/${eventId}/media-control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hostAccessToken ? { hostToken: hostAccessToken } : {}),
            ...(participantAccessToken ? { participantToken: participantAccessToken } : {}),
            targetParticipantId,
            device,
            action,
          }),
        });
        if (response.ok) {
          await fetchState();
        }
      } finally {
        setPendingRemoteControlKey(null);
      }
    },
    [
      eventId,
      fetchState,
      hostAccessToken,
      participantAccessToken,
      pendingRemoteControlKey,
    ],
  );

  const isEventCompleted = state?.event.status === "COMPLETED";

  useEffect(() => {
    if (!state || !localMediaController) return;
    const currentParticipant = state.currentParticipant
      ? state.participants.find(
          (participant) => participant.id === state.currentParticipant?.id,
        )
      : null;
    const canConsumeLobbyMediaCommands =
      currentParticipant?.eventPresenceStatus === "IN_LOBBY";
    for (const command of state.mediaControlCommands) {
      if (command.action !== "disable") continue;
      if (handledMediaControlCommandsRef.current.has(command.id)) continue;
      handledMediaControlCommandsRef.current.add(command.id);
      void (async () => {
        if (!canConsumeLobbyMediaCommands) {
          await acknowledgeMediaCommand(command, "expired", "targetLeftEventLobby");
          return;
        }
        const isAlreadyDisabled =
          command.device === "mic"
            ? !localMediaController.micEnabled
            : !localMediaController.cameraEnabled;
        if (!isAlreadyDisabled) {
          await (command.device === "mic"
            ? localMediaController.toggleMic()
            : localMediaController.toggleCamera());
        }
        await acknowledgeMediaCommand(command, "applied");
      })().catch(() => {
        void acknowledgeMediaCommand(command, "failed", "localMediaOperationFailed");
      });
    }
  }, [acknowledgeMediaCommand, localMediaController, state]);

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
  // isHost: system-level host capabilities (used for API calls, read-only display decisions)
  const isHost = state.isHost || Boolean(hostAccessToken);
  // isEventOwner: this user is the designated host/facilitator of THIS event.
  // Only isEventOwner sees the host-controls panel and the "copy join link" button.
  // A system admin opening another user's event gets participant view.
  const isEventOwner = state.isEventOwner || Boolean(hostAccessToken);
  const currentAssignment = state.currentParticipant
    ? state.participants.find((p) => p.id === state.currentParticipant?.id)
    : null;
  const currentAssignmentOrNull = currentAssignment ?? null;
  const assignedSession = currentAssignment?.assignedSessionId
    ? state.sessions.find(
        (session) => session.id === currentAssignment.assignedSessionId,
      )
    : null;
  const participantHistoricalSessions = state.currentParticipant
    ? state.sessions.filter((session) =>
        session.participants.some(
          (participant) =>
            participant.eventParticipantId === state.currentParticipant?.id,
        ),
      )
    : [];
  const showOwnerHostManagement = isEventOwner && !staleConnection;
  const mySessionsInEvent =
    !showOwnerHostManagement && state.currentParticipant
      ? participantHistoricalSessions.filter(
          (session) => session.id !== currentAssignment?.assignedSessionId,
        )
      : [];
  const mySessionIdSet = new Set(mySessionsInEvent.map((session) => session.id));
  const observerActiveSessions =
    !showOwnerHostManagement &&
    state.currentParticipant &&
    !currentAssignment?.assignedSessionId
      ? state.sessions.filter(
          (session) =>
            !mySessionIdSet.has(session.id) &&
            session.sessionDisplayState === "joinable" &&
            Boolean(session.observerJoinUrl),
        )
      : [];
  const observerMaterialsOnlySessions =
    !showOwnerHostManagement &&
    state.currentParticipant &&
    !currentAssignment?.assignedSessionId
      ? state.sessions.filter(
          (session) =>
            !mySessionIdSet.has(session.id) &&
            session.sessionDisplayState === "materials-only",
        )
      : [];
  const staleLobbyMessage = t("events.lobbyTakeoverDisconnected");

  if (isEventCompleted) {
    return (
      <EventCompletedOverlay
        state={state}
        hostToken={hostAccessToken}
        participantTokenProvided={Boolean(participantAccessToken)}
        completeMessage={completeMessage}
        completeWarnings={completeWarnings}
      />
    );
  }

  const pendingEnableRequest =
    state.participants.find((participant) => participant.id === state.currentParticipant?.id)
      ?.eventPresenceStatus === "IN_LOBBY"
      ? state.mediaControlCommands.find((command) => command.action === "enable_request") ?? null
      : null;

  return (
    <div className="fixed inset-0 flex min-h-0 flex-col overflow-hidden bg-[#020617]" data-testid="event-lobby-page">
      {/* Render in all lobby modes. In account mode (no token), the heartbeat
          endpoint resolves presence via the authenticated user session. */}
      <EventLobbyPresence
        eventId={eventId}
        participantToken={participantAccessToken}
        hostToken={hostAccessToken}
      />
      <header className="glass-header border-b border-slate-700/40 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <SecondaryButtonLink
              href="/events"
              className="hidden px-3 py-1.5 text-xs sm:inline-flex"
              aria-label={t("events.backToEventsCompact")}
              title={t("events.backToEventsCompact")}
              data-testid="back-to-events-button"
            >
              {t("events.backToEventsCompact")}
            </SecondaryButtonLink>
            <BrandLogo
              size="sm"
              variant="session"
              priority
              href={isHost ? "/events" : undefined}
              className="hidden sm:inline-flex"
            />
            <BrandLogo
              size="sm"
              variant="compact"
              priority
              href={isHost ? "/events" : undefined}
              className="sm:hidden"
            />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-cyan-400/80">
                {t("events.eventLobby")}
              </p>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-50">{state.event.title}</h1>
                <VisibilityBadge visibility={state.event.visibility} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isEventOwner ? (
              <SecondaryButton type="button" onClick={() => void copyJoinLink()}>
                {t("events.copyEventJoinLink")}
              </SecondaryButton>
            ) : null}
            <LanguageSwitcher />
          </div>
        </div>
        {copyMessage ? (
          <p className="mx-auto mt-2 max-w-[1600px] text-sm text-emerald-400">{copyMessage}</p>
        ) : null}
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-y-auto p-4 lg:flex-row lg:overflow-hidden">
        <section
          className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-600/25"
          data-testid="event-lobby-video-area"
        >
          <div className="shrink-0 border-b border-slate-600/25 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-50">{t("events.commonLobby")}</h2>
            <p className="text-xs text-slate-400">
              {liveKit?.displayName ?? state.currentParticipant?.displayName ?? ""}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{t("events.singleDeviceHint")}</p>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black/40">
            {staleConnection ? (
              <div
                className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
                data-testid="event-lobby-stale-connection-banner"
              >
                <p>{staleLobbyMessage}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <SecondaryButton
                    type="button"
                    className="px-2 py-1 text-xs"
                    onClick={() => window.location.reload()}
                    data-testid="event-lobby-reconnect-button"
                  >
                    {t("events.reconnectLobby")}
                  </SecondaryButton>
                  <SecondaryButtonLink
                    href="/events"
                    className="px-2 py-1 text-xs"
                    data-testid="event-lobby-return-events-button"
                  >
                    {t("events.backToEventsCompact")}
                  </SecondaryButtonLink>
                </div>
              </div>
            ) : null}
            {deviceWarning ? (
              <p className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                {deviceWarningLabel(deviceWarning, t)}
              </p>
            ) : null}
            {staleConnection ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="max-w-md text-sm text-amber-200">{staleLobbyMessage}</p>
              </div>
            ) : videoProvider === "livekit" && liveKit ? (
              <EventLobbyVideoRoom
                token={liveKit.token}
                serverUrl={liveKit.serverUrl}
                onDeviceWarning={setDeviceWarning}
                onLocalMediaControllerChange={setLocalMediaController}
              />
            ) : videoProvider === "voximplant" &&
              (voxReady || providerFaultSimulation !== "off") &&
              lobbyConnectionId ? (
              <EventLobbyVoximplantRoom
                eventId={eventId}
                hostToken={hostAccessToken}
                participantToken={participantAccessToken}
                connectionId={lobbyConnectionId}
                participants={state.participants}
                providerFaultSimulation={providerFaultSimulation}
                onStaleConnection={activateStaleConnection}
                onDeviceWarning={setDeviceWarning}
                onLocalMediaControllerChange={setLocalMediaController}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                {t("common.loading")}…
              </div>
            )}
          </div>
        </section>

        <aside className="glass-panel flex min-h-0 w-full flex-col gap-4 overflow-visible rounded-2xl border border-slate-600/25 p-4 lg:w-[380px] lg:shrink-0 lg:overflow-y-auto xl:w-[420px]">
          {state.currentParticipant ? (
            <DesiredRolePreferenceCard
              participant={state.currentParticipant}
              currentAssignment={currentAssignmentOrNull}
              staleConnection={staleConnection}
              isEditing={isEditingPreference || state.currentParticipant.preference === "UNDECIDED"}
              onEdit={() => setIsEditingPreference(true)}
              onCancel={() => setIsEditingPreference(false)}
              onUpdatePreference={(nextPreference) => {
                void updatePreference(nextPreference);
                setIsEditingPreference(false);
              }}
            />
          ) : null}

          {state.currentParticipant && !staleConnection ? (
            <MySessionCard
              currentAssignment={currentAssignmentOrNull}
              assignedSession={assignedSession}
            />
          ) : null}

          {observerActiveSessions.length > 0 ? (
            <GlassCard
              elevated
              className="border-cyan-400/40 bg-cyan-950/15"
              data-testid="available-observer-session-section"
            >
              <GlassCardContent className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-cyan-100">
                    {t("events.availableToObserve")}
                  </p>
                  <p className="mt-1 text-xs text-cyan-200/75">
                    {t("events.availableToObserveHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  {observerActiveSessions.map((session) => {
                    const statusLabel =
                      t(
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
                      <article
                        key={session.id}
                        className="rounded-xl border border-cyan-400/35 bg-slate-950/60 px-3 py-3 shadow-[0_0_24px_rgba(34,211,238,0.08)]"
                        data-testid="available-observer-session-card"
                        data-session-access-state={session.sessionDisplayState}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-semibold text-slate-50">
                              {session.roomLabel ?? session.title}
                            </p>
                            <p className="mt-0.5 break-words text-xs text-slate-400">
                              {session.caseTitle}
                            </p>
                            <span
                              className="mt-2 inline-flex rounded-full border border-emerald-400/45 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-100"
                              data-testid="available-observer-session-status"
                            >
                              {statusLabel}
                            </span>
                          </div>
                          <SemanticActionLink
                            href={session.observerJoinUrl!}
                            actionKind="PRIMARY_PROGRESS"
                            actionTarget={session.observerJoinUrl!}
                            className="shrink-0"
                            data-testid="join-session-as-observer"
                          >
                            {t("events.joinAsObserver")}
                          </SemanticActionLink>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          <details open className="rounded-2xl border border-slate-700/40 bg-slate-900/20" data-testid="lobby-panel-participants">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-50">
              {t("events.participantsInLobby")}
            </summary>
            <div className="border-t border-slate-700/30 px-4 py-3 space-y-2">
              <p className="text-[11px] text-slate-500">
                {t("events.presenceLegend")}
              </p>
              {state.participants.length === 0 ? (
                <p className="text-sm text-slate-400">{t("events.noParticipantsYet")}</p>
              ) : (
                state.participants.map((participant) => {
                  const isCurrentUser =
                    participant.id === state.currentParticipant?.id;
                  const mediaPermission = resolveLobbyMediaControlPermission({
                    actor: {
                      participantId: state.currentParticipant?.id ?? null,
                      isEventOwner,
                    },
                    target: {
                      participantId: participant.id,
                    },
                    targetPresence: {
                      state: participant.eventPresenceStatus,
                    },
                    device: "mic",
                  });
                  const canUseSelfControls =
                    mediaPermission.allowed &&
                    mediaPermission.controlKind === "self" &&
                    Boolean(localMediaController);
                  const canOwnerControlOther =
                    mediaPermission.allowed &&
                    mediaPermission.controlKind === "remote" &&
                    !isCurrentUser &&
                    !staleConnection;
                  const buildOwnerControl = (
                    device: EventMediaControlDevice,
                    enabled: boolean | null,
                  ) => {
                    if (!canOwnerControlOther || enabled === null) return undefined;
                    const action: EventMediaControlAction = enabled ? "disable" : "enable_request";
                    const operationKey = `${participant.id}:${device}:${action}`;
                    return {
                      label:
                        device === "mic"
                          ? enabled
                            ? t("events.disableParticipantMicrophone")
                            : t("events.requestParticipantMicrophone")
                          : enabled
                            ? t("events.disableParticipantCamera")
                            : t("events.requestParticipantCamera"),
                      disabled: pendingRemoteControlKey !== null,
                      busy: pendingRemoteControlKey === operationKey,
                      onClick: () => {
                        void requestParticipantMediaControl(participant.id, device, action);
                      },
                    };
                  };
                  const mediaControls = canUseSelfControls
                    ? {
                        mic: {
                          label: localMediaController!.micEnabled
                            ? t("events.turnOffOwnMicrophone")
                            : t("events.turnOnOwnMicrophone"),
                          disabled: localMediaController!.micBusy,
                          busy: localMediaController!.micBusy,
                          onClick: () => void localMediaController!.toggleMic(),
                        },
                        camera: {
                          label: localMediaController!.cameraEnabled
                            ? t("events.turnOffOwnCamera")
                            : t("events.turnOnOwnCamera"),
                          disabled: localMediaController!.cameraBusy,
                          busy: localMediaController!.cameraBusy,
                          onClick: () => void localMediaController!.toggleCamera(),
                        },
                      }
                    : canOwnerControlOther
                      ? {
                          mic: buildOwnerControl("mic", participant.micEnabled),
                          camera: buildOwnerControl("camera", participant.cameraEnabled),
                        }
                      : undefined;

                  return (
                  <div
                    key={participant.id}
                    data-testid="participant-card"
                    className="rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2"
                  >
                    <CompactPersonStatus
                      displayName={participant.displayName}
                      caseRoleName={participant.assignedRoleName}
                      participantType={participant.assignedType}
                      assignmentLabel={participant.activeAssignmentLabel}
                      preferenceLabel={preferenceLabel(participant.preference, t)}
                      isHost={participant.isHost}
                      presenceStatus={participant.eventPresenceStatus}
                      locationLabel={
                        participant.eventPresenceStatus === "IN_SESSION"
                          ? participantLocationLabel(participant, t)
                          : null
                      }
                      micEnabled={
                        canUseSelfControls
                          ? localMediaController!.micEnabled
                          : participant.micEnabled
                      }
                      cameraEnabled={
                        canUseSelfControls
                          ? localMediaController!.cameraEnabled
                          : participant.cameraEnabled
                      }
                      mediaControls={mediaControls}
                    />
                  </div>
                  );
                })
              )}
            </div>
          </details>

          {state.selectedCase && !isEventOwner ? (
            <details open className="rounded-2xl border border-slate-700/40 bg-slate-900/20" data-testid="lobby-panel-selected-case">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-50">
                {t("events.selectedCase")}
              </summary>
              <div className="border-t border-slate-700/30 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CaseLanguageBadge caseLanguage={state.selectedCase.caseLanguage} />
                </div>
              </div>
              <div className="px-4 pb-4 space-y-3 text-sm">
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
              </div>
            </details>
          ) : null}

          {showOwnerHostManagement ? (
            <EventHostControlsPanel
              state={state}
              draft={draft}
              hostToken={hostAccessToken}
              isCreatingSession={isCreatingSession}
              onUpdateHost={updateHost}
              onCreateSession={(overrides) => void createSession(overrides)}
              createSessionError={createSessionError}
            />
          ) : null}

          {mySessionsInEvent.length > 0 && !showOwnerHostManagement ? (
            <GlassCard data-testid="my-sessions-in-event-section">
              <GlassCardContent className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">
                  {isEventOwner ? t("events.sessionsInThisEvent") : t("events.mySessionsInThisEvent")}
                </p>
                <div className="space-y-2">
                  {mySessionsInEvent.map((session) => {
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
                        {participantLink ? (
                          <EventSessionRoomButton
                            roomAccessDecision={session.roomAccessDecision}
                            roomHref={participantLink.roomUrl}
                            materialsHref={participantLink.materialsUrl}
                            redirectHref={session.roomAccessRedirectTo}
                          />
                        ) : null}
                        {participantLink?.materialsUrl &&
                        (() => {
                          const primaryAction = resolveEventSessionPrimaryAction({
                            roomAccessDecision: session.roomAccessDecision,
                            roomHref: participantLink.roomUrl,
                            materialsHref: participantLink.materialsUrl,
                            redirectHref: session.roomAccessRedirectTo,
                          });
                          return !primaryAction ||
                            primaryAction.kind === "OPEN_ROOM" ||
                            primaryAction.kind === "RETURN_TO_DEBRIEF";
                        })() ? (
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

          {observerMaterialsOnlySessions.length > 0 ? (
            <GlassCard data-testid="sessions-without-my-participation-section">
              <GlassCardContent className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">
                  {t("events.sessionsWithoutMyParticipation")}
                </p>
                <div className="space-y-2">
                  {observerMaterialsOnlySessions.map((session) => (
                    <article
                      key={session.id}
                      className="rounded-lg border border-slate-600/30 bg-slate-900/50 px-3 py-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-100">
                            {session.roomLabel ?? session.title}
                          </p>
                          <p className="text-xs text-slate-400">{session.caseTitle}</p>
                        </div>
                        {session.observerMaterialsUrl ? (
                          <SecondaryButtonLink
                            href={session.observerMaterialsUrl}
                            data-testid="open-observer-session-materials"
                          >
                            {t("events.openMaterialsAction")}
                          </SecondaryButtonLink>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {state.sessions.length > 0 &&
          !currentAssignment?.assignedSessionId &&
          mySessionsInEvent.length === 0 &&
          observerActiveSessions.length === 0 &&
          observerMaterialsOnlySessions.length === 0 ? (
            <GlassCard>
              <GlassCardContent>
                <p className="text-sm text-slate-400">{t("events.waitingForAssignment")}</p>
              </GlassCardContent>
            </GlassCard>
          ) : null}

          {showOwnerHostManagement ? (
            <EventCompletionDangerZone
              showCompleteDialog={showCompleteDialog}
              isCompletingEvent={isCompletingEvent}
              onShowCompleteDialog={setShowCompleteDialog}
              onCompleteEvent={() => void completeEvent()}
            />
          ) : null}
        </aside>
      </div>
      {pendingEnableRequest ? (
        <MediaEnableRequestDialog
          command={pendingEnableRequest}
          localMediaController={localMediaController}
          onAccept={(command) => {
            if (!localMediaController) {
              void acknowledgeMediaCommand(command, "failed", "localMediaUnavailable");
              return;
            }
            void (async () => {
              const alreadyEnabled =
                command.device === "mic"
                  ? localMediaController.micEnabled
                  : localMediaController.cameraEnabled;
              if (!alreadyEnabled) {
                await (command.device === "mic"
                  ? localMediaController.toggleMic()
                  : localMediaController.toggleCamera());
              }
              await acknowledgeMediaCommand(command, "accepted");
            })().catch(() => {
              void acknowledgeMediaCommand(command, "failed", "localMediaOperationFailed");
            });
          }}
          onDecline={(command) => {
            void acknowledgeMediaCommand(command, "declined");
          }}
        />
      ) : null}
    </div>
  );
}

function DesiredRolePreferenceCard({
  participant,
  currentAssignment,
  staleConnection,
  isEditing,
  onEdit,
  onCancel,
  onUpdatePreference,
}: {
  participant: NonNullable<EventStateResponse["currentParticipant"]>;
  currentAssignment: EventStateResponse["participants"][number] | null;
  staleConnection: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onUpdatePreference: (preference: string) => void;
}) {
  const { t } = useI18n();
  const selectedLabel = preferenceLabel(participant.preference, t);

  return (
    <GlassCard elevated data-testid="desired-role-card">
      <GlassCardHeader>
        <CompactPersonStatus
          displayName={participant.displayName}
          caseRoleName={currentAssignment?.assignedRoleName}
          participantType={currentAssignment?.assignedType}
          isHost={currentAssignment?.isHost}
        />
      </GlassCardHeader>
      <GlassCardContent className="space-y-3">
        {!isEditing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-300" data-testid="desired-role-summary">
              {t("events.desiredRoleSelected", { role: selectedLabel })}
            </p>
            <SemanticActionButton
              type="button"
              actionKind="NAVIGATION"
              size="compact"
              aria-expanded={false}
              aria-controls="desired-role-options"
              onClick={onEdit}
              data-testid="desired-role-change-button"
            >
              {t("events.changeDesiredRole")}
            </SemanticActionButton>
          </div>
        ) : (
          <div className="space-y-3" id="desired-role-options" data-testid="desired-role-options">
            <div>
              <p className="text-xs font-medium text-slate-400">{t("events.desiredRole")}</p>
              <p className="mt-1 text-xs text-slate-500">{t("events.desiredRoleHelp")}</p>
            </div>
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
                  disabled={staleConnection}
                  onClick={() => {
                    if (!staleConnection) {
                      onUpdatePreference(value);
                    }
                  }}
                  className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${
                    participant.preference === value
                      ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                      : "border-slate-600/40 bg-slate-900/50 text-slate-300 hover:border-slate-500/50"
                  } ${staleConnection ? "cursor-not-allowed opacity-50 hover:border-slate-600/40" : ""}`}
                  aria-pressed={participant.preference === value}
                  aria-disabled={staleConnection}
                  data-testid="desired-role-option"
                >
                  {label}
                </button>
              ))}
            </div>
            {participant.preference !== "UNDECIDED" ? (
              <SemanticActionButton
                type="button"
                actionKind="NAVIGATION"
                size="compact"
                aria-expanded
                aria-controls="desired-role-options"
                onClick={onCancel}
                data-testid="desired-role-cancel-button"
              >
                {t("common.cancel")}
              </SemanticActionButton>
            ) : null}
            {staleConnection ? (
              <p className="text-xs text-amber-300">
                {t("events.lobbyActionsDisabledInStaleTab")}
              </p>
            ) : null}
          </div>
        )}
      </GlassCardContent>
    </GlassCard>
  );
}

function MediaEnableRequestDialog({
  command,
  localMediaController,
  onAccept,
  onDecline,
}: {
  command: EventMediaControlCommand;
  localMediaController: LocalLobbyMediaController | null;
  onAccept: (command: EventMediaControlCommand) => void;
  onDecline: (command: EventMediaControlCommand) => void;
}) {
  const { t } = useI18n();
  const titleId = `media-enable-request-title-${command.id}`;
  const descriptionId = `media-enable-request-description-${command.id}`;
  const isBusy =
    command.device === "mic"
      ? Boolean(localMediaController?.micBusy)
      : Boolean(localMediaController?.cameraBusy);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-[#020617]/80 backdrop-blur-sm" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md rounded-xl border border-slate-700/60 bg-slate-900/95 p-6 shadow-2xl shadow-black/50 ring-1 ring-slate-600/30"
        data-testid="media-enable-request-dialog"
      >
        <h2 id={titleId} className="text-lg font-semibold text-slate-50">
          {command.device === "mic"
            ? t("events.microphoneEnableRequested")
            : t("events.cameraEnableRequested")}
        </h2>
        <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-400">
          {t("events.mediaEnableRequestBody", {
            name: command.requestedByDisplayName,
            device:
              command.device === "mic"
                ? t("events.microphoneDevice")
                : t("events.cameraDevice"),
          })}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <SecondaryButton
            type="button"
            disabled={isBusy}
            onClick={() => onDecline(command)}
            data-testid="decline-media-enable-request"
          >
            {t("events.declineMediaEnableRequest")}
          </SecondaryButton>
          <SemanticActionButton
            type="button"
            actionKind="MANAGEMENT"
            disabled={isBusy || !localMediaController}
            onClick={() => onAccept(command)}
            data-testid="accept-media-enable-request"
          >
            {isBusy ? t("common.loading") : t("events.acceptMediaEnableRequest")}
          </SemanticActionButton>
        </div>
      </div>
    </div>
  );
}

function MySessionCard({
  currentAssignment,
  assignedSession,
}: {
  currentAssignment: EventStateResponse["participants"][number] | null;
  assignedSession: EventStateResponse["sessions"][number] | null | undefined;
}) {
  const { t } = useI18n();
  const assignedSessionId = currentAssignment?.assignedSessionId ?? null;
  const roomHref =
    currentAssignment?.roomUrl ??
    (assignedSessionId ? buildAccountSessionRoomPath(assignedSessionId) : null);
  const materialsHref =
    currentAssignment?.materialsUrl ??
    (assignedSessionId ? buildAccountSessionMaterialsPath(assignedSessionId) : null);
  const primaryAction = resolveEventSessionPrimaryAction({
    roomAccessDecision: assignedSession?.roomAccessDecision ?? null,
    roomHref,
    materialsHref,
    redirectHref: assignedSession?.roomAccessRedirectTo ?? null,
  });
  const showSecondaryMaterials =
    Boolean(materialsHref) &&
    (!primaryAction ||
      primaryAction.kind === "OPEN_ROOM" ||
      primaryAction.kind === "RETURN_TO_DEBRIEF");

  return (
    <GlassCard elevated className="border-emerald-500/30" data-testid="my-session-card">
      <div data-testid="assigned-session-card">
        <GlassCardHeader>
          <h3 className="text-sm font-semibold text-slate-50">{t("events.mySession")}</h3>
          <p className="text-xs text-slate-400">{t("events.mySessionSubtitle")}</p>
        </GlassCardHeader>
        <GlassCardContent className="space-y-3">
          {currentAssignment?.assignedSessionId ? (
            <>
              <p className="text-sm text-emerald-200">{t("events.assignedToRoom")}</p>
              <p className="truncate text-base font-semibold text-slate-50">
                {assignedSession?.roomLabel ?? assignedSession?.title}
              </p>
              <CompactPersonStatus
                displayName={currentAssignment.displayName}
                caseRoleName={currentAssignment.assignedRoleName}
                participantType={currentAssignment.assignedType}
                assignmentLabel={assignedSession?.roomLabel ?? assignedSession?.title}
                micEnabled={currentAssignment.micEnabled}
                cameraEnabled={currentAssignment.cameraEnabled}
              />
              {primaryAction ? (
                <EventSessionRoomButton
                  roomAccessDecision={assignedSession?.roomAccessDecision ?? null}
                  roomHref={roomHref}
                  materialsHref={materialsHref}
                  redirectHref={assignedSession?.roomAccessRedirectTo ?? null}
                  testId="go-to-session-room-button"
                />
              ) : null}
              {showSecondaryMaterials && materialsHref ? (
                <SemanticActionLink
                  href={materialsHref}
                  actionKind="REVIEW_RESULTS"
                  actionTarget={materialsHref}
                  className="w-full text-center"
                  data-testid="open-session-materials-button"
                >
                  {t("events.sessionMaterials")}
                </SemanticActionLink>
              ) : null}
            </>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">
                {t("events.noCurrentSessionAssignment")}
              </p>
              <p className="text-xs text-slate-400">{t("events.waitingForAssignment")}</p>
            </div>
          )}
        </GlassCardContent>
      </div>
    </GlassCard>
  );
}

function EventCompletedOverlay({
  state,
  hostToken,
  participantTokenProvided,
  completeMessage,
  completeWarnings,
}: {
  state: EventStateResponse;
  hostToken?: string;
  participantTokenProvided: boolean;
  completeMessage: string | null;
  completeWarnings: string[];
}) {
  const { t } = useI18n();
  const isOwnerView = Boolean(hostToken || state.isEventOwner);
  const isTokenOnlyParticipant = !isOwnerView && participantTokenProvided;

  const ownerAccessibleSessions = state.sessions
    .filter((session) => Boolean(session.materialsUrl))
    .map((session) => ({
      id: session.id,
      title: session.roomLabel ?? session.title,
      caseTitle: session.caseTitle,
      negotiationState: session.negotiationState,
      materialsUrl: session.materialsUrl!,
    }));

  const participantAccessibleSessions = state.currentParticipant
    ? state.sessions
        .map((session) => {
          const participantSessionLink = session.participants.find(
            (participant) =>
              participant.eventParticipantId === state.currentParticipant?.id &&
              Boolean(participant.materialsUrl),
          );
          if (!participantSessionLink?.materialsUrl) {
            return null;
          }
          return {
            id: session.id,
            title: session.roomLabel ?? session.title,
            caseTitle: session.caseTitle,
            negotiationState: session.negotiationState,
            materialsUrl: participantSessionLink.materialsUrl,
          };
        })
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
    : [];

  const accessibleSessions = isOwnerView
    ? ownerAccessibleSessions
    : participantAccessibleSessions;
  const showBackToEvents = isOwnerView || !isTokenOnlyParticipant;

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#020617] px-4 py-8 sm:py-12"
      data-testid="event-completed-overlay"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-slate-700/40 bg-slate-900/40 p-5 sm:p-6">
        <div className="flex justify-center">
          <BrandLogo size="lg" href={showBackToEvents ? "/events" : undefined} />
        </div>

        <div className="mx-auto mt-5 max-w-2xl space-y-2 text-center">
          <h1 className="text-2xl font-bold text-slate-50">{t("events.eventCompletedTitle")}</h1>
          <p className="text-sm text-slate-400">{t("events.eventCompletedSubtitle")}</p>
          {state.event.completionReason ? (
            <p className="text-sm text-slate-400">{state.event.completionReason}</p>
          ) : null}
          {completeMessage ? (
            <p className="text-sm text-emerald-400">{completeMessage}</p>
          ) : null}
        </div>

        {completeWarnings.length > 0 ? (
          <div className="mx-auto mt-4 max-w-2xl rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-200">
            <p className="font-medium">{t("events.eventCompletionWarning")}</p>
            <p className="mt-1">{t("events.recordingStopWarning")}</p>
          </div>
        ) : null}

        <section className="mx-auto mt-6 max-w-3xl" data-testid="completed-event-session-list-section">
          <p className="text-sm font-semibold text-slate-100">{t("events.eventSessionsSectionTitle")}</p>
          <p className="mt-1 text-xs text-slate-400">{t("events.sessionMaterialsSectionSubtitle")}</p>

          {accessibleSessions.length > 0 ? (
            <div
              className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2"
              data-testid="completed-event-session-list"
            >
              {accessibleSessions.map((session) => {
                const isUnexpectedState = session.negotiationState !== "FINISHED";
                const sessionStatusLabel = isUnexpectedState
                  ? t(
                      `status.${session.negotiationState}` as
                        | "status.PREPARATION"
                        | "status.PREPARATION_RUNNING"
                        | "status.PREPARATION_PAUSED"
                        | "status.READY_TO_START"
                        | "status.RUNNING"
                        | "status.PAUSED"
                        | "status.FINISHED",
                    )
                  : t("events.completedSessionStatus");

                return (
                  <article
                    key={session.id}
                    className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-700/35 bg-slate-900/60 p-4"
                    data-testid="completed-event-session-card"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-50">{session.title}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-400">{session.caseTitle}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        data-testid="event-session-status-badge"
                        data-session-state={isUnexpectedState ? session.negotiationState : "completed"}
                        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                          isUnexpectedState
                            ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        }`}
                      >
                        {sessionStatusLabel}
                      </span>
                    </div>
                    <GradientButtonLink
                      href={session.materialsUrl}
                      className="w-full"
                      data-testid="completed-event-session-materials-link"
                    >
                      {t("events.openMaterialsAction")}
                    </GradientButtonLink>
                  </article>
                );
              })}
            </div>
          ) : (
            <div
              className="mt-3 rounded-xl border border-slate-700/35 bg-slate-900/55 p-4 text-sm text-slate-300"
              data-testid="completed-event-session-empty-state"
            >
              {t("events.noAccessibleSessionsForCompletedEvent")}
            </div>
          )}
        </section>

        <div className="mt-6 flex flex-wrap justify-center gap-3 border-t border-slate-700/40 pt-5">
          {showBackToEvents ? (
            <SecondaryButtonLink href="/events">{t("events.backToEvents")}</SecondaryButtonLink>
          ) : null}
          <GradientButtonLink href="/">{t("common.goToHome")}</GradientButtonLink>
        </div>
      </div>

      <LanguageSwitcher />
    </div>
  );
}
