"use client";

import { useEffect, useRef, useState } from "react";

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
  playSemanticRoomAudioCue,
} from "@/lib/semantic-room-audio";
import { useI18n } from "@/lib/i18n/useI18n";

type SoundControlState = "OFF" | "ENABLED" | "BLOCKED";

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
  soundControlBusy: boolean;
  onSoundControlPress: () => Promise<void>;
};

function getAudioContextConstructor() {
  if (typeof globalThis === "undefined") {
    return null;
  }
  const typedGlobal = globalThis as typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };
  return typedGlobal.AudioContext ?? typedGlobal.webkitAudioContext ?? null;
}

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
  const [audioContextRunning, setAudioContextRunning] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
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

  async function ensureAudioContextRunning() {
    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      setAudioContextRunning(false);
      return false;
    }

    let context = audioContextRef.current;
    if (!context) {
      try {
        context = new AudioContextConstructor();
        context.onstatechange = () => {
          const nextContext = audioContextRef.current;
          setAudioContextRunning(Boolean(nextContext && nextContext.state === "running"));
        };
        audioContextRef.current = context;
      } catch {
        setAudioContextRunning(false);
        return false;
      }
    }

    if (context.state !== "running") {
      try {
        await context.resume();
      } catch {
        setAudioContextRunning(false);
        return false;
      }
    }
    setAudioContextRunning(context.state === "running");
    return context.state === "running";
  }

  useEffect(() => {
    return () => {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      setAudioContextRunning(false);
      if (!context) {
        return;
      }
      void context.close().catch(() => {
        // No-op: failed close is non-blocking.
      });
    };
  }, []);

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

  const soundControlState: SoundControlState = !soundPreferenceEnabled
    ? "OFF"
    : audioContextRunning
      ? "ENABLED"
      : "BLOCKED";

  async function onSoundControlPress() {
    if (soundPreferencePending || soundUnlockPending) {
      return;
    }

    if (!soundPreferenceEnabled) {
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

    if (audioContextRunning) {
      await persistSoundPreference(false);
      return;
    }

    setSoundUnlockPending(true);
    try {
      await ensureAudioContextRunning();
    } finally {
      setSoundUnlockPending(false);
    }
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
    const context = audioContextRef.current;
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
    soundControlBusy: soundPreferencePending || soundUnlockPending,
    onSoundControlPress,
  };
}
