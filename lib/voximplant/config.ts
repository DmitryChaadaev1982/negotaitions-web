import "server-only";

import { getEnvBoolean, getVideoProvider } from "@/lib/env";
import type {
  VideoProvider,
  VoximplantConfig,
  VoximplantRecordingAudioMode,
} from "@/lib/voximplant/types";

function getOptionalEnvString(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function getRequiredEnvString(key: string): string {
  const value = getOptionalEnvString(key);
  if (!value) {
    throw new Error(
      `Missing required Voximplant env var: ${key}. Configure it before running with VIDEO_PROVIDER=voximplant.`,
    );
  }
  return value;
}

function getRecordingAudioMode(): VoximplantRecordingAudioMode {
  const raw = process.env.VOXIMPLANT_RECORDING_AUDIO_MODE?.trim().toLowerCase();
  return raw === "hd_mp3" ? "hd_mp3" : "lossless";
}

function getRecordingPauseEnabled(recordingEnabled: boolean): boolean {
  const raw = process.env.VOXIMPLANT_RECORDING_PAUSE_ENABLED?.trim().toLowerCase();
  if (!raw) {
    return recordingEnabled;
  }
  return getEnvBoolean("VOXIMPLANT_RECORDING_PAUSE_ENABLED", recordingEnabled);
}

type GetVoximplantConfigOptions = {
  provider?: VideoProvider;
  requireForRuntime?: boolean;
};

export function getVoximplantConfig(
  options: GetVoximplantConfigOptions = {},
): VoximplantConfig {
  const provider = options.provider ?? getVideoProvider();
  const shouldRequire =
    options.requireForRuntime ?? provider === "voximplant";

  const recordingEnabled = getEnvBoolean("VOXIMPLANT_RECORDING_ENABLED", false);
  const recordingAudioOnly = getEnvBoolean(
    "VOXIMPLANT_RECORDING_AUDIO_ONLY",
    true,
  );

  return {
    accountName: shouldRequire
      ? getRequiredEnvString("VOXIMPLANT_ACCOUNT_NAME")
      : getOptionalEnvString("VOXIMPLANT_ACCOUNT_NAME"),
    applicationName: shouldRequire
      ? getRequiredEnvString("VOXIMPLANT_APPLICATION_NAME")
      : getOptionalEnvString("VOXIMPLANT_APPLICATION_NAME"),
    userDomain: shouldRequire
      ? getRequiredEnvString("VOXIMPLANT_USER_DOMAIN")
      : getOptionalEnvString("VOXIMPLANT_USER_DOMAIN"),
    scenarioName: shouldRequire
      ? getRequiredEnvString("VOXIMPLANT_SCENARIO_NAME")
      : getOptionalEnvString("VOXIMPLANT_SCENARIO_NAME"),
    ruleName: shouldRequire
      ? getRequiredEnvString("VOXIMPLANT_RULE_NAME")
      : getOptionalEnvString("VOXIMPLANT_RULE_NAME"),
    apiKeyPath: getOptionalEnvString("VOXIMPLANT_API_KEY_PATH"),
    recordingStorage: getOptionalEnvString("VOXIMPLANT_RECORDING_STORAGE"),
    recording: {
      enabled: recordingEnabled,
      audioOnly: recordingAudioOnly,
      audioMode: getRecordingAudioMode(),
      pauseEnabled: getRecordingPauseEnabled(recordingEnabled),
    },
  };
}
