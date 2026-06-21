"use client";

import { useLocalParticipant } from "@livekit/components-react";
import type { ControlState } from "@/lib/negotiation-control";
import { useEffect, useRef } from "react";

type MicEnforcementProps = {
  controlState: ControlState;
};

export function MicEnforcement({ controlState }: MicEnforcementProps) {
  const { localParticipant } = useLocalParticipant();
  const micAllowedRef = useRef(controlState.micAllowed);
  const userMutedBeforeSystemRef = useRef<boolean | null>(null);

  useEffect(() => {
    micAllowedRef.current = controlState.micAllowed;
  }, [controlState.micAllowed]);

  useEffect(() => {
    if (!localParticipant) {
      return;
    }

    const applyMicPolicy = async () => {
      const micAllowed = micAllowedRef.current;
      const isMicEnabled = localParticipant.isMicrophoneEnabled;

      if (!micAllowed) {
        if (userMutedBeforeSystemRef.current === null) {
          userMutedBeforeSystemRef.current = isMicEnabled;
        }

        if (isMicEnabled) {
          await localParticipant.setMicrophoneEnabled(false);
        }
        return;
      }

      if (userMutedBeforeSystemRef.current !== null) {
        const shouldRestore = userMutedBeforeSystemRef.current;
        userMutedBeforeSystemRef.current = null;

        if (shouldRestore && !localParticipant.isMicrophoneEnabled) {
          await localParticipant.setMicrophoneEnabled(true);
        }
      }
    };

    void applyMicPolicy();
  }, [controlState.micAllowed, controlState.negotiationState, localParticipant]);

  return null;
}
