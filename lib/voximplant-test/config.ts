import { getEnvBoolean } from "@/lib/env";

export type VoximplantTestRole = "participant_a" | "participant_b" | "facilitator";

type RoleCredentials = {
  role: VoximplantTestRole;
  label: string;
  usernameShort: string;
  password: string;
};

type VoximplantTestConfig = {
  enabled: boolean;
  videoProvider: string;
  applicationName: string;
  accountName: string;
  userDomain: string;
  scenarioName: string;
  ruleName: string;
  conferenceName: string;
  /** Empty string means "auto" — do not pass a node to the Voximplant SDK. */
  connectionNode: string;
  /**
   * When true the join flow is as close as possible to the originally working
   * WebSDK callConference flow:
   * - single conference name (no time-bucketed fallbacks)
   * - no recording panel
   * - no nonessential SDK subscriptions
   * - no reconnect automation
   * - no custom node unless VOXIMPLANT_CONNECTION_NODE is explicitly set
   *
   * Defaults to true. Keep true until the three-user video-only smoke test is stable.
   */
  minimalJoinMode: boolean;
  roleCredentials: Record<VoximplantTestRole, RoleCredentials>;
};

const DEFAULT_CONFERENCE_NAME = "negotiations-smoke-poc";

function getRequiredEnv(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function buildRoleCredentials(
  role: VoximplantTestRole,
  label: string,
  usernameEnvKey: string,
  passwordEnvKey: string,
): RoleCredentials {
  return {
    role,
    label,
    usernameShort: getRequiredEnv(usernameEnvKey),
    password: getRequiredEnv(passwordEnvKey),
  };
}

export function getVoximplantTestConfig(): VoximplantTestConfig {
  const isDevMode = process.env.NODE_ENV !== "production";
  return {
    enabled: isDevMode,
    videoProvider: process.env.VIDEO_PROVIDER?.trim().toLowerCase() ?? "",
    applicationName: getRequiredEnv("VOXIMPLANT_APPLICATION_NAME"),
    accountName: getRequiredEnv("VOXIMPLANT_ACCOUNT_NAME"),
    userDomain: getRequiredEnv("VOXIMPLANT_USER_DOMAIN"),
    scenarioName: getRequiredEnv("VOXIMPLANT_SCENARIO_NAME"),
    ruleName: getRequiredEnv("VOXIMPLANT_RULE_NAME"),
    conferenceName:
      process.env.VOXIMPLANT_TEST_CONFERENCE_NAME?.trim() ||
      DEFAULT_CONFERENCE_NAME,
    // Empty string = auto. Do NOT default to NODE_1 or any fixed node.
    // Leave unset unless Voximplant Support explicitly tells you which node to use.
    connectionNode: process.env.VOXIMPLANT_CONNECTION_NODE?.trim() ?? "",
    // Defaults to true — keep minimal until video-only smoke test is stable.
    minimalJoinMode: getEnvBoolean("VOXIMPLANT_MINIMAL_JOIN_MODE", true),
    roleCredentials: {
      participant_a: buildRoleCredentials(
        "participant_a",
        "Participant A",
        "VOXIMPLANT_PARTICIPANT_A_USER",
        "VOXIMPLANT_PARTICIPANT_A_PASSWORD",
      ),
      participant_b: buildRoleCredentials(
        "participant_b",
        "Participant B",
        "VOXIMPLANT_PARTICIPANT_B_USER",
        "VOXIMPLANT_PARTICIPANT_B_PASSWORD",
      ),
      facilitator: buildRoleCredentials(
        "facilitator",
        "Facilitator",
        "VOXIMPLANT_FACILITATOR_USER",
        "VOXIMPLANT_FACILITATOR_PASSWORD",
      ),
    },
  };
}

// Recording panel is intentionally disabled in the video-only baseline.
// Default is false — do not enable until recording is implemented in a separate branch
// and the video-only smoke test passes again.
export function isVoximplantRecordingPanelEnabled(): boolean {
  return getEnvBoolean("VOXIMPLANT_RECORDING_PANEL_ENABLED", false);
}

// Kept for future use but gated by isVoximplantRecordingPanelEnabled().
export function isVoximplantRecordingEnabled(): boolean {
  return (
    isVoximplantRecordingPanelEnabled() &&
    getEnvBoolean("VOXIMPLANT_RECORDING_ENABLED", false)
  );
}

export type VoximplantRecordingStorage = "s3" | "voximplant_cloud" | "unknown";

export function getVoximplantRecordingStorage(): VoximplantRecordingStorage {
  const raw = process.env.VOXIMPLANT_RECORDING_STORAGE?.trim().toLowerCase();
  if (!raw) return "unknown";
  if (raw === "s3" || raw === "yandex" || raw === "yandex_object_storage") {
    return "s3";
  }
  if (raw === "voximplant" || raw === "voximplant_cloud") {
    return "voximplant_cloud";
  }
  return "unknown";
}
