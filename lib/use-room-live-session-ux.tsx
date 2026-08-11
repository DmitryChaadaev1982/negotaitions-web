"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ControlState } from "@/lib/negotiation-control";
import type { ShellSessionCloseState } from "@/lib/room-provider/types";
import {
  canUseFinishLinePresentation,
  coalesceFinishLineDeadlineMs,
  computeFinishLineClientDeadlineMs,
  deriveLiveSessionPresentationState,
  resolveFinishLineVariant,
  type LiveSessionPresentationState,
} from "@/lib/live-session-presentation";
import {
  buildLiveSessionSnapshot,
  createLiveSessionTransitionMachineState,
  reduceLiveSessionTransition,
} from "@/lib/live-session-transitions";
import {
  ensureSemanticRoomAudioContextRunning,
  getSemanticRoomAudioContext,
  isSemanticRoomAudioContextRunning,
  playSemanticRoomAudioCue,
  subscribeSemanticRoomAudioContextRunning,
} from "@/lib/semantic-room-audio";
import { useI18n } from "@/lib/i18n/useI18n";

type SoundControlState = "OFF" | "ENABLED";

export type LiveSessionAnnouncement = {
  id: number;
  text: string;
} | null;

type RoomLiveSessionUxResult = {
  presentationState: LiveSessionPresentationState;
  isFinishLineActive: boolean;
  finishLineVariant: "TIMER_EXPIRED" | "MANUAL_FINISH" | null;
  announcement: LiveSessionAnnouncement;
  soundControlState: SoundControlState;
  soundRuntimeReady: boolean;
  soundControlBusy: boolean;
  onSoundControlPress: (uiState?: SoundControlState) => Promise<void>;
};

export function useRoomLiveSessionUx(params: {
  controlState: ControlState;
  sessionCloseState: ShellSessionCloseState;
}): RoomLiveSessionUxResult {
  const { controlState, sessionCloseState } = params;
  const { t } = useI18n();

  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined"
      ? true
      : document.visibilityState === "visible",
  );
  const [finishLineDeadlineMs, setFinishLineDeadlineMs] = useState<number | null>(
    null,
  );
  const [finishLineClockMs, setFinishLineClockMs] = useState(() => Date.now());
  const [announcement, setAnnouncement] = useState<LiveSessionAnnouncement>(null);
  const announcementIdRef = useRef(0);

  const [soundPreferenceEnabled, setSoundPreferenceEnabled] = useState(true);
  const [soundPreferencePending, setSoundPreferencePending] = useState(false);
  const [soundUnlockPending, setSoundUnlockPending] = useState(false);
  const [audioContextRunning, setAudioContextRunning] = useState(() =>
    isSemanticRoomAudioContextRunning(),
  );

  const transitionStateRef = useRef(createLiveSessionTransitionMachineState());

  const finishLineEligible = canUseFinishLinePresentation({
    negotiationState: controlState.negotiationState,
    closeMessageKey: sessionCloseState.closeMessageKey,
  });

  useEffect(() => {
    const onVisibilityChange = () => {
      const nextVisible = document.visibilityState === "visible";
      setIsDocumentVisible(nextVisible);
      if (nextVisible) {
        setFinishLineClockMs(Date.now());
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/account/session-sound-preference", {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          sessionSoundEnabled?: boolean;
        };
        if (!cancelled && typeof payload.sessionSoundEnabled === "boolean") {
          setSoundPreferenceEnabled(payload.sessionSoundEnabled);
        }
      } catch {
        // Preference load failures are non-blocking by contract.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function persistSoundPreference(nextEnabled: boolean) {
    const previousEnabled = soundPreferenceEnabled;
    setSoundPreferenceEnabled(nextEnabled);
    setSoundPreferencePending(true);
    try {
      const response = await fetch("/api/account/session-sound-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionSoundEnabled: nextEnabled }),
      });
      if (!response.ok) {
        throw new Error("soundPreferenceUpdateFailed");
      }
      const payload = (await response.json()) as {
        sessionSoundEnabled?: boolean;
      };
      if (typeof payload.sessionSoundEnabled === "boolean") {
        setSoundPreferenceEnabled(payload.sessionSoundEnabled);
      }
      return true;
    } catch {
      setSoundPreferenceEnabled(previousEnabled);
      return false;
    } finally {
      setSoundPreferencePending(false);
    }
  }

  const ensureAudioContextRunning = useCallback(async () => {
    const isRunning = await ensureSemanticRoomAudioContextRunning();
    setAudioContextRunning(isRunning);
    return isRunning;
  }, []);

  useEffect(() => {
    if (!soundPreferenceEnabled || audioContextRunning) {
      return;
    }
    queueMicrotask(() => {
      void ensureAudioContextRunning();
    });
  }, [audioContextRunning, ensureAudioContextRunning, soundPreferenceEnabled]);

  useEffect(() => {
    return subscribeSemanticRoomAudioContextRunning(setAudioContextRunning);
  }, []);

  useEffect(() => {
    if (
      !soundPreferenceEnabled ||
      audioContextRunning ||
      soundPreferencePending ||
      soundUnlockPending
    ) {
      return;
    }

    const onTrustedInteraction = (event: PointerEvent | KeyboardEvent) => {
      if ("repeat" in event && event.repeat) {
        return;
      }
      void ensureAudioContextRunning();
    };

    window.addEventListener("pointerdown", onTrustedInteraction, { passive: true });
    window.addEventListener("keydown", onTrustedInteraction);
    return () => {
      window.removeEventListener("pointerdown", onTrustedInteraction);
      window.removeEventListener("keydown", onTrustedInteraction);
    };
  }, [
    ensureAudioContextRunning,
    audioContextRunning,
    soundPreferenceEnabled,
    soundPreferencePending,
    soundUnlockPending,
  ]);

  useEffect(() => {
    if (!finishLineEligible) {
      queueMicrotask(() => setFinishLineDeadlineMs(null));
      return;
    }
    const candidateDeadlineMs = computeFinishLineClientDeadlineMs({
      negotiationEndedAt: controlState.negotiationEndedAt ?? null,
      serverNow: controlState.serverNow ?? null,
      clientNowMs: Date.now(),
    });
    queueMicrotask(() => {
      setFinishLineDeadlineMs((currentDeadlineMs) =>
        coalesceFinishLineDeadlineMs(currentDeadlineMs, candidateDeadlineMs),
      );
    });
  }, [
    controlState.negotiationEndedAt,
    controlState.serverNow,
    finishLineEligible,
  ]);

  useEffect(() => {
    if (finishLineDeadlineMs == null) {
      return;
    }
    const remainingMs = finishLineDeadlineMs - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => setFinishLineClockMs(Date.now()));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setFinishLineClockMs(Date.now());
    }, remainingMs + 1);

    return () => window.clearTimeout(timeoutId);
  }, [finishLineDeadlineMs]);

  const isFinishLineActive =
    finishLineEligible &&
    finishLineDeadlineMs != null &&
    finishLineClockMs < finishLineDeadlineMs;

  const finishLineVariant =
    controlState.negotiationState === "FINISHED"
      ? resolveFinishLineVariant(controlState.remainingSeconds)
      : null;

  const soundControlState: SoundControlState = soundPreferenceEnabled
    ? "ENABLED"
    : "OFF";

  async function onSoundControlPress(uiState?: SoundControlState) {
    if (soundPreferencePending || soundUnlockPending) {
      return;
    }

    const stateAtPress = uiState ?? soundControlState;
    if (stateAtPress === "OFF") {
      const persisted = await persistSoundPreference(true);
      if (!persisted) {
        return;
      }
      setSoundUnlockPending(true);
      try {
        await ensureAudioContextRunning();
      } finally {
        setSoundUnlockPending(false);
      }
      return;
    }

    if (!audioContextRunning) {
      setSoundUnlockPending(true);
      try {
        await ensureAudioContextRunning();
      } finally {
        setSoundUnlockPending(false);
      }
      return;
    }

    await persistSoundPreference(false);
  }

  useEffect(() => {
    const reduction = reduceLiveSessionTransition({
      state: transitionStateRef.current,
      currentSnapshot: buildLiveSessionSnapshot(controlState),
      isVisible: isDocumentVisible,
      finishLineActive: isFinishLineActive,
      allowAudio: soundPreferenceEnabled && audioContextRunning,
    });
    transitionStateRef.current = reduction.nextState;

    if (reduction.announcementKey) {
      announcementIdRef.current += 1;
      setAnnouncement({
        id: announcementIdRef.current,
        text: t(reduction.announcementKey),
      });
    }

    const cue = reduction.cue;
    if (!cue) {
      return;
    }
    const context = getSemanticRoomAudioContext();
    if (!context || context.state !== "running") {
      return;
    }
    playSemanticRoomAudioCue(context, cue);
  }, [
    audioContextRunning,
    controlState,
    isDocumentVisible,
    isFinishLineActive,
    soundPreferenceEnabled,
    t,
  ]);

  const presentationState = deriveLiveSessionPresentationState({
    negotiationState: controlState.negotiationState,
    remainingSeconds: controlState.remainingSeconds,
    finishLineActive: isFinishLineActive,
  });

  return {
    presentationState,
    isFinishLineActive,
    finishLineVariant,
    announcement,
    soundControlState,
    soundRuntimeReady: audioContextRunning,
    soundControlBusy: soundPreferencePending || soundUnlockPending,
    onSoundControlPress,
  };
}
