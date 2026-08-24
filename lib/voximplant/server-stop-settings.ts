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

/**
 * Runtime-neutral Voximplant server-stop settings parser.
 *
 * Safe for the operational Stage 3.10 CLI (raw tsx / Node). Next.js
 * application consumers must import `@/lib/voximplant/server-stop-config`,
 * which retains `import "server-only"`.
 */
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
