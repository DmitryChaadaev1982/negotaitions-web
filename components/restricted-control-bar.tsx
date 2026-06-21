"use client";

import { ControlBar } from "@livekit/components-react";

type RestrictedControlBarProps = {
  micAllowed: boolean;
};

export function RestrictedControlBar({ micAllowed }: RestrictedControlBarProps) {
  return (
    <ControlBar
      controls={{
        chat: false,
        settings: false,
        microphone: micAllowed,
      }}
      saveUserChoices
    />
  );
}
