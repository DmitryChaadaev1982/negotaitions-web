import "server-only";

import {
  getVoximplantServerStopCallbackReplayWindowSeconds,
  getVoximplantServerStopCallbackSecret,
  getVoximplantServerStopControlSecret,
  getVoximplantServerStopControlTimeoutMs,
  getVoximplantServerStopMode,
  getVoximplantServerStopTerminalTimeoutSeconds,
  isVoximplantServerStopEnabled,
  type VoximplantServerStopMode,
} from "@/lib/env";

export type VoximplantServerStopConfig = {
  mode: VoximplantServerStopMode;
  enabled: boolean;
  controlSecret: string | null;
  callbackSecret: string | null;
  controlTimeoutMs: number;
  callbackReplayWindowSeconds: number;
  terminalTimeoutSeconds: number;
};

export function getVoximplantServerStopConfig(): VoximplantServerStopConfig {
  const mode = getVoximplantServerStopMode();
  const enabled = isVoximplantServerStopEnabled(mode);
  return {
    mode,
    enabled,
    controlSecret: getVoximplantServerStopControlSecret(mode),
    callbackSecret: getVoximplantServerStopCallbackSecret(mode),
    controlTimeoutMs: getVoximplantServerStopControlTimeoutMs(),
    callbackReplayWindowSeconds: getVoximplantServerStopCallbackReplayWindowSeconds(),
    terminalTimeoutSeconds: getVoximplantServerStopTerminalTimeoutSeconds(),
  };
}
